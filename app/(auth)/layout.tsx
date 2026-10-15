import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Sign in · Fold",
  description: "Lead management for teams that move fast.",
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-svh place-items-center px-4">
      <div className="flex w-full max-w-sm flex-col items-center gap-6">
        {children}

        <Link href="/" className="text-muted-foreground text-sm hover:text-foreground">
          ← Back
        </Link>
      </div>
    </main>
  )
}