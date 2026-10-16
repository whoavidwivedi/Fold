"use client"

import * as React from "react"
import { RiCheckLine, RiPaletteLine } from "@remixicon/react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { usePalette } from "@/components/theme-provider"

/**
 * The palette picker.
 *
 * Light/dark is `next-themes` and has been here since the start. The palette is the
 * other axis — the actual colours — and it is a separate attribute on purpose. Merging
 * them into one `theme` value would make every theme a light and a dark variant
 * declared together, which is forty roles times two times six themes, and the reason
 * themes drift out of step with each other.
 */
export function ThemePicker() {
  const { palette, setPalette } = usePalette()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="icon-sm" aria-label="Theme">
            <RiPaletteLine data-icon="inline-start" aria-hidden />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Palette</DropdownMenuLabel>
          {PALETTES.map((p) => (
            <DropdownMenuItem key={p.id} onClick={() => setPalette(p.id)}>
              {/* The swatch is the primary and the accent side by side, which are the two
                  colours you actually judge a palette by. */}
              <span
                aria-hidden
                className="t-swatch size-4 rounded-full before:absolute before:inset-0"
                style={{ position: "relative", overflow: "hidden" }}
              />
              {p.name}
              {palette === p.id ? (
                <RiCheckLine data-icon="inline-end" aria-hidden />
              ) : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export const PALETTES = [
  { id: "royal", name: "Royal" },
  { id: "oxblood", name: "Oxblood" },
  { id: "forest", name: "Forest" },
  { id: "slate", name: "Slate" },
  { id: "plum", name: "Plum" },
  { id: "clay", name: "Clay" },
] as const

export type PaletteId = (typeof PALETTES)[number]["id"]

export const DEFAULT_PALETTE: PaletteId = "royal"
