"use client"

import { useEffect, useRef } from "react"

/**
 * Material 3 ripple.
 *
 * The three constants are from `ripple/internal/ripple.ts` in material-components/
 * material-web, and they are the whole of the physics:
 *
 *   PRESS_GROW_MS 450  the layer expands over 450ms — md-sys-motion long1
 *   MINIMUM_PRESS_MS 225  a layer down for less than this STAYS that long, so a
 *                    40ms tap is still seen. Without it quick taps flash nothing.
 *   TOUCH_DELAY_MS 150  touch waits 150ms before showing, so a finger that starts
 *                    a scroll does not flash a press first.
 *
 * Bounded grows from the pointer and is sized to reach the far corner, so it covers
 * the element from wherever it started. Unbounded grows from the centre with the same
 * reach — the shape icon buttons need, where there is no pointer inside the visible
 * bounds to grow from.
 *
 * A hook rather than a wrapper component, so it composes with markup that already
 * exists instead of asking for another DOM node in the middle of a table row.
 */
const PRESS_GROW_MS = 450
const MINIMUM_PRESS_MS = 225
const TOUCH_DELAY_MS = 150
const PRESSED_OPACITY = 0.12
const FADE_OUT_MS = 200
const EASE = "cubic-bezier(0.2, 0, 0, 1)"

export function useRipple<T extends HTMLElement>(unbounded = false) {
  const ref = useRef<T>(null)

  useEffect(() => {
    const host = ref.current
    if (!host) return

    let downAt = 0
    let touchTimer: ReturnType<typeof setTimeout> | undefined

    const grow = (fromCentre: boolean, clientX = 0, clientY = 0) => {
      const rect = host.getBoundingClientRect()
      const x = fromCentre ? rect.width / 2 : clientX - rect.left
      const y = fromCentre ? rect.height / 2 : clientY - rect.top

      // Distance from the origin to the furthest corner, doubled: the layer only
      // covers the element once it has grown that far.
      const reach = Math.hypot(
        Math.max(x, rect.width - x),
        Math.max(y, rect.height - y),
      )
      const size = reach * 2

      const layer = document.createElement("span")
      layer.dataset.slot = "ripple"
      layer.style.cssText = [
        "position:absolute",
        "pointer-events:none",
        "border-radius:inherit",
        `left:${x - size / 2}px`,
        `top:${y - size / 2}px`,
        `width:${size}px`,
        `height:${size}px`,
        "background-color:currentColor",
        "opacity:0",
        "transform:scale(0)",
        `transition:transform ${PRESS_GROW_MS}ms ${EASE}, opacity 120ms ${EASE}`,
      ].join(";")

      host.appendChild(layer)
      downAt = performance.now()

      // Commit scale(0) before animating to scale(1). Without the reflow the browser
      // coalesces both styles into one frame and nothing happens — a ripple that
      // silently does not ripple.
      void layer.offsetWidth
      requestAnimationFrame(() => {
        layer.style.transform = "scale(1)"
        layer.style.opacity = String(PRESSED_OPACITY)
      })
    }

    const settle = () => {
      if (touchTimer) clearTimeout(touchTimer)
      touchTimer = undefined

      const live = host.querySelectorAll<HTMLElement>('[data-slot="ripple"]')
      if (!live.length) return

      // MINIMUM_PRESS_MS: a tap shorter than this still gets its full visible life.
      const wait = Math.max(0, MINIMUM_PRESS_MS - (performance.now() - downAt))

      setTimeout(() => {
        for (const layer of live) {
          layer.style.opacity = "0"
          layer.style.transition = `opacity ${FADE_OUT_MS}ms ${EASE}`
          setTimeout(() => layer.remove(), FADE_OUT_MS)
        }
      }, wait)
    }

    const onDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) return

      if (event.pointerType === "touch") {
        // Delay so a finger that starts a scroll does not flash a press first.
        touchTimer = setTimeout(() => grow(unbounded, event.clientX, event.clientY), TOUCH_DELAY_MS)
        return
      }
      grow(unbounded, event.clientX, event.clientY)
    }

    // A mouse that arrives while already down — the press began on a child, or on
    // the stretched ::after of a row link rather than on the row itself.
    const onEnter = (event: PointerEvent) => {
      if (event.pointerType === "touch" || event.buttons !== 1) return
      grow(unbounded, event.clientX, event.clientY)
    }

    host.addEventListener("pointerdown", onDown)
    host.addEventListener("pointerenter", onEnter)
    host.addEventListener("pointerup", settle)
    host.addEventListener("pointercancel", settle)
    host.addEventListener("pointerleave", settle)

    return () => {
      host.removeEventListener("pointerdown", onDown)
      host.removeEventListener("pointerenter", onEnter)
      host.removeEventListener("pointerup", settle)
      host.removeEventListener("pointercancel", settle)
      host.removeEventListener("pointerleave", settle)
    }
  }, [unbounded])

  return ref
}
