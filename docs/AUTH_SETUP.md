# Auth Setup — ScoutLane (Phase A)

ScoutLane is **fully gated**: every page redirects to `/sign-in` and every protected API route
returns `401` until the caller has a verified session. Sign-up is **invite-only**, enforced in
Postgres. Sign-in is passwordless: **email magic link** (captcha-protected) or **Google**.

This doc is the operator checklist to turn it on. Code is already wired; these are the
dashboard/config steps + the env vars.

## Architecture (what the code does)

- `proxy.ts` (Next 16 middleware) refreshes the session with `getClaims()` and **redirects**
  unauthenticated page requests to `/sign-in`. API routes are skipped here — they self-authorize.
- `lib/auth.ts` → `requireUser()` gates the protected routes (`/api/packet`, `/api/profile`,
  `/api/discover`, `/api/extract`). It reads **verified JWT claims** (`getClaims()`), never
  `getSession()`/`getUser()`. It **fails closed**: unconfigured or unverifiable ⇒ `401`.
- `lib/supabase/client.ts` / `lib/supabase/server.ts` — the cookie-based **anon/publishable**
  clients (RLS-respecting). Distinct from `lib/supabaseServer.ts`, which uses the **secret** key and
  bypasses RLS for storage/admin work.
- `app/sign-in/page.tsx` — magic link (`signInWithOtp`) + Google (`signInWithOAuth`) + a Cloudflare
  Turnstile widget. `app/auth/callback/route.ts` exchanges the PKCE `code` for a session.
  `app/auth/sign-out/route.ts` clears it (POST).
- `supabase/migrations/0008_auth_allowlist.sql` — the `public.allowlist` table + a `BEFORE INSERT`
  trigger on `auth.users` that rejects any sign-up whose email isn't listed.

## 1. Environment variables

Browser (public — safe to expose):

| Var | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | the publishable (anon) key |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Cloudflare Turnstile **site** key |

Server only (never `NEXT_PUBLIC_`):

| Var | Value |
| --- | --- |
| `SUPABASE_SECRET_KEY` | service-role key (already used by storage/stores) |

> The Turnstile **secret** is NOT an app env var — it lives in the Supabase dashboard (native
> captcha verifies the token server-side). See step 4.

## 2. Run the migration

Apply `supabase/migrations/0008_auth_allowlist.sql` (SQL editor or `supabase db push`). Then seed at
least one invite so you can get in:

```sql
insert into public.allowlist (email, note) values ('you@example.com', 'founder')
on conflict (email) do nothing;
```

To invite someone later, insert their email. To revoke a *future* sign-up, delete it (existing
sessions are unaffected — Phase A does not revoke live sessions).

## 3. Google OAuth provider

Supabase dashboard → **Authentication → Providers → Google**: enable it and paste the OAuth client
ID/secret from a Google Cloud OAuth 2.0 Web client. In the Google client, add the Supabase callback
as an authorized redirect URI:

```
https://<project-ref>.supabase.co/auth/v1/callback
```

Supabase dashboard → **Authentication → URL Configuration**: set **Site URL** to your production
origin and add the callback to **Redirect URLs**:

```
https://<your-domain>/auth/callback
http://localhost:3000/auth/callback   # local dev
```

## 4. Turnstile (captcha)

1. Cloudflare → Turnstile → create a widget for your domain(s). Copy the **site key** (→
   `NEXT_PUBLIC_TURNSTILE_SITE_KEY`) and the **secret key**.
2. Supabase dashboard → **Authentication → Settings → Bot and Abuse Protection**: enable captcha,
   choose **Turnstile**, paste the **secret key**.

The magic-link form sends the Turnstile token with `signInWithOtp`; Supabase verifies it. If
`NEXT_PUBLIC_TURNSTILE_SITE_KEY` is unset (local dev), the captcha step is skipped.

> Google sign-in is a provider redirect, so the native captcha applies to the magic-link/OTP path;
> the OAuth path is protected by Google's own flow.

## 5. Verify

- Visit any page unauthenticated → redirected to `/sign-in`.
- `curl -X POST https://<domain>/api/packet` with no session → `401 {"error":"Unauthorized"}`.
- Sign in with an allowlisted email → reach the app. A non-allowlisted email → bounced back to
  `/sign-in?error=access_denied`.

## Phase B (not in this PR)

Stamp `user_id` on `profiles`/`generations`, add per-user RLS policies, scope `getStoredProfile` to
the owner, and re-key rate limiting by user id. Until then, stored rows are not yet per-user
isolated — keep the invite list small.
