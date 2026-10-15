"use client"

import { useQueryClient } from "@tanstack/react-query"
import { createContext, useContext, useEffect, useRef, useState } from "react"

import { getToken } from "@/lib/api/token"

/**
 * One EventSource for the whole application.
 *
 * This is the single most important performance rule in the CRM: the stream is a module
 * singleton, not something a component opens. Fifty table cells each opening their own
 * EventSource means fifty sockets, fifty reconnects, and a server that quietly melts.
 *
 * The connection refetches nothing by itself. It invalidates query keys, and the
 * components that care refetch through their own hooks. That keeps one source of truth
 * for cache shape.
 *
 * Token handling: EventSource cannot send an Authorization header, so we mint a
 * 60-second workspace-scoped token from the Go API and pass it as a query parameter.
 * When it expires the stream errors, and we re-mint and reconnect.
 */

export type RealtimeStatus = "connecting" | "live" | "offline"

/**
 * The reason the stream is not live, in plain words.
 *
 * "Offline" with no explanation cost an hour of debugging a three-line bug. The badge
 * surfaces this in its tooltip, so the next occurrence is a hover away from an answer.
 */
type RealtimeContextValue = {
  status: RealtimeStatus
  reason: string | null
}

const RealtimeContext = createContext<RealtimeContextValue>({
  status: "offline",
  reason: "not connected",
})

export function useRealtime() {
  return useContext(RealtimeContext)
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080"

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<RealtimeStatus>("connecting")
  const [reason, setReason] = useState<string | null>(null)

  // Refs, not state: the source must not be recreated when the status flips, or every
  // status change would drop and reopen the stream.
  const sourceRef = useRef<EventSource | null>(null)
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attemptRef = useRef(0)

  useEffect(() => {
    let cancelled = false

    async function connect() {
      if (cancelled) return

      try {
        setStatus("connecting")

        const jwt = await getToken()
        if (!jwt) {
          // No token yet — the session may still be hydrating. Retry rather than give
          // up: returning here with no scheduled reconnect left realtime dead until the
          // user reloaded the page.
          throw new Error("no API token yet")
        }
        if (cancelled) return

        const res = await fetch(`${API_URL}/v1/realtime/token`, {
          method: "POST",
          headers: { Authorization: `Bearer ${jwt}` },
        })
        if (!res.ok) throw new Error(`stream token rejected: ${res.status}`)

        const { token } = (await res.json()) as { token: string }
        if (cancelled) return

        sourceRef.current?.close()
        const source = new EventSource(
          `${API_URL}/v1/stream?token=${encodeURIComponent(token)}`,
        )
        sourceRef.current = source

        source.onopen = () => {
          attemptRef.current = 0
          setReason(null)
          setStatus("live")
        }

        source.addEventListener("change", (event) => {
          setStatus("live")
          try {
            const { entity, id } = JSON.parse(
              (event as MessageEvent).data,
            ) as { entity: string; id: string }
            invalidate(queryClient, entity, id)
          } catch {
            // A malformed frame is not worth tearing the stream down for.
          }
        })

        source.onerror = () => {
          source.close()
          sourceRef.current = null
          if (cancelled) return

          setReason("event stream closed")
          setStatus("offline")

          // Exponential backoff, capped. The stream token expires every 60s, so a
          // healthy connection rarely retries at all.
          const delay = Math.min(1000 * 2 ** attemptRef.current++, 30_000)
          retryRef.current = setTimeout(connect, delay)
        }
      } catch (error) {
        if (cancelled) return
        setReason(error instanceof Error ? error.message : "unknown error")
        setStatus("offline")
        const delay = Math.min(1000 * 2 ** attemptRef.current++, 30_000)
        retryRef.current = setTimeout(connect, delay)
      }
    }

    connect()

    return () => {
      cancelled = true
      if (retryRef.current) clearTimeout(retryRef.current)
      sourceRef.current?.close()
      sourceRef.current = null
    }
  }, [queryClient])

  return (
    <RealtimeContext.Provider value={{ status, reason }}>
      {children}
    </RealtimeContext.Provider>
  )
}

/**
 * Invalidate what a change actually affects.
 *
 * The event carries an entity and an id, never a payload — pg_notify caps messages at
 * 8KB, so the server sends a pointer and the client refetches. See docs/adr/0004.
 *
 * List keys are invalidated without their filters, which is why useQuery calls here must
 * use a key prefix. TanStack matches on prefix by default, so ["people"] invalidates
 * ["people", { search: "..." }] too.
 */
function invalidate(
  queryClient: ReturnType<typeof useQueryClient>,
  entity: string,
  id: string,
) {
  switch (entity) {
    case "person":
      queryClient.invalidateQueries({ queryKey: ["people"] })
      queryClient.invalidateQueries({ queryKey: ["person", id] })
      break
    case "deal":
      queryClient.invalidateQueries({ queryKey: ["deals"] })
      break
    default:
      // An entity we do not know about yet. Invalidate everything rather than guess.
      queryClient.invalidateQueries()
  }
}