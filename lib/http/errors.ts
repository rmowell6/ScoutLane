// Shared HTTP error shaping. The product invariant is that a failure surfaces a SAFE step
// identifier (so the failing stage is debuggable), but the raw error message can carry internal
// detail (DB hostnames, upstream URLs, stack-adjacent text). In production we withhold the raw
// message and return a generic one; in dev/preview we keep it for debugging. The step name is a
// fixed, safe enum from our own code (e.g. 'structureResume', 'upsert'), so it's always included.
const isProd = process.env.NODE_ENV === 'production'

export interface ServerErrorBody {
  error: string
  step: string | null
  message: string
}

/**
 * Build a 500-level JSON body. `step` (a safe identifier) is always included; the raw error
 * `message` is only echoed outside production. Never pass secrets as `error`/`step`.
 */
export function serverErrorBody(err: unknown, step: string | null, error = 'Internal Server Error'): ServerErrorBody {
  const raw = err instanceof Error ? err.message : String(err)
  return { error, step, message: isProd ? 'An internal error occurred. Please try again.' : raw }
}
