// Shared Zod schemas for the packet pipeline. Types are derived with z.infer so the
// schema is the single source of truth (CLAUDE.md conventions). Validate every external
// boundary with safeParse; LLM steps return data via these schemas (Engineering Plan §3/§4.5).
import * as z from 'zod'

// ---- Profile (structured resume) -------------------------------------------------

export const RoleSchema = z.object({
  company: z.string(),
  title: z.string(),
  startDate: z.string(),
  endDate: z.string().nullable().optional(),
  bullets: z.array(z.string()),
})
export type Role = z.infer<typeof RoleSchema>

export const EducationSchema = z.object({
  school: z.string(),
  degree: z.string(),
  field: z.string().optional(),
  year: z.string().optional(),
})
export type Education = z.infer<typeof EducationSchema>

export const ProfileSchema = z.object({
  name: z.string(),
  summary: z.string(),
  skills: z.array(z.string()),
  roles: z.array(RoleSchema),
  certs: z.array(z.string()),
  education: z.array(EducationSchema),
})
export type Profile = z.infer<typeof ProfileSchema>

// ---- Job requirements (parsed JD) ------------------------------------------------

export const JobReqsSchema = z.object({
  title: z.string().optional(),
  company: z.string().optional(),
  mustHave: z.array(z.string()),
  niceToHave: z.array(z.string()),
  comp: z.string().optional(),
  location: z.string().optional(),
  employerType: z.string().optional(),
})
export type JobReqs = z.infer<typeof JobReqsSchema>

// ---- Fit score -------------------------------------------------------------------
// Numeric RANGE checks live in code (clampScores), not the schema: the structured-output
// transform can drop JSON-Schema keywords like minimum/maximum (Engineering Plan §4.5).

export const SubScoreSchema = z.object({
  label: z.string(),
  score: z.number(),
  note: z.string(),
})
export type SubScore = z.infer<typeof SubScoreSchema>

export const FitScoreSchema = z.object({
  overall: z.number(),
  subs: z.array(SubScoreSchema),
  reasonCodes: z.array(z.string()),
})
export type FitScore = z.infer<typeof FitScoreSchema>

// ---- Tailored content ------------------------------------------------------------
// Every claim references a profile fact id so the no-fabrication guardrail can trace it
// back to a source fact. factId === null means "no source" -> rejected by guardrails.

export const ClaimSchema = z.object({
  text: z.string(),
  factId: z.string().nullable(),
})
export type Claim = z.infer<typeof ClaimSchema>

export const TailoredContentSchema = z.object({
  summary: z.string(),
  skills: z.array(z.string()),
  claims: z.array(ClaimSchema),
  coverLetter: z.string(),
})
export type TailoredContent = z.infer<typeof TailoredContentSchema>
