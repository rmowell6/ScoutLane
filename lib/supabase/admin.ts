// Server-only admin client. Uses the secret key and BYPASSES Row Level Security.
// NEVER import this into client code. See docs/ScoutLane_Engineering_Plan.md §4.3.
import { createClient } from '@supabase/supabase-js'

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!, // sb_secret_... — NOT NEXT_PUBLIC
  { auth: { autoRefreshToken: false, persistSession: false } },
)
