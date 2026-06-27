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

export const ContactSchema = z.object({
  location: z.string(),
  phone: z.string(),
  email: z.string(),
})
export type Contact = z.infer<typeof ContactSchema>

export const ProfileSchema = z.object({
  name: z.string(),
  // Optional: not every pasted resume includes full contact info; the doc builder falls back.
  contact: ContactSchema.optional(),
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

// ---- Candidate preferences -------------------------------------------------------
// User-set signals the deterministic fit engine needs but a resume doesn't contain. Distinct
// from the LLM-structured Profile (these are chosen by the candidate, never inferred from text).
// In rubric 1.0.0 the engine math uses targetCompTopUsd + targetLanes; workMode / noGoLocations /
// employerTypePreference are persisted for personalization and given to the extractor as context.

export const WorkModeSchema = z.enum(['remote', 'hybrid', 'onsite', 'flexible'])
export type WorkMode = z.infer<typeof WorkModeSchema>

export const EmployerTypePrefSchema = z.enum([
  'direct',
  'managed_services',
  'consulting',
  'vendor',
  'no_preference',
])
export type EmployerTypePref = z.infer<typeof EmployerTypePrefSchema>

export const CandidatePreferencesSchema = z.object({
  /** Candidate's target top-of-band comp (USD). null/absent -> comp dimension stays neutral. */
  targetCompTopUsd: z.number().positive().nullable().optional(),
  /** Target roles/lanes, e.g. ['Cloud Engineer', 'VMware Engineer'] — sets role-type fit. */
  targetLanes: z.array(z.string()).default([]),
  workMode: WorkModeSchema.optional(),
  noGoLocations: z.array(z.string()).default([]),
  employerTypePreference: EmployerTypePrefSchema.optional(),
})
export type CandidatePreferences = z.infer<typeof CandidatePreferencesSchema>

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
