import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import {
  buildDeepSeekRequestPreview,
  loadConstitutionMarkdown,
  proposalPayload,
} from '../cardano/constitutionality'
import type { Proposal } from '../cardano/governance'
import { ensureProposalMetadata, explorerTxUrl } from '../cardano/governance'
import { proposalSections, renderMarkdownLite } from '../lib/readableText'

export type ReaderTarget =
  | { kind: 'constitution'; source: string; text: string }
  | { kind: 'proposal'; proposal: Proposal }

type DocumentReaderProps = {
  target: ReaderTarget | null
  onClose: () => void
  footer?: ReactNode
  /** Called when a proposal is enriched with off-chain metadata while reading. */
  onProposalUpdated?: (proposal: Proposal) => void
}

type ProposalTab = 'metadata' | 'onchain' | 'deepseek'

export function DocumentReader({ target, onClose, footer, onProposalUpdated }: DocumentReaderProps) {
  const titleId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!target) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [target, onClose])

  if (!target) return null

  const title =
    target.kind === 'constitution' ? 'Cardano Constitution' : target.proposal.title

  return (
    <div className="reader-overlay" role="presentation" onClick={onClose}>
      <div
        className="reader-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="reader-header">
          <div className="reader-header-text">
            <p className="reader-kicker">
              {target.kind === 'constitution' ? 'Reference' : 'Governance action'}
            </p>
            <h2 id={titleId}>{title}</h2>
            {target.kind === 'constitution' ? (
              <p className="reader-meta">Source: {target.source}</p>
            ) : (
              <p className="reader-meta">
                {target.proposal.type}
                {target.proposal.expiration != null
                  ? ` · expires epoch ${target.proposal.expiration}`
                  : ''}
              </p>
            )}
          </div>
          <button ref={closeRef} type="button" className="reader-close" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="reader-body">
          {target.kind === 'constitution' ? (
            <article className="reader-prose">{renderMarkdownLite(target.text)}</article>
          ) : (
            <ProposalBody
              key={target.proposal.proposalId}
              proposal={target.proposal}
              onProposalUpdated={onProposalUpdated}
            />
          )}
        </div>

        {footer ? <footer className="reader-footer">{footer}</footer> : null}
      </div>
    </div>
  )
}

function ProposalBody({
  proposal: initial,
  onProposalUpdated,
}: {
  proposal: Proposal
  onProposalUpdated?: (proposal: Proposal) => void
}) {
  const [proposal, setProposal] = useState(initial)
  const [loadingMeta, setLoadingMeta] = useState(initial.metadata?.json == null)
  const [tab, setTab] = useState<ProposalTab>('metadata')
  const metaSections = proposalSections(proposal.metadata?.json)
  const onchainSections = proposalSections(proposal.description)

  useEffect(() => {
    setProposal(initial)
    setLoadingMeta(initial.metadata?.json == null)
  }, [initial])

  useEffect(() => {
    if (proposal.metadata?.json != null) {
      setLoadingMeta(false)
      return
    }
    let cancelled = false
    setLoadingMeta(true)
    void ensureProposalMetadata(proposal)
      .then((enriched) => {
        if (cancelled) return
        setProposal(enriched)
        onProposalUpdated?.(enriched)
      })
      .finally(() => {
        if (!cancelled) setLoadingMeta(false)
      })
    return () => {
      cancelled = true
    }
    // Enrich once per proposal id while metadata is missing.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- avoid refetch loops from parent callbacks
  }, [proposal.proposalId, proposal.metadata?.json])

  return (
    <article className="reader-prose">
      <dl className="reader-facts">
        <div>
          <dt>Proposal id</dt>
          <dd>
            <code>{proposal.proposalId}</code>
          </dd>
        </div>
        <div>
          <dt>On-chain</dt>
          <dd>
            <a href={explorerTxUrl(proposal.txHash)} target="_blank" rel="noreferrer">
              {proposal.txHash.slice(0, 16)}…#{proposal.index}
            </a>
          </dd>
        </div>
        {proposal.metadata?.url ? (
          <div>
            <dt>Metadata URL</dt>
            <dd>
              <a href={proposal.metadata.url} target="_blank" rel="noreferrer">
                {proposal.metadata.url}
              </a>
            </dd>
          </div>
        ) : null}
        {proposal.metadata?.hash ? (
          <div>
            <dt>Metadata hash</dt>
            <dd>
              <code>{proposal.metadata.hash}</code>
            </dd>
          </div>
        ) : null}
      </dl>

      <div className="reader-tabs" role="tablist" aria-label="Proposal content">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'metadata'}
          className={tab === 'metadata' ? 'active' : undefined}
          onClick={() => setTab('metadata')}
        >
          Off-chain metadata
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'onchain'}
          className={tab === 'onchain' ? 'active' : undefined}
          onClick={() => setTab('onchain')}
        >
          On-chain action
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'deepseek'}
          className={tab === 'deepseek' ? 'active' : undefined}
          onClick={() => setTab('deepseek')}
        >
          DeepSeek request
        </button>
      </div>

      {tab === 'metadata' && (
        <div>
          {loadingMeta && <p className="reader-empty">Loading off-chain metadata…</p>}
          {proposal.metadata?.error && (
            <p className="error">Metadata fetch note: {proposal.metadata.error}</p>
          )}
          {!loadingMeta && metaSections.length === 0 ? (
            <p className="reader-empty">
              No off-chain CIP-108 metadata was available for this action.
              {proposal.metadata?.url
                ? ' Try opening the metadata URL above.'
                : ' Blockfrost did not return an anchor URL.'}
            </p>
          ) : (
            metaSections.map((section) => (
              <SectionBlock key={`meta-${section.heading}`} section={section} />
            ))
          )}
        </div>
      )}

      {tab === 'onchain' && (
        <div>
          {onchainSections.length === 0 ? (
            <p className="reader-empty">No on-chain governance_description was returned.</p>
          ) : (
            onchainSections.map((section) => (
              <SectionBlock key={`onchain-${section.heading}`} section={section} />
            ))
          )}
        </div>
      )}

      {tab === 'deepseek' && (
        <DeepSeekPreview proposal={proposal} loadingMeta={loadingMeta} />
      )}
    </article>
  )
}

function SectionBlock({ section }: { section: { heading: string; body: string } }) {
  return (
    <section className="reader-section">
      <h3>{section.heading}</h3>
      {looksLikeMarkdown(section.body) ? (
        <div>{renderMarkdownLite(section.body)}</div>
      ) : (
        <p className="md-p reader-plain">{section.body}</p>
      )}
    </section>
  )
}

function DeepSeekPreview({
  proposal,
  loadingMeta,
}: {
  proposal: Proposal
  loadingMeta: boolean
}) {
  const [fullRequest, setFullRequest] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const proposalJson = proposalPayload(proposal)
  const hasMeta = proposal.metadata?.json != null

  useEffect(() => {
    if (loadingMeta) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void loadConstitutionMarkdown()
      .then((doc) => {
        if (cancelled) return
        const request = buildDeepSeekRequestPreview(proposal, doc.text)
        setFullRequest(JSON.stringify(request, null, 2))
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [proposal, loadingMeta])

  return (
    <div className="reader-section">
      <h3>Message layout</h3>
      <p className="reader-meta" style={{ marginBottom: 12 }}>
        DeepSeek gets three chat messages: <code>system</code> (rules), then <code>user</code>{' '}
        (constitution), then <code>user</code> (proposal JSON below).
        {!hasMeta && !loadingMeta
          ? ' Off-chain metadata is missing for this proposal.'
          : null}
      </p>

      <h3>Proposal message</h3>
      {loadingMeta ? (
        <p className="reader-empty">Waiting for metadata before building the request…</p>
      ) : (
        <pre className="md-pre reader-prompt">{proposalJson}</pre>
      )}

      <h3 style={{ marginTop: 24 }}>Full request body</h3>
      <p className="reader-meta" style={{ marginBottom: 12 }}>
        Exact JSON posted to DeepSeek chat completions.
      </p>
      {loading && <p className="reader-empty">Building full request preview…</p>}
      {error && <p className="error">{error}</p>}
      {fullRequest && <pre className="md-pre reader-prompt">{fullRequest}</pre>}
    </div>
  )
}

function looksLikeMarkdown(text: string): boolean {
  return /^#{1,4}\s|^\*\*|^\*\s|^-\s|```/m.test(text)
}
