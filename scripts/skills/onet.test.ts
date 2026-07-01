import { describe, expect, test } from 'vitest'
import {
  extractParenthetical,
  extractTrailingAcronym,
  computeInitials,
  initialsConsistency,
  extractOnetCandidates,
} from './onet'

describe('extractParenthetical', () => {
  test('pulls Full Name (ACRONYM) when the parenthetical ends the string', () => {
    expect(extractParenthetical('Human resource information system (HRIS)')).toEqual({
      full: 'Human resource information system',
      acronym: 'HRIS',
    })
    expect(extractParenthetical('Adobe Experience Manager (AEM)')).toEqual({
      full: 'Adobe Experience Manager',
      acronym: 'AEM',
    })
  })

  test('does NOT match when the parenthetical is mid-string (trailing text after it)', () => {
    // Real rows: "...(EMR) software", "...(FORMS) II Lite" are not end-anchored, so parenthetical skips them.
    expect(extractParenthetical('EpicCare Ambulatory Electronic Medical Records (EMR) software')).toBeNull()
    expect(extractParenthetical('IntelliTrack Warehouse Management System (WMS) tool')).toBeNull()
  })

  test('ignores non-acronym parentheticals (lowercase / too long)', () => {
    expect(extractParenthetical('Some Tool (version 2)')).toBeNull()
    expect(extractParenthetical('Some Tool (ABCDEFG)')).toBeNull() // 7 chars, over the 2-6 bound
  })
})

describe('extractTrailingAcronym', () => {
  test('pulls the trailing all-caps token and the preceding words', () => {
    expect(extractTrailingAcronym('A mathematical programming language AMPL')).toEqual({
      full: 'A mathematical programming language',
      acronym: 'AMPL',
    })
    expect(extractTrailingAcronym('Exact Software Macola ES')).toEqual({
      full: 'Exact Software Macola',
      acronym: 'ES',
    })
  })

  test('returns null when there is no trailing caps token', () => {
    expect(extractTrailingAcronym('Cisco Systems WAN Manager')).toBeNull() // ends in "Manager", not caps
    expect(extractTrailingAcronym('Amazon Web Services AWS software')).toBeNull() // caps not at end
  })
})

describe('computeInitials', () => {
  test('takes the first char of each word, dropping only the spec connectors', () => {
    // "a"/"an" are intentionally kept, so this stays "AMPL".
    expect(computeInitials('A mathematical programming language')).toBe('AMPL')
    // Connector "of" is dropped: "Bank of America" -> "BA".
    expect(computeInitials('Bank of America')).toBe('BA')
    expect(computeInitials('Human resource information system')).toBe('HRIS')
  })
})

describe('initialsConsistency (exact vs substring vs reject)', () => {
  test('exact when the acronym equals the initials', () => {
    expect(initialsConsistency('A mathematical programming language', 'AMPL')).toBe('exact')
    expect(initialsConsistency('Human resource information system', 'HRIS')).toBe('exact')
  })

  test('substring when the acronym is a loose substring of the initials (the ES/ESM loophole)', () => {
    // "Exact Software Macola" -> initials "ESM"; trailing "ES" is a substring, NOT the full initials.
    expect(initialsConsistency('Exact Software Macola', 'ES')).toBe('substring')
  })

  test('rejects an acronym that is not derivable from the initials', () => {
    expect(initialsConsistency('ADP Enterprise', 'HR')).toBeNull()
    expect(initialsConsistency('ABB MicroSCADA Pro', 'DMS')).toBeNull()
  })
})

describe('extractOnetCandidates (end to end over CSV rows)', () => {
  const csv = [
    'Workplace Example,Element Name,Hot Technology,In Demand',
    'Human resource information system (HRIS),Human resources software,N,N',
    'A mathematical programming language AMPL,Analytical or scientific software,N,N',
    'Exact Software Macola ES,Enterprise resource planning ERP software,N,N',
    'ADP Enterprise HR,Human resources software,N,N', // rejected: HR not derivable from "ADP Enterprise"
    'Amazon Web Services AWS SageMaker,Cloud-based management software,N,Y', // no trailing acronym
  ].join('\n')

  const candidates = extractOnetCandidates(csv)
  const byExample = (ex: string) => candidates.find((c) => c.workplaceExample === ex)

  test('tiers each candidate and rejects non-derivable trailing acronyms', () => {
    const hris = byExample('Human resource information system (HRIS)')
    expect(hris).toMatchObject({ full: 'Human resource information system', acronym: 'HRIS', confidence: 'parenthetical', needsScrutiny: false })

    const ampl = byExample('A mathematical programming language AMPL')
    expect(ampl).toMatchObject({ acronym: 'AMPL', confidence: 'initials-exact', needsScrutiny: false })

    const es = byExample('Exact Software Macola ES')
    expect(es).toMatchObject({ full: 'Exact Software Macola', acronym: 'ES', confidence: 'initials-substring', needsScrutiny: true })

    // Non-derivable and no-trailing-acronym rows produce no candidate.
    expect(byExample('ADP Enterprise HR')).toBeUndefined()
    expect(byExample('Amazon Web Services AWS SageMaker')).toBeUndefined()
  })

  test('carries the source row context and marks source onet', () => {
    const es = byExample('Exact Software Macola ES')
    expect(es).toMatchObject({
      source: 'onet',
      elementName: 'Enterprise resource planning ERP software',
      hotTechnology: false,
      inDemand: false,
    })
  })
})
