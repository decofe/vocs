import { execSync } from 'node:child_process'

const buildDates = new Map<string, string | undefined>()

export function getLastModified(filePath: string): string | undefined {
  // MDX and the sitemap ask for the same dates during a production build.
  // Do not cache in dev, where new commits can arrive without a restart.
  const cache = process.env['NODE_ENV'] === 'production'
  if (cache && buildDates.has(filePath)) return buildDates.get(filePath)
  try {
    const result = execSync(`git log -1 --format=%cI -- "${filePath}"`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    const date = result || undefined
    if (cache) buildDates.set(filePath, date)
    return date
  } catch {
    return undefined
  }
}
