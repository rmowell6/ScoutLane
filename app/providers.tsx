'use client'

// Client providers mounted once at the root (M4-C). Initializes analytics and records App Router
// pageviews. Wrapping the tree here keeps the root layout a server component; `children` are still
// server-rendered and passed through untouched. Everything no-ops until PostHog is configured.
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { initAnalytics, trackPageview } from '@/lib/analytics'

export function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  useEffect(() => {
    initAnalytics()
  }, [])

  // posthog-js' SPA pageview capture is disabled (capture_pageview:false), so emit one per route.
  useEffect(() => {
    if (pathname) trackPageview(pathname)
  }, [pathname])

  return <>{children}</>
}
