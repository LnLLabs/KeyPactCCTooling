import type { Proposal } from './governance'

export type MutabilityViolation = {
  path: string
  url: string
}

export type ImmutabilityStatus = 'ok' | 'violation' | 'unverified'

export type ImmutabilityReport = {
  status: ImmutabilityStatus
  violations: MutabilityViolation[]
  note?: string
}

const HTTP_URL = /https?:\/\/[^\s<>"'`]+/gi
const CID_V0 = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/
const CID_V1 = /^b[a-z2-7]{20,}$/i
const ARWEAVE_ID = /^[A-Za-z0-9_-]{43}$/
const GIT_COMMIT = /^[0-9a-f]{40}$/i

const RATIONALE_CONTEXT = {
  '@language': 'en-us',
  CIP100: 'https://github.com/cardano-foundation/CIPs/blob/master/CIP-0100/README.md#',
  CIP136: 'https://github.com/cardano-foundation/CIPs/blob/master/CIP-0136/README.md#',
  hashAlgorithm: 'CIP100:hashAlgorithm',
  body: {
    '@id': 'CIP100:body',
    '@context': {
      references: {
        '@id': 'CIP100:references',
        '@container': '@set',
      },
      summary: 'CIP136:summary',
      rationaleStatement: 'CIP136:rationaleStatement',
    },
  },
} as const

/**
 * `@context` holds CIP vocabulary URLs. `authors` is identity, not proposal
 * content. `references` are citations and may point at ordinary websites.
 */
const SKIPPED_KEYS = new Set(['@context', 'authors', 'references'])

function walk(
  value: unknown,
  path: string,
  violations: MutabilityViolation[],
  seen: Set<string>,
  citations: Set<string>,
) {
  if (typeof value === 'string') {
    for (const url of extractHttpUrls(value)) {
      if (isImmutableLocation(url) || isDeclaredCitation(citations, url)) continue
      const key = `${path}\n${normalizeUrl(url)}`
      if (seen.has(key)) continue
      seen.add(key)
      violations.push({ path: path || '(document)', url })
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      walk(item, `${path}[${index}]`, violations, seen, citations)
    })
    return
  }
  if (value == null || typeof value !== 'object') return

  const obj = value as Record<string, unknown>
  const committed = hasHashCommitment(obj)
  for (const [key, child] of Object.entries(obj)) {
    if (SKIPPED_KEYS.has(key)) continue
    const childPath = path ? `${path}.${key}` : key
    if (committed && isUriField(key)) continue
    walk(child, childPath, violations, seen, citations)
  }
}

/** Host lowercased, fragment dropped, one trailing slash removed. */
export function normalizeUrl(raw: string): string {
  try {
    const parsed = new URL(raw)
    parsed.hash = ''
    let path = parsed.pathname
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
    return `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}${path}${parsed.search}`
  } catch {
    return raw.trim()
  }
}

/** A `?lang=` (or any other query) still refers to the same declared reference. */
function isDeclaredCitation(citations: Set<string>, url: string): boolean {
  const normalized = normalizeUrl(url)
  if (citations.has(normalized)) return true
  const withoutQuery = normalized.split('?')[0] ?? normalized
  return withoutQuery !== normalized && citations.has(withoutQuery)
}

function addCitation(citations: Set<string>, url: string) {
  const normalized = normalizeUrl(url)
  citations.add(normalized)
  const withoutQuery = normalized.split('?')[0]
  if (withoutQuery && withoutQuery !== normalized) citations.add(withoutQuery)
}

function collectCitationUrls(json: unknown): Set<string> {
  const citations = new Set<string>()
  if (json == null || typeof json !== 'object' || Array.isArray(json)) return citations
  const root = json as Record<string, unknown>
  harvestCitations(root.references, citations)
  const body = root.body
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    harvestCitations((body as Record<string, unknown>).references, citations)
  }
  return citations
}

function harvestCitations(value: unknown, citations: Set<string>) {
  if (typeof value === 'string') {
    for (const url of extractHttpUrls(value)) addCitation(citations, url)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) harvestCitations(item, citations)
    return
  }
  if (value == null || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === '@context') continue
    harvestCitations(child, citations)
  }
}

function anchorViolation(url: string | null): MutabilityViolation | null {
  if (!url || isImmutableLocation(url) || !/^https?:\/\//i.test(url)) return null
  return { path: 'metadata.url', url }
}

function isUriField(key: string): boolean {
  const normalized = key.toLowerCase()
  return normalized === 'uri' || normalized === 'url' || normalized === 'href'
}

function hasHashCommitment(obj: Record<string, unknown>): boolean {
  if (isHexHash(obj.hash)) return true
  if (hashObjectHasDigest(obj.hash)) return true
  if (hashObjectHasDigest(obj.referenceHash)) return true
  if (hashObjectHasDigest(obj.reference_hash)) return true
  return false
}

function isHexHash(value: unknown): boolean {
  return typeof value === 'string' && /^[0-9a-fA-F]{32,}$/.test(value.trim())
}

function hashObjectHasDigest(value: unknown): boolean {
  if (value == null || typeof value !== 'object') return false
  const hash = (value as Record<string, unknown>).hash
  return typeof hash === 'string' && hash.trim().length >= 32
}

export function extractHttpUrls(text: string): string[] {
  const found: string[] = []
  for (const match of text.matchAll(HTTP_URL)) {
    const url = trimUrl(match[0])
    if (url) found.push(url)
  }
  return found
}

function trimUrl(raw: string): string {
  return raw.replace(/[),.;:!?]+$/g, '').replace(/\]+$/g, '')
}

/** IPFS, Arweave, or a GitHub URL pinned to a full commit SHA. Branch names stay mutable. */
function isImmutableLocation(raw: string): boolean {
  return isContentAddressed(raw) || isGitCommitPinned(raw)
}

function isGitCommitPinned(raw: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return false
  }
  const host = parsed.hostname.toLowerCase()
  const github =
    host === 'github.com' || host === 'raw.githubusercontent.com' || host.endsWith('.githubusercontent.com')
  if (!github) return false
  return parsed.pathname.split('/').some((part) => GIT_COMMIT.test(part))
}

export function isContentAddressed(raw: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return false
  }
  const protocol = parsed.protocol.toLowerCase()
  if (protocol === 'ipfs:' || protocol === 'ar:') return true

  const host = parsed.hostname.toLowerCase()
  if (host === 'arweave.net' || host.endsWith('.arweave.net')) {
    const id = parsed.pathname.split('/').filter(Boolean)[0] ?? ''
    return ARWEAVE_ID.test(id)
  }

  const parts = parsed.pathname.split('/').filter(Boolean)
  const ipfsAt = parts.findIndex((part) => part.toLowerCase() === 'ipfs')
  if (ipfsAt >= 0) {
    const cid = parts[ipfsAt + 1] ?? ''
    return isCid(cid)
  }
  return false
}

function isCid(segment: string): boolean {
  return CID_V0.test(segment) || CID_V1.test(segment)
}

export function findMutabilityViolations(proposal: Pick<Proposal, 'metadata'>): ImmutabilityReport {
  const url = proposal.metadata?.url?.trim() || null
  const anchor = anchorViolation(url)
  const json = proposal.metadata?.json
  const fetchNote = proposal.metadata?.error?.trim()

  if (json == null) {
    if (anchor) {
      return {
        status: 'violation',
        violations: [anchor],
        note: fetchNote
          ? `Off-chain metadata body could not be read (${fetchNote}). Only the metadata URL was checked.`
          : 'Off-chain metadata body was not available, so only the metadata URL was checked.',
      }
    }
    return {
      status: 'unverified',
      violations: [],
      note: !url
        ? 'Metadata URL was not available, so the document host was not checked.'
        : fetchNote
          ? `Off-chain metadata body could not be read (${fetchNote}).`
          : 'Off-chain metadata body was not available, so linked content could not be checked.',
    }
  }

  const violations: MutabilityViolation[] = []
  if (anchor) violations.push(anchor)
  walk(json, '', violations, new Set(anchor ? [`metadata.url\n${normalizeUrl(anchor.url)}`] : []), collectCitationUrls(json))

  if (!url && violations.length === 0) {
    return {
      status: 'unverified',
      violations: [],
      note: 'Metadata URL was not available, so the document host was not checked.',
    }
  }
  if (violations.length === 0) return { status: 'ok', violations: [] }
  return {
    status: 'violation',
    violations,
    note: !url ? 'Metadata URL was not available, so the document host was not checked.' : undefined,
  }
}

export function isImmutabilityViolation(proposal: Pick<Proposal, 'metadata'>): boolean {
  return findMutabilityViolations(proposal).status === 'violation'
}

export function buildNoRationaleDocument(
  proposal: Pick<Proposal, 'proposalId' | 'txHash' | 'index'>,
  violations: MutabilityViolation[],
): string {
  if (violations.length === 0) {
    throw new Error('Cannot build a No rationale without immutability violations')
  }
  const cited = [...violations].sort(
    (a, b) => a.path.localeCompare(b.path) || a.url.localeCompare(b.url),
  )
  const lines = cited.map((violation) => `- ${violation.path}: ${violation.url}`)
  const document = {
    '@context': RATIONALE_CONTEXT,
    hashAlgorithm: 'blake2b-256',
    body: {
      summary: 'No: off-chain content is not immutable',
      rationaleStatement:
        `This vote is No because governance action ${proposal.proposalId} ` +
        `(${proposal.txHash}#${proposal.index}) violates Article II, Section 6.1 of the ` +
        'Cardano Blockchain Ecosystem Constitution. That section requires the off-chain ' +
        'document for a governance action to be immutable and incapable of being altered ' +
        'after submission. The following proposal content is hosted at an ordinary HTTP ' +
        'server and is not content-addressed:\n' +
        lines.join('\n'),
    },
  }
  return `${JSON.stringify(document, null, 2)}\n`
}

export function encodeNoRationale(
  proposal: Pick<Proposal, 'proposalId' | 'txHash' | 'index'>,
  violations: MutabilityViolation[],
): Uint8Array {
  return new TextEncoder().encode(buildNoRationaleDocument(proposal, violations))
}
