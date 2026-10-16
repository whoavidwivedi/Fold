import * as React from "react"

const MOBILE_BREAKPOINT = 768

/**
 * Stock shadcn reads `window.innerWidth` into state inside an effect, which the React
 * compiler's set-state-in-effect rule rejects — and it is right to: the value is knowable
 * on the first render, so storing it in state means one render of `false` for every user
 * on a phone, and a layout that flashes its desktop branch first.
 *
 * `useSyncExternalStore` is the primitive this is a hand-rolled version of. The server
 * snapshot is `false` and the client snapshot is the real match, which is exactly the
 * contract React wants for a value that legitimately differs between server and client.
 */
const query = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(query)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false
  )
}
