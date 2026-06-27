import { describe, expect, test } from 'vitest'
import { htmlToText } from './html'

describe('htmlToText', () => {
  test('strips tags and decodes entities', () => {
    expect(htmlToText('<p>Build &amp; run Azure.</p>')).toBe('Build & run Azure.')
  })

  test('handles entity-escaped markup (Greenhouse content=true)', () => {
    // Greenhouse double-encodes: tags arrive as &lt;p&gt; etc.
    const escaped = '&lt;p&gt;Lead migrations.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;VMware&lt;/li&gt;&lt;/ul&gt;'
    const text = htmlToText(escaped)
    expect(text).toContain('Lead migrations.')
    expect(text).toContain('VMware')
    expect(text).not.toContain('<')
  })

  test('turns block tags into newlines and collapses whitespace', () => {
    expect(htmlToText('<li>One</li><li>Two</li>')).toBe('One\nTwo')
  })
})
