import { execSync } from 'node:child_process'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.mock('node:child_process', () => ({ execSync: vi.fn() }))

beforeEach(() => {
  vi.resetModules()
  vi.mocked(execSync).mockReset()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

test('reuses production dates independently for each file', async () => {
  vi.stubEnv('NODE_ENV', 'production')
  vi.mocked(execSync).mockReturnValueOnce('2026-01-01\n').mockReturnValueOnce('2026-02-01\n')
  const { getLastModified } = await import('./git.js')

  expect(getLastModified('first.mdx')).toBe('2026-01-01')
  expect(getLastModified('second.mdx')).toBe('2026-02-01')
  expect(getLastModified('first.mdx')).toBe('2026-01-01')
  expect(execSync).toHaveBeenCalledTimes(2)
})

test('reuses missing dates for untracked files in production', async () => {
  vi.stubEnv('NODE_ENV', 'production')
  vi.mocked(execSync).mockReturnValue('')
  const { getLastModified } = await import('./git.js')

  expect(getLastModified('new.mdx')).toBeUndefined()
  expect(getLastModified('new.mdx')).toBeUndefined()
  expect(execSync).toHaveBeenCalledTimes(1)
})

test('retries failed Git lookups', async () => {
  vi.stubEnv('NODE_ENV', 'production')
  vi.mocked(execSync)
    .mockImplementationOnce(() => {
      throw new Error('Git unavailable')
    })
    .mockReturnValueOnce('2026-01-01\n')
  const { getLastModified } = await import('./git.js')

  expect(getLastModified('index.mdx')).toBeUndefined()
  expect(getLastModified('index.mdx')).toBe('2026-01-01')
  expect(execSync).toHaveBeenCalledTimes(2)
})

test('reads fresh dates in development, even after a production lookup', async () => {
  vi.stubEnv('NODE_ENV', 'production')
  vi.mocked(execSync)
    .mockReturnValueOnce('2026-01-01\n')
    .mockReturnValueOnce('2026-02-01\n')
    .mockReturnValueOnce('2026-03-01\n')
  const { getLastModified } = await import('./git.js')

  expect(getLastModified('index.mdx')).toBe('2026-01-01')
  vi.stubEnv('NODE_ENV', 'development')
  expect(getLastModified('index.mdx')).toBe('2026-02-01')
  expect(getLastModified('index.mdx')).toBe('2026-03-01')
  expect(execSync).toHaveBeenCalledTimes(3)
})
