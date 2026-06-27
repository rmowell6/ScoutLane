// POST /api/extract — turn an uploaded resume file (PDF / DOCX / TXT) into plain text the
// user can review and feed to /api/packet. Thin handler: read the multipart body, validate,
// call the extraction service, map the result/failure to HTTP (Engineering Plan §4.1).
// runtime='nodejs' because mammoth/unpdf need Node Buffer + APIs.
import { NextResponse } from 'next/server'
import { ExtractError, MAX_RESUME_BYTES, extractResumeText } from '@/lib/services/extractResumeText'
import { serverErrorBody } from '@/lib/http/errors'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: Request) {
  try {
    let form: FormData
    try {
      form = await request.formData()
    } catch {
      return NextResponse.json(
        { error: 'Invalid request', message: 'expected multipart/form-data with a "file" field' },
        { status: 400 },
      )
    }

    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: 'Invalid request', message: 'missing "file" field' },
        { status: 400 },
      )
    }
    if (file.size > MAX_RESUME_BYTES) {
      return NextResponse.json(
        { error: 'File too large', message: `max ${MAX_RESUME_BYTES} bytes`, size: file.size },
        { status: 400 },
      )
    }

    const bytes = new Uint8Array(await file.arrayBuffer())
    const { text, kind } = await extractResumeText({
      filename: file.name,
      mimeType: file.type,
      bytes,
    })

    return NextResponse.json({ text, kind, filename: file.name, chars: text.length }, { status: 200 })
  } catch (err) {
    // Empty / over-size / unsupported file -> 400 (it's the caller's input that's wrong).
    if (err instanceof RangeError) {
      return NextResponse.json({ error: 'Invalid file', message: err.message }, { status: 400 })
    }
    if (err instanceof ExtractError) {
      // Unsupported type and empty-text are caller-fixable; a parser throw is a 500.
      if (err.step === 'detect-kind') {
        return NextResponse.json({ error: 'Unsupported file type', message: err.message }, { status: 400 })
      }
      if (err.step === 'empty-text') {
        return NextResponse.json(
          {
            error: 'No text found',
            message: 'Could not extract any text. If this is a scanned/image PDF, paste the text instead.',
          },
          { status: 422 },
        )
      }
      console.error('[extract] failed', err.step, err)
      return NextResponse.json(serverErrorBody(err, err.step, 'Extraction failed'), { status: 500 })
    }
    console.error('[extract] failed', err)
    return NextResponse.json(serverErrorBody(err, null), { status: 500 })
  }
}
