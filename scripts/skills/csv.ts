// Minimal RFC 4180 CSV parser (no dependency, so this one-off data script adds nothing to the app).
// Handles quoted fields, escaped quotes (""), and embedded commas / newlines. Sufficient for the
// O*NET export, which is four simple columns but can quote a field that contains a comma.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  // Strip a UTF-8 BOM if present so the first header cell is clean.
  let src = text
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1)

  for (let i = 0; i < src.length; i++) {
    const c = src.charAt(i)
    if (inQuotes) {
      if (c === '"') {
        if (src.charAt(i + 1) === '"') {
          field += '"'
          i++ // consume the escaped quote
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
      continue
    }
    if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (c === '\r') {
      // ignore, the \n branch closes the row (handles CRLF and lone LF)
    } else {
      field += c
    }
  }
  // Flush the trailing field/row when the file does not end in a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/** Parse into header-keyed objects. Blank trailing lines (a single empty cell) are dropped. */
export function parseCsvObjects(text: string): Record<string, string>[] {
  const rows = parseCsv(text)
  const header = rows[0]
  if (!header) return []
  return rows
    .slice(1)
    .filter((r) => !(r.length === 1 && r[0] === ''))
    .map((r) => {
      const obj: Record<string, string> = {}
      header.forEach((h, i) => {
        obj[h] = r[i] ?? ''
      })
      return obj
    })
}
