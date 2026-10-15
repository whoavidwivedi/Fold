"use client"

import { useEffect, useState } from "react"

/**
 * Debounce a value by `delay` milliseconds.
 *
 * Local rather than a dependency: this is nine lines, and the package that exists for
 * it is a transitive dependency nobody controls. Revisit if we need a cancel handle or
 * leading-edge behaviour.
 *
 * The search box needs this because every keystroke would otherwise hit the API — and
 * `websearch_to_tsquery` on a partial word is not a query worth sending.
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debounced
}