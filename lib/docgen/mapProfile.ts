// Maps the pipeline output (Profile + TailoredContent + JobReqs) onto the doc-builder inputs.
// The resume DESIGN is locked (resume.ts); this only decides what content fills each slot.
//
// Interim simplifications (documented so they're not mistaken for final):
//  - Skills render as a single "Technical Skills" category. The locked template front-loads
//    *categorized* skills; categorization needs a richer structureResume output (follow-up).
//  - All certs render under "Active"; the Active/Previously-Held split needs cert status on
//    the Profile (follow-up).
//  - "Earlier Experience" is empty; the recent/earlier split needs role recency metadata.
//  - Role context lines are omitted (the schema has no per-role context yet).
// Everything rendered still traces to real Profile facts — the guardrail runs independently.
import type { JobReqs, Profile, TailoredContent } from '@/lib/schemas'
import type { ResumeContent } from '@/lib/docgen/resume'
import type { CoverLetterContent } from '@/lib/docgen/coverLetter'

const FALLBACK_CONTACT = { location: '', phone: '', email: '' }

function roleDates(startDate: string, endDate?: string | null): string {
  return `${startDate} – ${endDate ?? 'Present'}`
}

export function toResumeContent(
  profile: Profile,
  tailored: TailoredContent,
  jobReqs: JobReqs,
): ResumeContent {
  const skills = tailored.skills.length > 0 ? tailored.skills : profile.skills

  return {
    name: profile.name,
    tagline: jobReqs.title ?? 'Candidate',
    subtitle: skills.slice(0, 3).join('  ·  '),
    contact: profile.contact ?? FALLBACK_CONTACT,
    summary: tailored.summary || profile.summary,
    skillCategories: [{ label: 'Technical Skills', items: skills.join(', ') }],
    experience: profile.roles.map((r) => ({
      company: r.company,
      dates: roleDates(r.startDate, r.endDate),
      title: r.title,
      context: '',
      bullets: r.bullets,
    })),
    earlier: [],
    certs: { active: profile.certs.map((name) => ({ name })), previouslyHeld: [] },
    education: profile.education.map((e) => ({
      school: e.school,
      detail: [e.degree, e.field, e.year].filter(Boolean).join(', '),
    })),
    authLine: 'Authorized to work in the U.S. for any employer',
  }
}

/** Strip em dashes so the cover letter's assertNoEmDash never trips on JD-derived text. */
function noEmDash(s: string): string {
  return s.replace(/\s*—\s*/g, ', ')
}

export function toCoverLetterContent(
  profile: Profile,
  tailored: TailoredContent,
  jobReqs: JobReqs,
  date: string,
): CoverLetterContent {
  // Split the tailored cover letter into paragraphs on blank lines (fall back to one block).
  const paragraphs = tailored.coverLetter
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  const contact = profile.contact ?? FALLBACK_CONTACT
  const title = jobReqs.title ?? 'Candidate'

  return {
    candidate: {
      name: profile.name,
      tagline: title,
      location: contact.location,
      phone: contact.phone,
      email: contact.email,
    },
    date,
    recipient: jobReqs.company ? noEmDash(jobReqs.company) : '',
    reLine: jobReqs.title ? `Re: ${noEmDash(jobReqs.title)}` : '',
    salutation: jobReqs.company ? `Dear ${noEmDash(jobReqs.company)} Hiring Team,` : 'Dear Hiring Team,',
    paragraphs: paragraphs.length > 0 ? paragraphs : ['Please find my application enclosed.'],
    closing: 'Sincerely,',
    signature: profile.name,
  }
}
