"use client"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState } from "react"

import { RealtimeProvider } from "@/lib/api/realtime"

/**
 * Client-side providers.
 *
 * The QueryClient is created in state rather than at module scope so each request gets
 * its own — a shared client on the server leaks one user's cache into another's.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Realtime pushes invalidations rather than patches, so a stale window
            // between an event and a refetch is normal, not a bug.
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  )

  return (
    <QueryClientProvider client={queryClient}>
      <RealtimeProvider>{children}</RealtimeProvider>
    </QueryClientProvider>
  )
}