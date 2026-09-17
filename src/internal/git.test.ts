import { execSync } from 'node:child_process'
import { beforeEach, expect, test, vi } from 'vitest'

import * as Git from './git.js'

vi.mock('node:child_process', () => ({ execSync: vi.fn() }))

beforeEach(() => {
  vi.mocked(execSync).mockReset()
})

test('reuses production dates independently for each file', () => {
  const scope = {}
  Git.resetCache({ scope, enabled: true })
  vi.mocked(execSync).mockReturnValueOnce('2026-01-01\n').mockReturnValueOnce('2026-02-01\n')

  expect(Git.getLastModified('first.mdx', { scope })).toBe('2026-01-01')
  expect(Git.getLastModified('second.mdx', { scope })).toBe('2026-02-01')
  expect(Git.getLastModified('first.mdx', { scope })).toBe('2026-01-01')
  expect(execSync).toHaveBeenCalledTimes(2)
})

test('reuses missing dates for untracked files in production', () => {
  const scope = {}
  Git.resetCache({ scope, enabled: true })
  vi.mocked(execSync).mockReturnValue('')

  expect(Git.getLastModified('new.mdx', { scope })).toBeUndefined()
  expect(Git.getLastModified('new.mdx', { scope })).toBeUndefined()
  expect(execSync).toHaveBeenCalledTimes(1)
})

test('retries failed Git lookups', () => {
  const scope = {}
  Git.resetCache({ scope, enabled: true })
  vi.mocked(execSync)
    .mockImplementationOnce(() => {
      throw new Error('Git unavailable')
    })
    .mockReturnValueOnce('2026-01-01\n')

  expect(Git.getLastModified('index.mdx', { scope })).toBeUndefined()
  expect(Git.getLastModified('index.mdx', { scope })).toBe('2026-01-01')
  expect(execSync).toHaveBeenCalledTimes(2)
})

test('isolates configurations and invalidates missing dates between builds', () => {
  const first = {}
  const second = {}
  Git.resetCache({ scope: first, enabled: true })
  Git.resetCache({ scope: second, enabled: true })
  vi.mocked(execSync).mockReturnValueOnce('').mockReturnValueOnce('2026-01-01\n')
  expect(Git.getLastModified('index.mdx', { scope: first })).toBeUndefined()
  expect(Git.getLastModified('index.mdx', { scope: second })).toBe('2026-01-01')
  Git.resetCache({ scope: first, enabled: true })
  vi.mocked(execSync).mockReturnValueOnce('2026-02-01\n')
  expect(Git.getLastModified('index.mdx', { scope: first })).toBe('2026-02-01')
  expect(Git.getLastModified('index.mdx', { scope: second })).toBe('2026-01-01')
  expect(execSync).toHaveBeenCalledTimes(3)
})

test('reads fresh dates when caching is disabled', () => {
  const scope = {}
  Git.resetCache({ scope, enabled: true })
  vi.mocked(execSync)
    .mockReturnValueOnce('2026-01-01\n')
    .mockReturnValueOnce('2026-02-01\n')
    .mockReturnValueOnce('2026-03-01\n')

  expect(Git.getLastModified('index.mdx', { scope })).toBe('2026-01-01')
  Git.resetCache({ scope, enabled: false })
  expect(Git.getLastModified('index.mdx', { scope })).toBe('2026-02-01')
  expect(Git.getLastModified('index.mdx', { scope })).toBe('2026-03-01')
  expect(execSync).toHaveBeenCalledTimes(3)
})
