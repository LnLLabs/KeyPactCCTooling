import {
  CONSTITUTION_FALLBACK_PATH,
  constitutionUrl,
  deepseekChatUrl,
} from './config'
import type { Proposal } from './governance'

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

function proposalPayload(proposal: Proposal): string {
  return JSON.stringify(
    {
      id: proposal.proposalId,
      tx_hash: proposal.txHash,
      index: proposal.index,
      type: proposal.type,
      title: proposal.title,
      expiration_epoch: proposal.expiration ?? null,
      governance_description: proposal.description ?? null,
    },
    null,
    2,
  )
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
  const response = await fetch(deepseekChatUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'deepseek-v4-flash',
      response_format: { type: 'json_object' },
      temperature: 0.2,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content:
            `## Cardano Constitution\n\n${constitution}\n\n` +
            `## Governance proposal to review\n\n\`\`\`json\n${proposalPayload(proposal)}\n\`\`\`\n\n` +
            `Return JSON with verdict and reasoning only.`,
        },
      ],
    }),
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
        const { verdict, reasoning } = await evaluateProposalConstitutionality(proposal, constitution)
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
