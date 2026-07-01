'use client'

// Sign-in page, the auth boundary. Two passwordless methods (Engineering Plan §4.3):
//   1. Email magic link  (signInWithOtp), gated by a Cloudflare Turnstile captcha token
//   2. Continue with Google (signInWithOAuth)
// Sign-UP is restricted to an invite allowlist enforced in Postgres (migration 0008): a non-listed
// email gets a clean "not invited" outcome on its first sign-in attempt. Captcha is verified by
// Supabase's NATIVE captcha (the Turnstile SECRET lives in the Supabase dashboard, not in this app),
// so the only client-side config is the public site key. If the site key is unset (local dev),
// captcha is skipped.
import { useCallback, useRef, useState, useSyncExternalStore } from 'react'
import Script from 'next/script'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

// Minimal typing for the Cloudflare Turnstile global (loaded via <Script>).
interface TurnstileApi {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string
      callback: (token: string) => void
      'expired-callback'?: () => void
      'error-callback'?: () => void
    },
  ) => string
  reset: (id?: string) => void
}
declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

const ERROR_MESSAGES: Record<string, string> = {
  access_denied: 'That sign-in was cancelled or your email is not on the invite list.',
  missing_code: 'Sign-in link was incomplete. Please request a new one.',
  exchange_failed: 'We could not complete sign-in. Please try again.',
  callback_failed: 'Something went wrong finishing sign-in. Please try again.',
}

export default function SignInPage() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle')
  // Surface a callback error passed back as ?error=. Read it via useSyncExternalStore so the value
  // is null on the SERVER snapshot and on the client's first (hydration) render, eliminating the
  // hydration mismatch a window.location read in a lazy useState initializer would cause when
  // ?error= is present. The URL doesn't change while mounted, so the subscribe is a no-op.
  const urlError = useSyncExternalStore(
    () => () => {},
    () => {
      const code = new URLSearchParams(window.location.search).get('error')
      return code ? (ERROR_MESSAGES[code] ?? 'Sign-in failed. Please try again.') : null
    },
    () => null,
  )
  // `override` lets the action handlers set/clear their own message on top of the URL-derived one
  // (undefined = no override → show the URL error). Keeps the setError(...) call sites unchanged.
  const [override, setOverride] = useState<string | null | undefined>(undefined)
  const error = override !== undefined ? override : urlError
  const setError = (msg: string | null) => setOverride(msg)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const turnstileEl = useRef<HTMLDivElement>(null)
  const widgetId = useRef<string | undefined>(undefined)

  const renderTurnstile = useCallback(() => {
    if (!SITE_KEY || !turnstileEl.current || !window.turnstile || widgetId.current) return
    widgetId.current = window.turnstile.render(turnstileEl.current, {
      sitekey: SITE_KEY,
      callback: (token) => setCaptchaToken(token),
      'expired-callback': () => setCaptchaToken(null),
      'error-callback': () => setCaptchaToken(null),
    })
  }, [])

  const redirectTo = () =>
    typeof window !== 'undefined' ? `${window.location.origin}/auth/callback` : undefined

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (SITE_KEY && !captchaToken) {
      setError('Please complete the captcha first.')
      return
    }
    setStatus('sending')
    try {
      const supabase = createSupabaseBrowserClient()
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: redirectTo(),
          ...(captchaToken ? { captchaToken } : {}),
        },
      })
      if (error) throw error
      setStatus('sent')
    } catch (err) {
      console.error('[sign-in] magic link failed', err)
      setError('Could not send the sign-in link. Check the address and try again.')
      setStatus('idle')
      // A used Turnstile token is single-use, reset so the next attempt gets a fresh one.
      if (window.turnstile && widgetId.current) {
        window.turnstile.reset(widgetId.current)
        setCaptchaToken(null)
      }
    }
  }

  async function signInWithGoogle() {
    setError(null)
    try {
      const supabase = createSupabaseBrowserClient()
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: redirectTo() },
      })
      if (error) throw error
      // On success the browser is redirected to Google; nothing further runs here.
    } catch (err) {
      console.error('[sign-in] google oauth failed', err)
      setError('Could not start Google sign-in. Please try again.')
    }
  }

  return (
    <main style={styles.main}>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onLoad={renderTurnstile}
      />
      <div style={styles.card}>
        <div style={styles.wordmark}>
          <span style={styles.wordmarkScout}>Scout</span>Lane
        </div>
        <h1 style={styles.title}>Sign in to ScoutLane</h1>
        <p style={styles.subtitle}>Access is invite-only. Use the email you were invited with.</p>

        {error && <p style={styles.error}>{error}</p>}

        {status === 'sent' ? (
          <p style={styles.sent}>
            Check your inbox. We sent a sign-in link to <strong>{email}</strong>.
          </p>
        ) : (
          <form onSubmit={sendMagicLink} style={styles.form}>
            <label htmlFor="email" style={styles.label}>
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={styles.input}
            />
            {SITE_KEY && <div ref={turnstileEl} style={styles.turnstile} />}
            <button type="submit" disabled={status === 'sending'} style={styles.primaryBtn}>
              {status === 'sending' ? 'Sending…' : 'Send magic link'}
            </button>
          </form>
        )}

        <div style={styles.divider}>or</div>

        <button type="button" onClick={signInWithGoogle} style={styles.googleBtn}>
          Continue with Google
        </button>
      </div>
    </main>
  )
}

// Inline styles keep the auth boundary self-contained (no new global CSS); matches the POC's
// lightweight UI footprint.
// "Signal" palette, warm off-white + forest green, matching the marketing site + app reskin.
const styles: Record<string, React.CSSProperties> = {
  main: { minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '2rem', background: '#F5F3EF', color: '#111827' },
  card: { width: '100%', maxWidth: 400, background: '#fff', border: '1px solid #E1DAD1', borderRadius: 16, padding: '2rem', boxShadow: '0 4px 24px rgba(6,95,70,0.06)' },
  wordmark: { fontSize: '1.05rem', fontWeight: 800, letterSpacing: '-0.4px', color: '#111827', marginBottom: '1rem' },
  wordmarkScout: { color: '#065F46' },
  title: { margin: '0 0 0.5rem', fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.02em', color: '#111827' },
  subtitle: { margin: '0 0 1.25rem', fontSize: '0.9rem', color: '#4B5563' },
  form: { display: 'flex', flexDirection: 'column', gap: '0.6rem' },
  label: { fontSize: '0.8rem', fontWeight: 600, color: '#111827' },
  input: { padding: '0.7rem 0.85rem', borderRadius: 8, border: '1.5px solid #E1DAD1', background: '#fff', color: '#111827', fontSize: '0.95rem' },
  turnstile: { minHeight: 65 },
  primaryBtn: { padding: '0.7rem', borderRadius: 8, border: 'none', background: '#065F46', color: '#fff', fontWeight: 700, cursor: 'pointer' },
  googleBtn: { width: '100%', padding: '0.7rem', borderRadius: 8, border: '1.5px solid #E1DAD1', background: '#fff', color: '#111827', fontWeight: 600, cursor: 'pointer' },
  divider: { textAlign: 'center', margin: '1rem 0', color: '#9AA2AD', fontSize: '0.8rem' },
  error: { background: '#FEF2F2', color: '#991B1B', border: '1px solid #FECACA', padding: '0.6rem 0.75rem', borderRadius: 8, fontSize: '0.85rem', margin: '0 0 1rem' },
  sent: { background: '#ECFDF5', color: '#065F46', border: '1px solid #6EE7B7', padding: '0.85rem', borderRadius: 8, fontSize: '0.9rem' },
}
