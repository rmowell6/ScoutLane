// Resume file intake (M2): an uploaded PDF / DOCX / TXT -> plain text, ready for
// structureResume(). The file is untrusted third-party input, so we cap its size, dispatch
// strictly by detected kind, and never execute it. Each step is tagged + logged so a failure
// says exactly where it broke (CLAUDE.md error-handling convention).
import mammoth from 'mammoth'
import { extractText, getDocumentProxy } from 'unpdf'

export type ResumeFileKind = 'pdf' | 'docx' | 'txt'

/** Hard cap on uploaded resume size. Resumes are small; this bounds parser work + memory. */
export const MAX_RESUME_BYTES = 5 * 1024 * 1024 // 5 MB

/**
 * Hard cap on EXTRACTED text length. A small compressed upload can decompress to a huge amount of
 * text (a "zip/PDF bomb"): DOCX is a zip, and a PDF can carry pathological content streams. Capping
 * the size we accept after parsing bounds the cost of every downstream step (LLM tokens, guardrail
 * scans) regardless of how cheaply the attacker produced the bytes. Generous vs a real resume
 * (~3–10k chars) but a firm ceiling. Over-long output is truncated, not rejected, so a legitimate
 * long CV still works.
 */
export const MAX_RESUME_CHARS = 200_000

/**
 * First-bytes signatures we verify before dispatching a parser, so a file can't lie about its type
 * (e.g. a PDF renamed `.docx`, or an executable renamed `.pdf`) to reach a parser it shouldn't.
 * TXT has no signature, anything decodes as text, so it's intentionally absent and skipped.
 */
const MAGIC: Partial<Record<ResumeFileKind, readonly number[][]>> = {
  pdf: [[0x25, 0x50, 0x44, 0x46]], // "%PDF"
  docx: [[0x50, 0x4b, 0x03, 0x04], [0x50, 0x4b, 0x05, 0x06], [0x50, 0x4b, 0x07, 0x08]], // ZIP (incl. empty/spanned)
}

/** Whether `bytes` begins with one of the expected magic-byte signatures for `kind` (txt: always true). */
function hasMagic(kind: ResumeFileKind, bytes: Uint8Array): boolean {
  const sigs = MAGIC[kind]
  if (!sigs) return true // txt, no signature to check
  return sigs.some((sig) => sig.every((byte, i) => bytes[i] === byte))
}

/** Carries which extraction step failed, so the route can report it without log-diving. */
export class ExtractError extends Error {
  constructor(
    readonly step: string,
    override readonly cause: unknown,
  ) {
    super(`extract step '${step}' failed: ${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = 'ExtractError'
  }
}

const BY_EXTENSION: Record<string, ResumeFileKind> = {
  pdf: 'pdf',
  docx: 'docx',
  txt: 'txt',
  text: 'txt',
}

const BY_MIME: Record<string, ResumeFileKind> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'txt',
}

/**
 * Decide how to parse a file. Prefer the filename extension (reliable), fall back to the
 * declared MIME type. Returns null for anything we don't support (caller maps to a 400).
 * Legacy .doc (binary Word) is intentionally unsupported, it needs a different parser.
 */
export function detectKind(filename: string, mimeType: string): ResumeFileKind | null {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return BY_EXTENSION[ext] ?? BY_MIME[mimeType.toLowerCase()] ?? null
}

async function runStep<T>(step: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now()
  try {
    const result = await fn()
    console.log(`[extract] step ok: ${step} (${Date.now() - start}ms)`)
    return result
  } catch (err) {
    console.error(`[extract] step failed: ${step} (${Date.now() - start}ms)`, err)
    throw new ExtractError(step, err)
  }
}

async function fromPdf(bytes: Uint8Array): Promise<string> {
  const proxy = await getDocumentProxy(bytes)
  const { text } = await extractText(proxy, { mergePages: true })
  return text
}

async function fromDocx(bytes: Uint8Array): Promise<string> {
  // mammoth wants a Node Buffer; this route runs under runtime='nodejs'.
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) })
  return value
}

function fromTxt(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes)
}

/** Collapse parser whitespace artifacts while preserving line/paragraph structure. */
function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export interface ExtractResult {
  text: string
  kind: ResumeFileKind
}

/**
 * Extract plain text from an uploaded resume file. Throws:
 *  - RangeError for an empty or over-size file (caller -> 400),
 *  - ExtractError(step) when a parser throws (caller -> 500 with the step),
 *  - ExtractError('empty-text') when parsing yields no usable text (caller -> 422).
 */
export async function extractResumeText(input: {
  filename: string
  mimeType: string
  bytes: Uint8Array
}): Promise<ExtractResult> {
  const { filename, mimeType, bytes } = input

  if (bytes.byteLength === 0) throw new RangeError('uploaded file is empty')
  if (bytes.byteLength > MAX_RESUME_BYTES) {
    throw new RangeError(`file exceeds ${MAX_RESUME_BYTES} byte limit`)
  }

  const kind = detectKind(filename, mimeType)
  if (!kind) throw new ExtractError('detect-kind', new Error(`unsupported file type: ${filename} (${mimeType})`))

  // Content must match the claimed kind: a mislabeled file (PDF renamed .docx, binary renamed .pdf)
  // is rejected before it ever reaches a parser, closing a type-confusion vector on untrusted input.
  if (!hasMagic(kind, bytes)) {
    throw new ExtractError('verify-magic', new Error(`file content does not match ${kind} (bad signature)`))
  }

  const raw = await runStep(`parse-${kind}`, async () => {
    switch (kind) {
      case 'pdf':
        return fromPdf(bytes)
      case 'docx':
        return fromDocx(bytes)
      case 'txt':
        return fromTxt(bytes)
    }
  })

  // Cap BEFORE tidy() so a decompression bomb can't blow up regex work on a huge string first.
  const bounded = raw.length > MAX_RESUME_CHARS ? raw.slice(0, MAX_RESUME_CHARS) : raw
  if (bounded.length < raw.length) {
    console.warn(`[extract] output truncated to ${MAX_RESUME_CHARS} chars (was ${raw.length})`)
  }

  const text = tidy(bounded)
  if (text.length === 0) throw new ExtractError('empty-text', new Error('no extractable text in file'))

  return { text, kind }
}
