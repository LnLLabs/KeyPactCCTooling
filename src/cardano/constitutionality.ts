import {
  CONSTITUTION_FALLBACK_PATH,
  constitutionUrl,
  deepseekChatUrl,
} from './config'
import { ensureProposalMetadata, type Proposal } from './governance'

export type ConstitutionalityVerdict = 'fine' | 'clear_violation'

export type ConstitutionalityStatus = 'pending' | 'running' | 'done' | 'error'

export type ConstitutionalityResult = {
  status: ConstitutionalityStatus
  verdict?: ConstitutionalityVerdict
  reasoning?: string
  error?: string
}

type DeepSeekChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | null
    }
  }>
  error?: { message?: string }
}

const SYSTEM_PROMPT = `You are assisting a Cardano Constitutional Committee member.
Given the Cardano Constitution and one governance proposal, decide whether the proposal
contains a CLEAR violation of the Constitution.

Rules:
- Only flag CLEAR violations. Ambiguous, speculative, or policy-preference concerns must be "fine".
- Most proposals should be "fine".
- Reply with JSON only, no markdown fences:
  {"verdict":"fine"|"clear_violation","reasoning":"short explanation"}
- For "fine", keep reasoning brief (one or two sentences).
- For "clear_violation", cite the constitutional article/section and explain the conflict.`

export function proposalPayloadObject(proposal: Proposal) {
  const offchain = proposal.metadata?.json ?? null
  return {
    id: proposal.proposalId,
    tx_hash: proposal.txHash,
    index: proposal.index,
    type: proposal.type,
    title: proposal.title,
    expiration_epoch: proposal.expiration ?? null,
    // Human-readable CIP-108 document (primary signal for constitutionality).
    offchain_metadata: offchain,
    metadata_anchor: {
      url: proposal.metadata?.url ?? null,
      hash: proposal.metadata?.hash ?? null,
      error: proposal.metadata?.error ?? null,
    },
    // On-chain action payload (withdrawals, params, etc.).
    governance_description: proposal.description ?? null,
  }
}

export function proposalPayload(proposal: Proposal): string {
  return JSON.stringify(proposalPayloadObject(proposal), null, 2)
}

export function buildDeepSeekConstitutionMessage(constitution: string): string {
  return `## Cardano Constitution\n\n${constitution}`
}

export function buildDeepSeekProposalMessage(proposal: Proposal): string {
  return (
    `## Governance proposal to review\n\n\`\`\`json\n${proposalPayload(proposal)}\n\`\`\`\n\n` +
    `Using the Constitution from the previous message, return JSON with verdict and reasoning only.`
  )
}

/** OpenAI-compatible chat messages: instructions, then constitution, then proposal. */
export function buildDeepSeekRequestPreview(proposal: Proposal, constitution: string) {
  return {
    model: 'deepseek-v4-flash',
    response_format: { type: 'json_object' as const },
    temperature: 0.2,
    messages: [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      { role: 'user' as const, content: buildDeepSeekConstitutionMessage(constitution) },
      { role: 'user' as const, content: buildDeepSeekProposalMessage(proposal) },
    ],
  }
}

let cachedConstitution: { source: string; text: string } | null = null

export async function loadConstitutionMarkdown(force = false): Promise<{ source: string; text: string }> {
  if (!force && cachedConstitution) return cachedConstitution

  const remote = constitutionUrl()
  try {
    const response = await fetch(remote)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    const text = (await response.text()).trim()
    if (text.length < 200) {
      throw new Error('Remote constitution text was too short')
    }
    cachedConstitution = { source: remote, text }
    return cachedConstitution
  } catch (remoteError) {
    const fallback = CONSTITUTION_FALLBACK_PATH
    const response = await fetch(fallback)
    if (!response.ok) {
      throw new Error(
        `Could not load constitution from ${remote} (${remoteError instanceof Error ? remoteError.message : String(remoteError)}) ` +
          `or fallback ${fallback} (${response.status}). Paste the markdown into public/constitution/cardano-constitution.md.`,
      )
    }
    const text = (await response.text()).trim()
    if (text.length < 200 || text.includes('paste the contents')) {
      throw new Error(
        `Remote constitution fetch failed (${remoteError instanceof Error ? remoteError.message : String(remoteError)}). ` +
          `Replace ${fallback} with the full Cardano Constitution markdown and try again.`,
      )
    }
    cachedConstitution = { source: fallback, text }
    return cachedConstitution
  }
}

function parseVerdict(content: string): { verdict: ConstitutionalityVerdict; reasoning: string } {
  const trimmed = content.trim()
  const jsonText = trimmed.startsWith('{')
    ? trimmed
    : (trimmed.match(/\{[\s\S]*\}/)?.[0] ?? trimmed)
  const parsed = JSON.parse(jsonText) as {
    verdict?: string
    reasoning?: string
  }
  const verdictRaw = (parsed.verdict ?? '').toLowerCase().replace(/\s+/g, '_')
  const verdict: ConstitutionalityVerdict =
    verdictRaw === 'clear_violation' || verdictRaw === 'violation' ? 'clear_violation' : 'fine'
  const reasoning =
    typeof parsed.reasoning === 'string' && parsed.reasoning.trim()
      ? parsed.reasoning.trim()
      : verdict === 'fine'
        ? 'No clear constitutional violation identified.'
        : 'Flagged as a clear violation (no detailed reasoning returned).'
  return { verdict, reasoning }
}

export async function evaluateProposalConstitutionality(
  proposal: Proposal,
  constitution: string,
): Promise<{ verdict: ConstitutionalityVerdict; reasoning: string }> {
  const request = buildDeepSeekRequestPreview(proposal, constitution)
  const response = await fetch(deepseekChatUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })

  const raw = await response.text()
  if (!response.ok) {
    throw new Error(
      `DeepSeek request failed (${response.status}): ${raw.slice(0, 400) || response.statusText}. ` +
        `Ensure DEEPSEEK_API_KEY is set in .env and the Vite /deepseek proxy is running.`,
    )
  }

  let payload: DeepSeekChatResponse
  try {
    payload = JSON.parse(raw) as DeepSeekChatResponse
  } catch {
    throw new Error(`DeepSeek returned non-JSON: ${raw.slice(0, 400)}`)
  }
  if (payload.error?.message) {
    throw new Error(payload.error.message)
  }
  const content = payload.choices?.[0]?.message?.content
  if (!content) {
    throw new Error('DeepSeek response had no message content')
  }
  return parseVerdict(content)
}

export async function inspectProposalsConstitutionality(
  proposals: Proposal[],
  onUpdate: (proposalId: string, result: ConstitutionalityResult) => void,
  concurrency = 2,
): Promise<void> {
  if (proposals.length === 0) {
    throw new Error('No proposals to inspect')
  }
  const { text: constitution } = await loadConstitutionMarkdown()

  for (const proposal of proposals) {
    onUpdate(proposal.proposalId, { status: 'pending' })
  }

  let next = 0
  async function worker() {
    while (next < proposals.length) {
      const index = next++
      const proposal = proposals[index]!
      onUpdate(proposal.proposalId, { status: 'running' })
      try {
        const enriched = await ensureProposalMetadata(proposal)
        const { verdict, reasoning } = await evaluateProposalConstitutionality(enriched, constitution)
        onUpdate(proposal.proposalId, { status: 'done', verdict, reasoning })
      } catch (error) {
        onUpdate(proposal.proposalId, {
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, proposals.length) || 1 }, () => worker()),
  )
}
