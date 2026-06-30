// Waitlist signup notification (M4 follow-up). When someone requests access on the public landing,
// email an admin so the manual invite-promotion step (see 0013_waitlist.sql) actually gets seen.
//
// Server-only and ENV-GATED + degradable, exactly like waitlistStore/analytics: with no SES env set
// this is a complete no-op, so dev/CI/preview and the signup flow behave identically until SES is
// wired. It is also NEVER-THROWS by contract — the caller schedules it via `after()` as a
// non-blocking side-effect, so a delivery failure must never fail the visitor's signup. Failures are
// logged (with a safe step id, no secrets) and swallowed.
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'

// All server-only. NEVER prefix with NEXT_PUBLIC_ (would leak AWS creds to the browser).
const REGION = process.env.AWS_REGION
const FROM = process.env.WAITLIST_NOTIFY_FROM // a verified SES sender, e.g. notify@scoutlane.app
const TO = process.env.WAITLIST_NOTIFY_TO //   the admin inbox to notify, e.g. you@example.com

/**
 * True when SES notification is fully configured. The AWS SDK reads AWS_ACCESS_KEY_ID /
 * AWS_SECRET_ACCESS_KEY from the environment itself, so we only assert the bits this module needs
 * directly: a region, a verified sender, and a recipient.
 */
export function isWaitlistNotifyConfigured(): boolean {
  return Boolean(REGION && FROM && TO)
}

// One client per warm lambda. Created lazily so importing this module never constructs AWS state
// (keeps unit tests + builds green without env).
let client: SESv2Client | null = null
function ses(): SESv2Client {
  if (!client) client = new SESv2Client({ region: REGION })
  return client
}

export interface WaitlistNotifyInput {
  email: string
  note?: string
  source?: string
}

/**
 * Email the admin about a new waitlist signup. No-op (returns false) when SES isn't configured.
 * Never throws: returns true on send, false on no-op-or-failure, so it is safe to fire from
 * `after()` without a try/catch at the call site.
 */
export async function notifyWaitlistSignup(input: WaitlistNotifyInput): Promise<boolean> {
  if (!isWaitlistNotifyConfigured()) return false
  const start = Date.now()
  try {
    // The signup fields are untrusted visitor input. They go into the email body as plain text only
    // (never HTML, never headers), so there is no injection surface — the recipient is the admin and
    // the address (TO) is fixed from env, not derived from the submission.
    const lines = [
      `New ScoutLane waitlist signup:`,
      ``,
      `Email:  ${input.email}`,
      `Source: ${input.source ?? 'unknown'}`,
      `Note:   ${input.note?.trim() || '(none)'}`,
    ]
    await ses().send(
      new SendEmailCommand({
        FromEmailAddress: FROM,
        Destination: { ToAddresses: [TO as string] },
        Content: {
          Simple: {
            Subject: { Data: `ScoutLane waitlist: ${input.email}` },
            Body: { Text: { Data: lines.join('\n') } },
          },
        },
      }),
    )
    console.log(`[waitlist-notify] step ok: send (${Date.now() - start}ms)`)
    return true
  } catch (err) {
    // Swallow — a failed notification must not affect the signup. Log a safe step id; the SDK error
    // may carry endpoint detail but never our secret key.
    console.error(`[waitlist-notify] step failed: send (${Date.now() - start}ms)`, err)
    return false
  }
}
