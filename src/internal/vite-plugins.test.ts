import * as ChildProcess from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { build, createBuilder, type ResolvedConfig, resolveConfig } from 'vite'
import { afterEach, describe, expect, test, vi } from 'vitest'
import * as Config from './config.js'
import * as Git from './git.js'
import * as Llms from './llms.js'
import type * as OpenApi from './openapi/index.js'
import * as Plugins from './vite-plugins.js'

const tempDirs = new Set<string>()

vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>()
  return { ...original, execSync: vi.fn(original.execSync) }
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.mocked(ChildProcess.execSync).mockReset()
  await Promise.all([...tempDirs].map((dir) => fs.rm(dir, { force: true, recursive: true })))
  tempDirs.clear()
})

test('builds Markdown only for the client and preserves it after output cleanup', async () => {
  const fixture = await createFixture()
  await fs.writeFile(path.join(fixture.rootDir, 'index.html'), '<html><body>Hello</body></html>')
  await fs.writeFile(path.join(fixture.rootDir, 'server.js'), 'export const hello = "world"')
  await fs.writeFile(path.join(fixture.outDir, 'stale.txt'), 'old output')
  const scan = vi.spyOn(Llms, 'getPagesFromDir')
  const config = Config.define({
    rootDir: fixture.rootDir,
    srcDir: 'src',
    outDir: 'dist',
    title: 'My Docs',
    codeHighlight: { langs: [] },
  })
  const options = {
    root: fixture.rootDir,
    configFile: false as const,
    logLevel: 'silent' as const,
  }

  await build({
    ...options,
    plugins: [Plugins.llms(config)],
    build: { ssr: 'server.js', outDir: 'dist/server' },
  })
  expect(scan).not.toHaveBeenCalled()

  await build({
    ...options,
    plugins: [Plugins.llms(config)],
    build: { outDir: 'dist/public', emptyOutDir: true },
  })

  expect(scan).toHaveBeenCalledTimes(1)
  await expect(fs.access(path.join(fixture.outDir, 'stale.txt'))).rejects.toThrow()
  await expect(fs.readFile(path.join(fixture.outDir, 'llms.txt'), 'utf-8')).resolves.toContain(
    '# My Docs',
  )
  await expect(fs.readFile(path.join(fixture.outDir, 'llms-full.txt'), 'utf-8')).resolves.toContain(
    '# Hello',
  )
  await expect(
    fs.readFile(path.join(fixture.outDir, 'assets/md/index.md'), 'utf-8'),
  ).resolves.toContain('# Hello')
})

test('refreshes Git dates between app builds without reloading modules', async () => {
  const fixture = await createFixture()
  await fs.writeFile(path.join(fixture.rootDir, 'index.html'), '<html><body>Hello</body></html>')
  const config = Config.define({ rootDir: fixture.rootDir })
  const lookup = vi.mocked(ChildProcess.execSync).mockReturnValue('2026-01-01\n')
  const dates: (string | undefined)[] = []
  const builder = await createBuilder({
    root: fixture.rootDir,
    configFile: false,
    logLevel: 'silent',
    builder: {
      async buildApp(builder) {
        for (const environment of Object.values(builder.environments))
          await builder.build(environment)
      },
    },
    plugins: [
      Plugins.gitDates(config),
      {
        name: 'test:git-consumers',
        buildStart() {
          dates.push(Git.getLastModified('index.mdx', { scope: config }))
        },
        writeBundle() {
          dates.push(Git.getLastModified('index.mdx', { scope: config }))
        },
      },
    ],
  })

  await builder.buildApp()
  expect(lookup).toHaveBeenCalledTimes(1)
  lookup.mockReturnValue('2026-02-01\n')
  await builder.buildApp()
  expect(lookup).toHaveBeenCalledTimes(2)
  expect(dates).toEqual(['2026-01-01', '2026-01-01', '2026-02-01', '2026-02-01'])
})

test.each(['development', 'watch'] as const)('does not cache Git dates in %s', async (mode) => {
  const config = Config.define()
  const lookup = vi.mocked(ChildProcess.execSync)
  await resolveConfig(
    {
      configFile: false,
      plugins: [Plugins.gitDates(config)],
      build: { watch: mode === 'watch' ? {} : null },
    },
    mode === 'watch' ? 'build' : 'serve',
  )
  lookup.mockReturnValue('2026-01-01\n')
  expect(Git.getLastModified('index.mdx', { scope: config })).toBe('2026-01-01')
  lookup.mockReturnValue('2026-02-01\n')
  expect(Git.getLastModified('index.mdx', { scope: config })).toBe('2026-02-01')
  expect(lookup).toHaveBeenCalledTimes(2)
})

describe('openapi client modules', () => {
  const specs = {
    '/first': { client: { content: { marker: 'first-client' } } },
    '/second': { client: { content: { marker: 'second-client' } } },
  } as unknown as Record<string, OpenApi.Ir>

  test('creates one lazy document import per mount', () => {
    const manifest = Plugins.openapiClientManifest(specs)

    expect(manifest).toContain('virtual:vocs/openapi-client:%2Ffirst')
    expect(manifest).toContain('virtual:vocs/openapi-client:%2Fsecond')
    expect(manifest).not.toContain('first-client')
    expect(manifest).not.toContain('second-client')
  })

  test('serializes only the requested client document', () => {
    const document = Plugins.openapiClientDocument(specs, '/first')

    expect(document).toContain('first-client')
    expect(document).not.toContain('second-client')
  })
})

describe('openapi schema model modules', () => {
  const specs = {
    '/first': {
      path: '/first',
      groups: [
        {
          id: 'pets',
          operations: [
            {
              id: 'createpet',
              parameters: [],
              requestBody: {
                content: [
                  {
                    mediaType: 'application/json',
                    schema: {
                      type: 'object',
                      properties: {
                        firstMarker: { type: 'string', description: 'first schema detail' },
                      },
                    },
                  },
                ],
              },
              responses: [],
            },
          ],
        },
        {
          id: 'owners',
          operations: [
            {
              id: 'createowner',
              parameters: [],
              requestBody: {
                content: [
                  {
                    mediaType: 'application/json',
                    schema: {
                      type: 'object',
                      properties: {
                        secondMarker: { type: 'string', description: 'second schema detail' },
                      },
                    },
                  },
                ],
              },
              responses: [],
            },
          ],
        },
      ],
    },
  } as unknown as Record<string, OpenApi.Ir>

  test('creates one lazy document import per category without inlining models', () => {
    const manifest = Plugins.openapiSchemaModelsManifest(specs)

    expect(manifest).toContain('virtual:vocs/openapi-schema-models:')
    expect(manifest).toContain('pets')
    expect(manifest).toContain('owners')
    expect(manifest).not.toContain('schema detail')
  })

  test('serializes only the requested category models', () => {
    const source = JSON.stringify(['/first', 'pets'])
    const document = Plugins.openapiSchemaModelsDocument(specs, source)

    expect(document).toContain('first schema detail')
    expect(document).not.toContain('second schema detail')
  })
})

describe('sitemap', () => {
  test('generates robots.txt and sitemap.xml when public files do not exist', async () => {
    const fixture = await createFixture()
    const plugin = createSitemapPlugin(fixture.rootDir, fixture.publicDir)

    await plugin.writeBundle({ dir: fixture.outDir })

    await expect(fs.readFile(path.join(fixture.outDir, 'robots.txt'), 'utf-8')).resolves.toContain(
      'Sitemap: https://example.com/sitemap.xml',
    )
    await expect(fs.readFile(path.join(fixture.outDir, 'sitemap.xml'), 'utf-8')).resolves.toContain(
      '<loc>https://example.com/</loc>',
    )
  })

  test('preserves public robots.txt', async () => {
    const fixture = await createFixture()
    const plugin = createSitemapPlugin(fixture.rootDir, fixture.publicDir)
    const robots = 'User-agent: *\nContent-Signal: ai-train=yes, search=yes, ai-input=yes\n'

    await fs.writeFile(path.join(fixture.publicDir, 'robots.txt'), robots)
    await fs.writeFile(path.join(fixture.outDir, 'robots.txt'), robots)
    await plugin.writeBundle({ dir: fixture.outDir })

    await expect(fs.readFile(path.join(fixture.outDir, 'robots.txt'), 'utf-8')).resolves.toBe(
      robots,
    )
    await expect(fs.readFile(path.join(fixture.outDir, 'sitemap.xml'), 'utf-8')).resolves.toContain(
      '<loc>https://example.com/</loc>',
    )
  })

  test('preserves public sitemap.xml', async () => {
    const fixture = await createFixture()
    const plugin = createSitemapPlugin(fixture.rootDir, fixture.publicDir)
    const sitemapXml = '<urlset><url><loc>https://custom.example/</loc></url></urlset>\n'

    await fs.writeFile(path.join(fixture.publicDir, 'sitemap.xml'), sitemapXml)
    await fs.writeFile(path.join(fixture.outDir, 'sitemap.xml'), sitemapXml)
    await plugin.writeBundle({ dir: fixture.outDir })

    await expect(fs.readFile(path.join(fixture.outDir, 'sitemap.xml'), 'utf-8')).resolves.toBe(
      sitemapXml,
    )
    await expect(fs.readFile(path.join(fixture.outDir, 'robots.txt'), 'utf-8')).resolves.toContain(
      'Sitemap: https://example.com/sitemap.xml',
    )
  })

  test('supports route-aware sitemap config', async () => {
    const fixture = await createFixture()
    await fs.mkdir(path.join(fixture.rootDir, 'src/pages/docs'), { recursive: true })
    await fs.writeFile(path.join(fixture.rootDir, 'src/pages/docs/index.mdx'), '# Docs\n')
    await fs.writeFile(path.join(fixture.rootDir, 'src/pages/blog.mdx'), '# Blog\n')
    const plugin = createSitemapPlugin(fixture.rootDir, fixture.publicDir, {
      sitemap: {
        include: (path) => path !== '/blog',
        lastmod: (path, { lastmod }) => (path.startsWith('/docs') ? false : lastmod),
      },
    })

    await plugin.writeBundle({ dir: fixture.outDir })

    const sitemapXml = await fs.readFile(path.join(fixture.outDir, 'sitemap.xml'), 'utf-8')
    expect(sitemapXml).toContain('<loc>https://example.com/docs</loc>')
    expect(sitemapXml).not.toContain('<loc>https://example.com/blog</loc>')
    expect(sitemapXml).not.toMatch(
      /<url>\n\s*<loc>https:\/\/example\.com\/docs<\/loc>\n\s*<lastmod>/,
    )
  })

  test('supports lastmod overrides', async () => {
    const fixture = await createFixture()
    await fs.writeFile(path.join(fixture.rootDir, 'src/pages/changelog.mdx'), '# Changelog\n')
    const plugin = createSitemapPlugin(fixture.rootDir, fixture.publicDir, {
      sitemap: {
        lastmod: (path, { lastmod }) => (path === '/changelog' ? '2025-01-01' : lastmod),
      },
    })

    await plugin.writeBundle({ dir: fixture.outDir })

    const sitemapXml = await fs.readFile(path.join(fixture.outDir, 'sitemap.xml'), 'utf-8')
    expect(sitemapXml).toMatch(
      /<url>\n\s*<loc>https:\/\/example\.com\/changelog<\/loc>\n\s*<lastmod>2025-01-01<\/lastmod>\n\s*<\/url>/,
    )
  })

  test('disables generated sitemap and robots files', async () => {
    const fixture = await createFixture()
    const plugin = createSitemapPlugin(fixture.rootDir, fixture.publicDir, { sitemap: false })

    await plugin.writeBundle({ dir: fixture.outDir })

    await expect(fs.access(path.join(fixture.outDir, 'sitemap.xml'))).rejects.toThrow()
    await expect(fs.access(path.join(fixture.outDir, 'robots.txt'))).rejects.toThrow()
  })
})

describe('sitemap config helpers', () => {
  test('resolves include config', () => {
    expect(Plugins.resolveSitemapInclude({ sitemap: false }, '/docs', 'docs/index.mdx')).toBe(false)
    expect(
      Plugins.resolveSitemapInclude({ sitemap: { include: false } }, '/docs', 'docs/index.mdx'),
    ).toBe(false)
    expect(
      Plugins.resolveSitemapInclude(
        { sitemap: { include: (path) => path.startsWith('/docs') } },
        '/docs',
        'docs/index.mdx',
      ),
    ).toBe(true)
  })

  test('resolves lastmod config', () => {
    expect(
      Plugins.resolveSitemapLastmod({ sitemap: false }, '/docs', 'docs/index.mdx', '2026-01-01'),
    ).toBe(undefined)
    expect(
      Plugins.resolveSitemapLastmod(
        { sitemap: { lastmod: false } },
        '/docs',
        'docs/index.mdx',
        '2026-01-01',
      ),
    ).toBe(undefined)
    expect(
      Plugins.resolveSitemapLastmod(
        { sitemap: { lastmod: () => '2025-01-01' } },
        '/docs',
        'docs/index.mdx',
        '2026-01-01',
      ),
    ).toBe('2025-01-01')
  })
})

async function createFixture() {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vocs-sitemap-'))
  tempDirs.add(rootDir)

  const pagesDir = path.join(rootDir, 'src/pages')
  const publicDir = path.join(rootDir, 'public')
  const outDir = path.join(rootDir, 'dist/public')
  await fs.mkdir(pagesDir, { recursive: true })
  await fs.mkdir(publicDir, { recursive: true })
  await fs.mkdir(outDir, { recursive: true })
  await fs.writeFile(path.join(pagesDir, 'index.mdx'), '# Hello\n')

  return { outDir, publicDir, rootDir }
}

function createSitemapPlugin(
  rootDir: string,
  publicDir: string,
  config: Partial<Config.Config> = {},
) {
  const plugin = Plugins.sitemap({
    baseUrl: 'https://example.com',
    pagesDir: 'pages',
    srcDir: 'src',
    ...config,
  } as Config.Config) as unknown as {
    configResolved(config: ResolvedConfig): void
    writeBundle(options: { dir: string }): Promise<void>
  }

  plugin.configResolved({
    command: 'build',
    publicDir,
    root: rootDir,
  } as ResolvedConfig)

  return plugin
}
