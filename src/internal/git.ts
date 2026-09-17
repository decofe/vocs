import { execSync } from 'node:child_process'

const buildDates = new WeakMap<object, Map<string, string | undefined>>()

/** Start a fresh cache for one build, or disable it for development/watch mode. */
export function resetCache({ scope, enabled }: resetCache.Options) {
  if (enabled) buildDates.set(scope, new Map())
  else buildDates.delete(scope)
}

export declare namespace resetCache {
  type Options = { scope: object; enabled: boolean }
}

export function getLastModified(
  filePath: string,
  { scope }: getLastModified.Options = {},
): string | undefined {
  const cache = scope ? buildDates.get(scope) : undefined
  if (cache?.has(filePath)) return cache.get(filePath)
  try {
    const result = execSync(`git log -1 --format=%cI -- "${filePath}"`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    const date = result || undefined
    cache?.set(filePath, date)
    return date
  } catch {
    return undefined
  }
}

export declare namespace getLastModified {
  type Options = { scope?: object | undefined }
}
