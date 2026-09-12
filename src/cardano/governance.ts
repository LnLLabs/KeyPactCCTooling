import {
  Anchor,
  GovernanceAction,
  Transaction,
  TransactionHash,
  Url,
  VotingProcedures,
} from '@evolution-sdk/evolution'
import { blake2b } from '@noble/hashes/blake2.js'
import { blockfrostFetch, rationaleUrl, assertPublicRationaleUrl } from './config'
import { createSigningClient, type HotWallet } from './hotWallet'

const MAX_TX_BYTES = 16_000
const INITIAL_BATCH = 24
const PAGE_SIZE = 100

export type ProposalMetadata = {
  url?: string | null
  hash?: string | null
  /** CIP-100 / CIP-108 off-chain JSON (when Blockfrost could fetch it). */
  json?: unknown
  /** Raw metadata bytes hex, if returned. */
  bytes?: string | null
  /** Fetch/validation error from Blockfrost, if any. */
  error?: string | null
}

export type Proposal = {
  proposalId: string
  txHash: string
  index: number
  type: string
  title: string
  expiration?: number | null
  /** On-chain governance action payload from Blockfrost. */
  description?: unknown
  /** Off-chain anchored metadata (CIP-108), when available. */
  metadata?: ProposalMetadata | null
}

export type CommitteeVote = {
  proposalId: string
  txHash?: string
  index?: number
  vote?: string
}

type BlockfrostProposal = {
  id?: string
  tx_hash?: string
  cert_index?: number
  governance_type?: string
  governance_description?: {
    title?: string
    tag?: string
    body?: { title?: string }
  } | null
  expiration?: number | null
  expired_epoch?: number | null
  enacted_epoch?: number | null
  dropped_epoch?: number | null
  ratified_epoch?: number | null
}

type BlockfrostProposalMetadata = {
  id?: string
  tx_hash?: string
  cert_index?: number
  url?: string | null
  hash?: string | null
  json_metadata?: unknown
  bytes?: string | null
  error?: string | { message?: string; code?: string } | null
}

type BlockfrostEpoch = {
  epoch: number
}

type BlockfrostVote = {
  proposal_id?: string
  proposal_tx_hash?: string
  proposal_index?: number
  vote?: string
}

async function blockfrostPages<T>(path: string): Promise<T[]> {
  const rows: T[] = []
  for (let page = 1; page < 1000; page++) {
    const sep = path.includes('?') ? '&' : '?'
    const chunk = await blockfrostFetch<T[]>(
      `${path}${sep}count=${PAGE_SIZE}&page=${page}&order=desc`,
    )
    rows.push(...chunk)
    if (chunk.length < PAGE_SIZE) break
  }
  return rows
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index]!)
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) || 1 }, () => worker())
  await Promise.all(workers)
  return results
}

async function fetchProposalDetail(row: BlockfrostProposal): Promise<BlockfrostProposal | null> {
  const txHash = row.tx_hash
  if (!txHash) return null
  const index = row.cert_index ?? 0
  try {
    const detail = await blockfrostFetch<BlockfrostProposal>(
      `/governance/proposals/${txHash}/${index}`,
    )
    return {
      ...row,
      ...detail,
      tx_hash: detail.tx_hash ?? txHash,
      cert_index: detail.cert_index ?? index,
    }
  } catch {
    return null
  }
}

function metadataErrorMessage(error: BlockfrostProposalMetadata['error']): string | null {
  if (error == null) return null
  if (typeof error === 'string') return error
  if (typeof error === 'object') {
    return error.message ?? error.code ?? JSON.stringify(error)
  }
  return String(error)
}

async function fetchAnchorJson(url: string): Promise<unknown | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('json') || url.endsWith('.json') || url.endsWith('.jsonld')) {
      return await response.json()
    }
    const text = await response.text()
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  } catch {
    return null
  }
}

export async function fetchProposalMetadata(
  proposal: Pick<Proposal, 'proposalId' | 'txHash' | 'index'>,
): Promise<ProposalMetadata | null> {
  const paths = [
    // Prefer tx/cert path — more reliable than encoding gov_action bech32 ids.
    `/governance/proposals/${proposal.txHash}/${proposal.index}/metadata`,
    proposal.proposalId
      ? `/governance/proposals/${encodeURIComponent(proposal.proposalId)}/metadata`
      : null,
  ].filter((path): path is string => Boolean(path))

  let best: ProposalMetadata | null = null

  for (const path of paths) {
    try {
      const row = await blockfrostFetch<BlockfrostProposalMetadata>(path)
      const meta: ProposalMetadata = {
        url: row.url ?? null,
        hash: row.hash ?? null,
        json: row.json_metadata ?? null,
        bytes: row.bytes ?? null,
        error: metadataErrorMessage(row.error),
      }

      if (meta.json == null && meta.url) {
        const fetched = await fetchAnchorJson(meta.url)
        if (fetched != null) {
          meta.json = fetched
          meta.error = null
        }
      }

      // Prefer any result that actually has CIP-108 JSON.
      if (meta.json != null) return meta
      if (!best || (meta.url && !best.url)) best = meta
    } catch {
      // try next path
    }
  }

  return best
}

/** Ensure off-chain metadata is attached (lazy load for Read / DeepSeek preview). */
export async function ensureProposalMetadata(proposal: Proposal): Promise<Proposal> {
  if (proposal.metadata?.json != null) return proposal
  const metadata = await fetchProposalMetadata(proposal)
  if (!metadata) return proposal
  const title = metadataTitle(metadata) ?? proposal.title
  return { ...proposal, title, metadata }
}

function metadataTitle(metadata: ProposalMetadata | null | undefined): string | null {
  const json = metadata?.json
  if (!json || typeof json !== 'object') return null
  const root = json as Record<string, unknown>
  const body = root.body
  if (body && typeof body === 'object') {
    const title = (body as Record<string, unknown>).title
    if (typeof title === 'string' && title.trim()) return title.trim()
  }
  if (typeof root.title === 'string' && root.title.trim()) return root.title.trim()
  return null
}

/**
 * Active voting = not ratified/enacted/expired/dropped, and expiration epoch
 * is still ahead of (or equal to) the current epoch.
 *
 * Blockfrost's proposal *list* omits status fields, so we enrich via the
 * per-proposal detail endpoint before filtering.
 */
function isActiveVotingProposal(row: BlockfrostProposal, currentEpoch: number): boolean {
  if (
    row.expired_epoch != null ||
    row.enacted_epoch != null ||
    row.dropped_epoch != null ||
    row.ratified_epoch != null
  ) {
    return false
  }
  if (row.expiration == null) return false
  return row.expiration >= currentEpoch
}

function proposalTitle(row: BlockfrostProposal): string {
  return (
    row.governance_description?.body?.title ??
    row.governance_description?.title ??
    row.id ??
    `${row.tx_hash}#${row.cert_index ?? 0}`
  )
}

export async function fetchProposalList(): Promise<Proposal[]> {
  const [rows, epoch] = await Promise.all([
    blockfrostPages<BlockfrostProposal>('/governance/proposals'),
    blockfrostFetch<BlockfrostEpoch>('/epochs/latest'),
  ])
  const details = await mapPool(rows, 12, fetchProposalDetail)
  const active = details.filter(
    (row): row is BlockfrostProposal => row != null && isActiveVotingProposal(row, epoch.epoch),
  )

  const withMetadata = await mapPool(active, 8, async (row): Promise<Proposal | null> => {
    const base: Proposal = {
      proposalId: row.id ?? `${row.tx_hash}#${row.cert_index ?? 0}`,
      txHash: row.tx_hash ?? '',
      index: row.cert_index ?? 0,
      type: row.governance_type ?? 'Unknown',
      title: proposalTitle(row),
      expiration: row.expiration,
      description: row.governance_description ?? null,
      metadata: null,
    }
    if (!base.txHash) return null
    const metadata = await fetchProposalMetadata(base)
    const title = metadataTitle(metadata) ?? base.title
    return { ...base, title, metadata }
  })

  return withMetadata.filter((proposal): proposal is Proposal => proposal != null)
}

export async function fetchCommitteeVotes(ccHotId: string): Promise<CommitteeVote[]> {
  try {
    const rows = await blockfrostPages<BlockfrostVote>(
      `/governance/committee/${encodeURIComponent(ccHotId)}/votes`,
    )
    return rows.map((row) => ({
      proposalId: row.proposal_id ?? `${row.proposal_tx_hash}#${row.proposal_index ?? 0}`,
      txHash: row.proposal_tx_hash,
      index: row.proposal_index,
      vote: row.vote,
    }))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/\b404\b/.test(message)) return []
    throw error
  }
}

export function pendingProposals(proposals: Proposal[], votes: CommitteeVote[]): Proposal[] {
  return partitionProposalsByVote(proposals, votes).pending
}

export type VotedProposal = {
  proposal: Proposal
  vote: string | null
}

export function partitionProposalsByVote(
  proposals: Proposal[],
  votes: CommitteeVote[],
): { pending: Proposal[]; voted: VotedProposal[] } {
  const byKey = new Map<string, CommitteeVote>()
  for (const vote of votes) {
    if (vote.proposalId) byKey.set(vote.proposalId, vote)
    if (vote.txHash != null && vote.index != null) {
      byKey.set(`${vote.txHash}#${vote.index}`, vote)
    }
  }

  const pending: Proposal[] = []
  const voted: VotedProposal[] = []
  for (const proposal of proposals) {
    const match =
      byKey.get(proposal.proposalId) ?? byKey.get(`${proposal.txHash}#${proposal.index}`)
    if (match) voted.push({ proposal, vote: match.vote ?? null })
    else pending.push(proposal)
  }
  return { pending, voted }
}

export async function loadLgtmAnchor(): Promise<Anchor.Anchor> {
  const url = assertPublicRationaleUrl(rationaleUrl())
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(
      `Could not load rationale from ${url} (${response.status}). ` +
        `Ensure VITE_RATIONALE_URL points at a publicly reachable lgtm.jsonld.`,
    )
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.length === 0) {
    throw new Error(`Rationale at ${url} is empty`)
  }
  const hash = blake2b(bytes, { dkLen: 32 })
  return new Anchor.Anchor({
    anchorUrl: new Url.Url({ href: url }),
    anchorDataHash: hash,
  })
}

function toGovActionId(proposal: Proposal): GovernanceAction.GovActionId {
  return new GovernanceAction.GovActionId({
    transactionId: TransactionHash.fromHex(proposal.txHash),
    govActionIndex: BigInt(proposal.index),
  })
}

function buildVotingProcedures(wallet: HotWallet, proposals: Proposal[], anchor: Anchor.Anchor) {
  const voter = new VotingProcedures.ConstitutionalCommitteeVoter({
    credential: wallet.keyHash,
  })
  const procedure = new VotingProcedures.VotingProcedure({
    vote: VotingProcedures.yes(),
    anchor,
  })
  return VotingProcedures.multiVote(
    voter,
    proposals.map((proposal) => [toGovActionId(proposal), procedure] as const),
  )
}

async function submitBatch(
  wallet: HotWallet,
  proposals: Proposal[],
  anchor: Anchor.Anchor,
): Promise<string> {
  const client = createSigningClient(wallet)
  const built = await client.newTx().vote({
    votingProcedures: buildVotingProcedures(wallet, proposals, anchor),
  }).build()
  const sized = await built.toTransactionWithFakeWitnesses()
  const size = Transaction.toCBORBytes(sized).length
  if (size > MAX_TX_BYTES) {
    throw new RangeError(`Transaction is ${size} bytes`)
  }
  const submitted = await (await built.sign()).submit()
  return TransactionHash.toHex(submitted)
}

export async function castYesVotes(
  wallet: HotWallet,
  proposals: Proposal[],
): Promise<string[]> {
  if (proposals.length === 0) throw new Error('Select at least one proposal')
  const anchor = await loadLgtmAnchor()
  const hashes: string[] = []
  let batchSize = Math.min(INITIAL_BATCH, proposals.length)
  let remaining = [...proposals]

  while (remaining.length > 0) {
    const batch = remaining.slice(0, batchSize)
    try {
      hashes.push(await submitBatch(wallet, batch, anchor))
      remaining = remaining.slice(batch.length)
      batchSize = Math.min(INITIAL_BATCH, remaining.length || 1)
    } catch (error) {
      if (error instanceof RangeError && batch.length > 1) {
        batchSize = Math.max(1, Math.floor(batch.length / 2))
        continue
      }
      throw error
    }
  }

  return hashes
}

export function explorerTxUrl(txHash: string): string {
  return `https://cardanoscan.io/transaction/${txHash}`
}
