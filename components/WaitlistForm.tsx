'use client'

// Waitlist capture form for the public landing (M4-B). Posts to /api/waitlist, which is
// non-enumerating, so the success state is shown for any valid submission regardless of whether the
// email was already on the list. Self-contained inline styles (matches the sign-in page pattern) so
// it doesn't couple to the landing's CSS module.
import { useState } from 'react'

type Status = 'idle' | 'sending' | 'done' | 'error'

export default function WaitlistForm() {
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('sending')
    setMessage(null)
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), note: note.trim() || undefined }),
      })
      if (res.ok) {
        setStatus('done')
        return
      }
      if (res.status === 429) {
        setMessage('Too many requests — please try again in a minute.')
      } else if (res.status === 400) {
        setMessage('Please enter a valid email address.')
      } else {
        setMessage('Something went wrong. Please try again.')
      }
      setStatus('error')
    } catch {
      setMessage('Network error. Please try again.')
      setStatus('error')
    }
  }

  if (status === 'done') {
    return (
      <p style={styles.success} role="status">
        You’re on the list — we’ll email you when your invite is ready.
      </p>
    )
  }

  return (
    <form onSubmit={submit} style={styles.form}>
      <div style={styles.row}>
        <input
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={styles.input}
          aria-label="Email address"
        />
        <button type="submit" disabled={status === 'sending'} style={styles.button}>
          {status === 'sending' ? 'Sending…' : 'Request access'}
        </button>
      </div>
      <input
        type="text"
        placeholder="What are you hoping to use it for? (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        style={styles.noteInput}
        aria-label="Optional context"
        maxLength={500}
      />
      {message && (
        <p style={styles.error} role="alert">
          {message}
        </p>
      )}
    </form>
  )
}

const styles: Record<string, React.CSSProperties> = {
  form: { display: 'flex', flexDirection: 'column', gap: '0.6rem', maxWidth: 480, margin: '0 auto', textAlign: 'left' },
  row: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' },
  input: {
    flex: '1 1 220px',
    padding: '0.7rem 0.8rem',
    borderRadius: 8,
    border: '1px solid #d2d7de',
    fontSize: '0.95rem',
  },
  noteInput: {
    padding: '0.6rem 0.8rem',
    borderRadius: 8,
    border: '1px solid #e3e7ec',
    fontSize: '0.85rem',
    color: '#1a1a1a',
  },
  button: {
    flex: '0 0 auto',
    padding: '0.7rem 1.3rem',
    borderRadius: 8,
    border: 'none',
    background: '#1f3a5f',
    color: '#fff',
    fontWeight: 600,
    cursor: 'pointer',
  },
  success: { background: '#E8F3EC', color: '#1B5E36', padding: '0.8rem 1rem', borderRadius: 8, fontSize: '0.95rem', textAlign: 'center' },
  error: { color: '#A1232B', fontSize: '0.85rem', margin: 0 },
}
