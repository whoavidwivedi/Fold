"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes"

import { DEFAULT_PALETTE, PALETTES, type PaletteId } from "@/components/theme-picker"

/**
 * The palette axis, alongside `next-themes`' light/dark.
 *
 * Six numbers live in CSS as `--seed-*`; this only flips which six. It is deliberately
 * not `next-themes`' `theme`: that attribute is `class`, and the palette needs
 * `data-theme` so the two are independent and a dark Oxblood needs no second declaration.
 */
const PaletteContext = React.createContext<{
  palette: PaletteId
  setPalette: (id: PaletteId) => void
}>({ palette: DEFAULT_PALETTE, setPalette: () => {} })

function usePalette() {
  return React.useContext(PaletteContext)
}

/** Runs before paint so a saved palette is never one frame of the wrong colours. */
const paletteScript = `try{var p=localStorage.getItem("fold-palette");if(p)document.documentElement.dataset.theme=p}catch(e){}`

function PaletteProvider({ children }: { children: React.ReactNode }) {
  const [palette, setPaletteState] = React.useState<PaletteId>(() => {
    if (typeof document === "undefined") return DEFAULT_PALETTE
    const saved = document.documentElement.dataset.theme
    return PALETTES.some((p) => p.id === saved) ? (saved as PaletteId) : DEFAULT_PALETTE
  })
  const setPalette = React.useCallback((id: PaletteId) => {
    document.documentElement.dataset.theme = id
    try {
      localStorage.setItem("fold-palette", id)
    } catch {
      // See above — a reload will forget it, nothing more.
    }
    setPaletteState(id)
  }, [])

  return (
    <PaletteContext.Provider value={{ palette, setPalette }}>
      <script dangerouslySetInnerHTML={{ __html: paletteScript }} />
      {children}
    </PaletteContext.Provider>
  )
}

function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      <PaletteProvider>
        <ThemeHotkey />
        {children}
      </PaletteProvider>
    </NextThemesProvider>
  )
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  )
}

function ThemeHotkey() {
  const { resolvedTheme, setTheme } = useTheme()

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat) {
        return
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      if (event.key.toLowerCase() !== "d") {
        return
      }

      if (isTypingTarget(event.target)) {
        return
      }

      setTheme(resolvedTheme === "dark" ? "light" : "dark")
    }

    window.addEventListener("keydown", onKeyDown)

    return () => {
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [resolvedTheme, setTheme])

  return null
}

export { ThemeProvider, usePalette }
