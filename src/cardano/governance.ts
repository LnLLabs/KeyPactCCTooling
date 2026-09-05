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

export type Proposal = {
  proposalId: string
  txHash: string
  index: number
  type: string
  title: string
  expiration?: number | null
  /** Blockfrost governance_description (for LLM inspection). */
  description?: unknown
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
  return details
    .filter((row): row is BlockfrostProposal => row != null && isActiveVotingProposal(row, epoch.epoch))
    .map((row) => ({
      proposalId: row.id ?? `${row.tx_hash}#${row.cert_index ?? 0}`,
      txHash: row.tx_hash ?? '',
      index: row.cert_index ?? 0,
      type: row.governance_type ?? 'Unknown',
      title: proposalTitle(row),
      expiration: row.expiration,
      description: row.governance_description ?? null,
    }))
    .filter((proposal) => proposal.txHash)
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
  const voted = new Set(votes.map((vote) => vote.proposalId))
  for (const vote of votes) {
    if (vote.txHash != null && vote.index != null) {
      voted.add(`${vote.txHash}#${vote.index}`)
    }
  }
  return proposals.filter(
    (proposal) => !voted.has(proposal.proposalId) && !voted.has(`${proposal.txHash}#${proposal.index}`),
  )
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
