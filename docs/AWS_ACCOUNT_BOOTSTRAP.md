# AWS Account + Domain Bootstrap (ScoutLane)

> Step-by-step runbook to stand up an AWS account, register the ScoutLane domain through Route 53,
> point it at the current Vercel deployment, and (when M4 emails go live) wire domain email via SES.
> Do the phases **in order** — each step's prerequisite is set up by the one before it.
>
> **Why AWS now:** AWS is ScoutLane's planned production home (ECS Fargate — see
> `docs/reviews/2026-06-29-ecs-fargate-target-state.md`), so registering the domain in Route 53 keeps
> the domain + DNS in the account that will eventually host the app. A domain is portable, though —
> it can point at Vercel today and at AWS later by editing DNS records; there's no lock-in either way.
>
> **Not legal/tax advice.** Costs are approximate — confirm live pricing in the console.

---

## Domain decision (settled): `scoutlane.app`

- **Registering `scoutlane.app`** (~$20/yr, available to register directly in Route 53). It keeps the
  exact brand name "ScoutLane" intact, and `.app` is on the HSTS preload list → browsers **always**
  force HTTPS (fine — Vercel/ACM issue TLS automatically; you just never serve plain HTTP).
- **`scoutlane.com` is deferred — not bought.** The exact `.com` is a **premium aftermarket listing
  (~$3,099 via GoDaddy/Afternic)**, not a normal registration. Not worth that spend before demand is
  validated (M5). Because domains are portable, we can **upgrade to `scoutlane.com` later** (buy it,
  then re-point DNS / 301-redirect) if the product takes off — nothing here has to change but the
  records.
- Optional later: once on `.com`, keep `scoutlane.app` as a 301-redirect to it.

---

## Before you start — have ready
- A **durable email** you control for the AWS root account — ideally a shared alias (e.g.
  `aws@…` or `scoutlane.aws@gmail.com`), **not** a personal inbox, so ownership transfers cleanly.
- A **payment card** and **phone** (AWS verifies both at signup).
- The domain: **`scoutlane.app`** (per the decision above).
- Access to the **Vercel project** (`scout-lane`) and the **Supabase** project (for auth URLs + SMTP).
- ~45–60 minutes.

---

## Phase 1 — Create the AWS account + lock it down (do first)

> An AWS account left mostly idle until the ECS migration must still be **secured now** — an
> unsecured root account is the real risk, not the dormancy.

1. **Create the account** at <https://aws.amazon.com> → "Create an AWS Account". Use the durable
   email above. Choose **Personal** (or Business) account type; complete card + phone verification.
2. **Enable MFA on the root user immediately.** Console → top-right account menu → **Security
   credentials** → **Multi-factor authentication (MFA)** → assign an authenticator app or passkey.
3. **Do not create root access keys.** Root is for account-level tasks only; you'll use an admin
   identity (next step) day-to-day.
4. **Set alternate contacts.** Account → **Alternate Contacts** → add Billing + Security contacts.
5. **Create an admin via IAM Identity Center** (the modern replacement for IAM users):
   - Console → **IAM Identity Center** → **Enable**.
   - **Users** → add a user (you) → verify email.
   - **Permission sets** → create one using the AWS-managed **AdministratorAccess** policy.
   - **AWS accounts** → select your account → assign your user the AdministratorAccess permission set.
   - From now on, sign in via the Identity Center **access portal URL** — not root.
6. **Set a budget alarm** so nothing can surprise you: **Billing and Cost Management** → **Budgets**
   → create a cost budget (e.g. alert at **$5** and **$25**/month) emailed to you.

**Phase 1 done when:** root has MFA + no access keys, you can sign in as an IAM Identity Center admin,
and a budget alert exists.

---

## Phase 2 — Register `scoutlane.app` in Route 53

1. Sign in as your **admin** identity. Go to **Route 53** → **Registered domains** → **Register
   domains**.
2. Search **`scoutlane.app`**, add it to the cart, and confirm the **annual price** (≈ **$20/yr** —
   confirm in-console; TLDs vary).
3. Fill in registrant contact details. **Enable privacy protection** (free — hides your personal info
   from public WHOIS).
4. **Enable auto-renew** (so the domain can't lapse).
5. Complete the order. Registration can take minutes to a few hours; you'll get an email — you may
   need to **verify the registrant email** (check spam) or the domain can be suspended.
6. Registration **auto-creates a public hosted zone** for the domain (this is where DNS records live).
   A hosted zone costs **~$0.50/month** + small per-query charges.

**Phase 2 done when:** `scoutlane.app` shows under **Registered domains** and a **hosted zone** exists
for it under Route 53 → **Hosted zones**.

---

## Phase 3 — Point the domain at Vercel (current host)

> The app runs on Vercel today. You'll add the records Vercel gives you into the Route 53 hosted zone.
> (When you migrate to ECS later, you'll change these records to point at CloudFront/ALB instead —
> same hosted zone, different records.)

1. In **Vercel** → project **scout-lane** → **Settings → Domains** → **Add** `scoutlane.app` (add both
   the apex `scoutlane.app` and `www.scoutlane.app`). Vercel shows the **exact DNS records to create**.
   - Use the values Vercel prints (or run `vercel domains inspect scoutlane.app`). Vercel now issues
     per-project records (e.g. `xyz.vercel-dns-016.com`); the legacy values (`A 76.76.21.21`,
     `CNAME cname.vercel-dns.com`) still work but prefer what the dashboard shows.
   - The **apex** (`@`) must be an **A** (or ALIAS) record — a CNAME at the apex violates DNS rules.
     `www` is typically a **CNAME**.
2. In **Route 53** → your **hosted zone** → **Create record** for each value Vercel gave you:
   - Apex: type **A**, name blank (`@`), value = Vercel's apex IP/target.
   - `www`: type **CNAME**, value = `cname.vercel-dns.com` (or what Vercel shows).
3. Wait for DNS to propagate (minutes to ~1 hour). Vercel auto-issues the **TLS certificate** once the
   records resolve; the domain flips to **Valid Configuration** in the Vercel dashboard.

**Phase 3 done when:** `https://scoutlane.app` loads the ScoutLane landing with a valid certificate.

> **Registrar vs. nameservers:** because you registered *in* Route 53, the domain's nameservers
> already point at its Route 53 hosted zone, so adding records in that zone is all you need. (If you'd
> registered elsewhere, you'd instead point that registrar's nameservers at Route 53's four NS records.)

---

## Phase 4 — Update auth + OAuth to the new domain

Once the domain serves the app, repoint authentication so sign-in works on the real URL:

1. **Supabase** → **Authentication → URL Configuration**:
   - Set **Site URL** to `https://scoutlane.app`.
   - Add `https://scoutlane.app/**` (and `https://www.scoutlane.app/**` if used) to **Redirect URLs**.
2. **Google OAuth** (Google Cloud Console → the OAuth client):
   - **Authorized JavaScript origins:** `https://scoutlane.app`
   - **Authorized redirect URIs:** `https://scoutlane.app/auth/callback`
3. **Vercel env** — if any `NEXT_PUBLIC_*` var hardcodes the site URL, update it and redeploy.
   (ScoutLane derives the callback origin at runtime, so this is usually just the auth URLs above —
   double-check after deploy.)

**Phase 4 done when:** magic-link **and** Google sign-in both complete on `https://scoutlane.app`.

---

## Phase 5 — Domain email via Amazon SES (before inviting real users / M5)

> Magic-link sign-in + waitlist confirmations deliver far better from your own domain. Since you're in
> AWS, use **SES** as Supabase's custom SMTP. **Start this early — SES production access takes ~24h.**

1. **SES** → **Verified identities** → **Create identity** → **Domain** → `scoutlane.app`.
   - SES generates **DKIM** CNAME records (and recommends SPF + DMARC). Add all of them to the Route 53
     hosted zone:
     - **DKIM:** the 3 CNAMEs SES provides.
     - **SPF:** a TXT on the sending subdomain, e.g. `v=spf1 include:amazonses.com ~all`.
     - **DMARC:** a TXT at `_dmarc.scoutlane.app`, e.g. `v=DMARC1; p=none; rua=mailto:dmarc@scoutlane.app`.
   - Wait until SES shows the identity **Verified** + DKIM **successful**.
2. **Request production access:** SES → **Account dashboard** → **Request production access**. New
   accounts are in a **sandbox** (≤200 emails/day, only to *verified* recipients). Choose
   **Transactional**, describe the use (auth/magic-link + waitlist invites). Approval is usually ~24h
   and now **requires SPF/DKIM/DMARC already in place** (step 1).
3. **Create SMTP credentials:** SES → **SMTP settings** → **Create SMTP credentials** (this makes a
   scoped IAM user). Note the **SMTP endpoint** (e.g. `email-smtp.us-east-1.amazonaws.com`), username,
   and password.
4. **Point Supabase at SES:** Supabase → **Project Settings → Authentication → SMTP Settings** →
   enable **Custom SMTP**; set sender (`no-reply@scoutlane.app`), host (the SES endpoint), port `587`,
   and the SMTP username/password. Send a test.

**Phase 5 done when:** SES is **out of sandbox**, DKIM/SPF/DMARC verify, and a Supabase test email
arrives from `@scoutlane.app` (not in spam).

---

## Cost summary (approximate)
| Item | Cost |
| --- | --- |
| Domain registration (`scoutlane.app`) | ~$20/yr |
| Route 53 hosted zone | ~$0.50/month + ~$0.40 per million queries |
| SES | $0 in sandbox; ~$0.10 per 1,000 emails in production |
| AWS account / IAM Identity Center / Budgets | $0 |
| _(deferred)_ `scoutlane.com` premium | ~$3,099 one-time — revisit post-launch |

At pre-launch scale this is a few dollars a month, dominated by the hosted zone.

---

## Troubleshooting
- **Domain registered but site won't load:** DNS can take up to an hour. Confirm the apex **A** record
  and `www` **CNAME** in the hosted zone match exactly what Vercel shows; check Vercel marks the domain
  **Valid Configuration**.
- **Cert stuck / "Invalid Configuration" in Vercel:** usually a wrong/missing apex record or a stray
  CAA record blocking issuance. Remove conflicting records; let Vercel re-verify.
- **Magic links land in spam / don't arrive:** finish Phase 5 (SES out of sandbox + DKIM/SPF/DMARC).
  In the sandbox, SES only sends to *verified* addresses — verify your own email to test before
  production access is granted.
- **Sign-in redirect errors after switching domains:** a redirect URL not on the Supabase allow-list,
  or a stale Google OAuth redirect URI. Re-check Phase 4.

## When the ECS migration happens
You won't re-register anything — you'll just **change the Route 53 records** from Vercel's targets to
an **ALIAS** record pointing at the CloudFront distribution / ALB, and issue the cert via **ACM**. The
domain, hosted zone, SES setup, and account hygiene all carry over unchanged. See
`docs/reviews/2026-06-29-ecs-fargate-target-state.md`.
