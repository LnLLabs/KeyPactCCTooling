import { useCallback, useEffect, useState } from 'react'
import { formatError } from '../cardano/config'
import { loadConstitutionMarkdown } from '../cardano/constitutionality'
import { fetchProposalList, type Proposal } from '../cardano/governance'
import { DocumentReader, type ReaderTarget } from '../components/DocumentReader'
import { renderMarkdownLite } from '../lib/readableText'

type Tab = 'proposals' | 'constitution'

export function LibraryPage() {
  const [tab, setTab] = useState<Tab>('proposals')
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [loadingList, setLoadingList] = useState(false)
  const [constitution, setConstitution] = useState<{ source: string; text: string } | null>(null)
  const [loadingConstitution, setLoadingConstitution] = useState(false)
  const [constitutionTried, setConstitutionTried] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reader, setReader] = useState<ReaderTarget | null>(null)
  const [query, setQuery] = useState('')

  const loadProposals = useCallback(async () => {
    setLoadingList(true)
    setError(null)
    try {
      const listed = await fetchProposalList()
      setProposals(listed)
    } catch (err) {
      setError(formatError(err))
    } finally {
      setLoadingList(false)
    }
  }, [])

  const loadConstitution = useCallback(async (force = false) => {
    setLoadingConstitution(true)
    setError(null)
    try {
      const doc = await loadConstitutionMarkdown(force)
      setConstitution(doc)
      setConstitutionTried(true)
    } catch (err) {
      setConstitutionTried(true)
      setError(formatError(err))
    } finally {
      setLoadingConstitution(false)
    }
  }, [])

  useEffect(() => {
    void loadProposals()
  }, [loadProposals])

  useEffect(() => {
    if (tab === 'constitution' && !constitution && !constitutionTried && !loadingConstitution) {
      void loadConstitution()
    }
  }, [tab, constitution, constitutionTried, loadingConstitution, loadConstitution])

  const filtered = proposals.filter((proposal) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return (
      proposal.title.toLowerCase().includes(q) ||
      proposal.type.toLowerCase().includes(q) ||
      proposal.proposalId.toLowerCase().includes(q)
    )
  })

  return (
    <section className="panel library-page">
      <h1>Library</h1>
      <p className="lead">
        Read active governance actions and the Cardano Constitution at your own pace — no wallet
        required.
      </p>

      <div className="library-tabs" role="tablist" aria-label="Library">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'proposals'}
          className={tab === 'proposals' ? 'active' : undefined}
          onClick={() => setTab('proposals')}
        >
          Proposals
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'constitution'}
          className={tab === 'constitution' ? 'active' : undefined}
          onClick={() => setTab('constitution')}
        >
          Constitution
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {tab === 'proposals' && (
        <div className="library-panel">
          <div className="library-toolbar">
            <input
              type="search"
              className="library-search"
              placeholder="Filter by title, type, or id…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Filter proposals"
            />
            <button type="button" onClick={() => void loadProposals()} disabled={loadingList}>
              {loadingList ? 'Loading…' : 'Refresh'}
            </button>
          </div>

          {proposals.length === 0 && !loadingList && (
            <p className="reader-empty">No active proposals in the voting period.</p>
          )}

          <ul className="library-list">
            {filtered.map((proposal) => (
              <li key={proposal.proposalId}>
                <button
                  type="button"
                  className="library-item"
                  onClick={() => setReader({ kind: 'proposal', proposal })}
                >
                  <span className="library-item-title">{proposal.title}</span>
                  <span className="library-item-meta">
                    {proposal.type}
                    {proposal.expiration != null ? ` · epoch ${proposal.expiration}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'constitution' && (
        <div className="library-panel">
          <div className="library-toolbar">
            <p className="library-source">
              {constitution
                ? `Loaded from ${constitution.source}`
                : loadingConstitution
                  ? 'Fetching constitution…'
                  : 'Not loaded yet'}
            </p>
            <div className="row" style={{ margin: 0 }}>
              <button
                type="button"
                onClick={() => void loadConstitution(true)}
                disabled={loadingConstitution}
              >
                {loadingConstitution ? 'Loading…' : 'Reload'}
              </button>
              {constitution && (
                <button
                  type="button"
                  onClick={() =>
                    setReader({
                      kind: 'constitution',
                      source: constitution.source,
                      text: constitution.text,
                    })
                  }
                >
                  Open focused view
                </button>
              )}
            </div>
          </div>

          {constitution ? (
            <article className="reader-prose library-constitution">
              {renderMarkdownLite(constitution.text)}
            </article>
          ) : (
            !loadingConstitution && (
              <p className="reader-empty">Open this tab to load the constitution text.</p>
            )
          )}
        </div>
      )}

      <DocumentReader
        target={reader}
        onClose={() => setReader(null)}
        onProposalUpdated={(proposal) => {
          setProposals((current) =>
            current.map((row) => (row.proposalId === proposal.proposalId ? proposal : row)),
          )
          setReader({ kind: 'proposal', proposal })
        }}
      />
    </section>
  )
}
