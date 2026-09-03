/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ScrollRestoration } from './ScrollRestoration.js'

const mocks = vi.hoisted(() => ({
  router: { hash: '', path: '/docs' },
}))

vi.mock('waku', () => ({
  useRouter: () => mocks.router,
}))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  mocks.router.hash = ''
  mocks.router.path = '/docs'
  sessionStorage.clear()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 0, writable: true })
  window.scrollTo = vi.fn()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

test('restores positions without Waku route change events', async () => {
  await act(async () => root.render(<ScrollRestoration />))

  window.scrollY = 240
  act(() => window.dispatchEvent(new Event('scroll')))

  mocks.router.path = '/reference'
  await act(async () => root.render(<ScrollRestoration />))
  window.scrollY = 0

  act(() => window.dispatchEvent(new PopStateEvent('popstate')))
  mocks.router.path = '/docs'
  await act(async () => root.render(<ScrollRestoration />))

  expect(window.scrollTo).toHaveBeenLastCalledWith(0, 240)
})
