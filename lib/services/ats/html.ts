// Minimal HTML -> plain text for ATS descriptions (Greenhouse/Ashby return HTML, and Greenhouse's
// content=true is entity-escaped). We don't need fidelity: the text is handed to parseJob (an LLM
// step) downstream. Keep it dependency-free.
//
// Order matters: decode entities FIRST so escaped markup (&lt;p&gt;) becomes real tags we can
// strip, then drop tags, then tidy whitespace.
const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
}

export function htmlToText(html: string): string {
  return html
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))) // numeric entities
    .replace(/&[a-z]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m) // named entities
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6])\s*>/gi, '\n') // block-ish tags -> newline
    .replace(/<[^>]+>/g, '') // drop remaining tags
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
