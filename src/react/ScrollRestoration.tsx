'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'waku'
import { currentHashId, revealAnchor } from './internal/openapi/anchor-navigation.client.js'

const storageKey = 'vocs:scroll'

export function ScrollRestoration() {
  const router = useRouter()
  const { path } = router

  const savedPositions = useRef<Record<string, number>>({})
  const prevHash = useRef<string | null>(null)
  const prevPath = useRef<string | null>(null)
  const isPopstate = useRef(false)

  // Load saved positions and listen to browser events
  useEffect(() => {
    if (typeof window === 'undefined') return

    window.history.scrollRestoration = 'manual'

    try {
      const stored = sessionStorage.getItem(storageKey)
      if (stored) savedPositions.current = JSON.parse(stored)
    } catch {}

    // Track back/forward navigation
    function handlePopstate() {
      isPopstate.current = true
    }

    // Waku no longer exposes route change events, so keep the current position
    // updated as the user scrolls instead of waiting for navigation to start.
    function handleScroll() {
      if (prevPath.current !== null) {
        savedPositions.current[prevPath.current] = window.scrollY
      }
    }

    function persistPositions() {
      handleScroll()
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(savedPositions.current))
      } catch {}
    }

    window.addEventListener('popstate', handlePopstate)
    window.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('pagehide', persistPositions)
    return () => {
      window.removeEventListener('popstate', handlePopstate)
      window.removeEventListener('scroll', handleScroll)
      window.removeEventListener('pagehide', persistPositions)
      persistPositions()
      window.history.scrollRestoration = 'auto'
    }
  }, [])

  // Handle hash changes (same-page anchor navigation)
  useEffect(() => {
    if (typeof window === 'undefined') return

    const hash = currentHashId(router.hash)
    if (hash) {
      void revealAnchor(hash, {
        behavior: prevHash.current ? 'smooth' : 'auto',
        updateHash: false,
      })
      prevHash.current = hash
    }
  }, [router.hash])

  // Handle scroll on path change
  useEffect(() => {
    if (typeof window === 'undefined') return

    const hash = currentHashId(router.hash)

    // Restore saved position only on back/forward, otherwise scroll to top or hash
    if (isPopstate.current) {
      const savedY = savedPositions.current[path]
      if (typeof savedY === 'number') window.scrollTo(0, savedY)
      else window.scrollTo(0, 0)
      isPopstate.current = false
    } else if (hash) {
      const element = document.getElementById(hash)
      if (element) element.scrollIntoView({ behavior: 'instant' })
    } else {
      window.scrollTo(0, 0)
    }

    prevPath.current = path
  }, [path, router.hash])

  return null
}
