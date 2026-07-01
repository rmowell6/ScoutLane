'use client'

// Per-packet feedback (M4-C), captures two of the three Phase-0 thresholds directly in-product:
//   • "Would you actually send this?"  → packet_rated  (the ~50% quality bar)
//   • "Would you pay for ScoutLane?"   → would_pay      (the ~30% willingness-to-pay bar)
// The pay question is revealed only after the quality answer, so we never ask for money before the
// user has judged the output. Remounted per packet (keyed on the generation id), so each result
// gets its own prompt. All tracking no-ops until PostHog is configured.
import { useState } from 'react'
import { track, EVENTS } from '@/lib/analytics'

type YesNo = 'yes' | 'no'

export default function PacketFeedback() {
  const [rated, setRated] = useState<YesNo | null>(null)
  const [paid, setPaid] = useState<YesNo | null>(null)

  function rate(value: YesNo) {
    setRated(value)
    track(EVENTS.packetRated, { value })
  }

  function pay(value: YesNo) {
    setPaid(value)
    track(EVENTS.wouldPay, { value })
  }

  return (
    <section style={styles.panel} aria-label="Packet feedback">
      <div style={styles.row}>
        <span style={styles.q}>Would you actually send this packet?</span>
        <div style={styles.btns}>
          <button
            type="button"
            onClick={() => rate('yes')}
            aria-pressed={rated === 'yes'}
            style={rated === 'yes' ? styles.choiceOn : styles.choice}
            disabled={rated !== null}
          >
            Yes, I’d send it
          </button>
          <button
            type="button"
            onClick={() => rate('no')}
            aria-pressed={rated === 'no'}
            style={rated === 'no' ? styles.choiceOn : styles.choice}
            disabled={rated !== null}
          >
            Not yet
          </button>
        </div>
      </div>

      {rated !== null && paid === null && (
        <div style={styles.row}>
          <span style={styles.q}>Would you pay for ScoutLane?</span>
          <div style={styles.btns}>
            <button type="button" onClick={() => pay('yes')} style={styles.choice}>
              Yes
            </button>
            <button type="button" onClick={() => pay('no')} style={styles.choice}>
              No
            </button>
          </div>
        </div>
      )}

      {paid !== null && <p style={styles.thanks}>Thanks, your feedback helps us improve ScoutLane.</p>}
    </section>
  )
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    marginTop: '1.5rem',
    padding: '1rem 1.25rem',
    border: '1px solid #e3e7ec',
    borderRadius: 12,
    background: '#fafbfc',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  },
  row: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem' },
  q: { fontWeight: 600, color: '#1a1a1a', fontSize: '0.95rem' },
  btns: { display: 'flex', gap: '0.5rem' },
  choice: {
    padding: '0.45rem 0.9rem',
    borderRadius: 8,
    border: '1px solid #d2d7de',
    background: '#fff',
    color: '#1f3a5f',
    fontWeight: 600,
    fontSize: '0.85rem',
    cursor: 'pointer',
  },
  choiceOn: {
    padding: '0.45rem 0.9rem',
    borderRadius: 8,
    border: '1px solid #1f3a5f',
    background: '#1f3a5f',
    color: '#fff',
    fontWeight: 600,
    fontSize: '0.85rem',
    cursor: 'default',
  },
  thanks: { margin: 0, color: '#5b6470', fontSize: '0.9rem' },
}
