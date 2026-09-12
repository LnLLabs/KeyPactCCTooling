import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatError } from '../cardano/config'
import {
  inspectProposalsConstitutionality,
  loadConstitutionMarkdown,
  type ConstitutionalityResult,
} from '../cardano/constitutionality'
import {
  castYesVotes,
  explorerTxUrl,
  fetchCommitteeVotes,
  fetchProposalList,
  partitionProposalsByVote,
  type Proposal,
  type VotedProposal,
} from '../cardano/governance'
import type { HotWallet } from '../cardano/hotWallet'
import { fetchCommitteeMembers, checkHotAuthorization } from '../cardano/register'
import { DocumentReader, type ReaderTarget } from '../components/DocumentReader'
import { HotWalletPicker } from '../components/HotWalletPicker'
import { MissingSettingsBanner } from '../components/SettingsGate'
import { useApp } from '../context/AppContext'

/** Remove after hot matches the seated cold's active credential on Blockfrost. */
const TEMP_ALLOW_CAST_WITHOUT_AUTH = true

/** Known Keypact cold from registration / NewCommittee seat (fallback if session empty). */
const KNOWN_COLD_ID = 'cc_cold1zd7rfcpypwzq98sfxt673kq67s4x8a2aumdrrutwrxcltdq9jkwn2'

export function VotePage() {
  const { hotWallet, setHotWallet, lastColdId, settingsReady } = useApp()
  const coldId = lastColdId ?? KNOWN_COLD_ID
  const [pending, setPending] = useState<Proposal[]>([])
  const [voted, setVoted] = useState<VotedProposal[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [txHashes, setTxHashes] = useState<string[]>([])
  const [authorized, setAuthorized] = useState<boolean | null>(null)
  const [switching, setSwitching] = useState(false)
  const [inspecting, setInspecting] = useState(false)
  const [inspection, setInspection] = useState<Record<string, ConstitutionalityResult>>({})
  const [reader, setReader] = useState<ReaderTarget | null>(null)

  const canCast = TEMP_ALLOW_CAST_WITHOUT_AUTH || authorized === true

  const allProposals = useMemo(
    () => [...pending, ...voted.map((row) => row.proposal)],
    [pending, voted],
  )

  const selectedList = useMemo(
    () => allProposals.filter((proposal) => selected.has(proposal.proposalId)),
    [allProposals, selected],
  )

  const refresh = useCallback(async () => {
    if (!hotWallet) return
    if (!settingsReady) {
      setWarning(null)
      setError(null)
      setStatus(null)
      return
    }
    setLoading(true)
    setError(null)
    setWarning(null)
    try {
      const members = await fetchCommitteeMembers()
      const check = checkHotAuthorization(members, hotWallet.ccHotId, coldId)
      setAuthorized(check.authorized)
      if (!check.authorized) {
        setWarning(
          TEMP_ALLOW_CAST_WITHOUT_AUTH
            ? `${check.detail} Temporary mode: allowing cast UI anyway.`
            : check.detail,
        )
      }

      const [open, votes] = await Promise.all([
        fetchProposalList(),
        fetchCommitteeVotes(hotWallet.ccHotId),
      ])
      const partitioned = partitionProposalsByVote(open, votes)
      setPending(partitioned.pending)
      setVoted(partitioned.voted)
      setSelected(new Set(partitioned.pending.map((proposal) => proposal.proposalId)))
      setInspection({})
      setStatus(
        `${partitioned.pending.length} pending · ${partitioned.voted.length} already voted · ` +
          `${open.length} active total`,
      )
    } catch (err) {
      setError(formatError(err))
    } finally {
      setLoading(false)
    }
  }, [hotWallet, coldId, settingsReady])

  useEffect(() => {
    if (hotWallet) void refresh()
  }, [hotWallet, refresh])

  function onHotConnected(wallet: HotWallet) {
    setHotWallet(wallet)
    setSwitching(false)
    setAuthorized(null)
    setError(null)
    setWarning(null)
    setTxHashes([])
    setStatus(`Connected ${wallet.name}`)
  }

  function disconnect() {
    setHotWallet(null)
    setSwitching(false)
    setPending([])
    setVoted([])
    setSelected(new Set())
    setAuthorized(null)
    setTxHashes([])
    setInspection({})
    setStatus(null)
    setError(null)
    setWarning(null)
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAllPending() {
    setSelected(new Set(pending.map((proposal) => proposal.proposalId)))
  }

  function selectNone() {
    setSelected(new Set())
  }

  function updateProposal(proposal: Proposal) {
    setPending((current) =>
      current.map((row) => (row.proposalId === proposal.proposalId ? proposal : row)),
    )
    setVoted((current) =>
      current.map((row) =>
        row.proposal.proposalId === proposal.proposalId ? { ...row, proposal } : row,
      ),
    )
  }

  async function onVote() {
    if (!hotWallet) return
    if (!canCast) {
      setError(
        'Cannot cast committee votes: this hot key is not the active authorized hot for a current committee cold. ' +
          (warning ?? ''),
      )
      return
    }
    setBusy(true)
    setError(null)
    setTxHashes([])
    setStatus(`Building a Yes / lgtm batch for ${selectedList.length} action(s)…`)
    try {
      const hashes = await castYesVotes(hotWallet, selectedList)
      setTxHashes(hashes)
      setStatus(`Submitted ${hashes.length} transaction(s). Approve each CIP-30 prompt, then refreshing…`)
      await refresh()
    } catch (err) {
      setError(formatError(err))
    } finally {
      setBusy(false)
    }
  }

  async function onInspect() {
    if (allProposals.length === 0 || inspecting) return
    setInspecting(true)
    setError(null)
    setStatus(`Inspecting constitutionality of ${allProposals.length} proposal(s)…`)
    try {
      await inspectProposalsConstitutionality(allProposals, (proposalId, result) => {
        setInspection((current) => ({ ...current, [proposalId]: result }))
      })
      setStatus('Constitutionality inspection finished')
    } catch (err) {
      setError(formatError(err))
    } finally {
      setInspecting(false)
    }
  }

  async function onReadConstitution() {
    setError(null)
    setStatus('Loading constitution…')
    try {
      const doc = await loadConstitutionMarkdown()
      setReader({ kind: 'constitution', source: doc.source, text: doc.text })
      setStatus(null)
    } catch (err) {
      setError(formatError(err))
    }
  }

  if (!hotWallet?.api || switching) {
    return (
      <section className="panel">
        <h1>Vote</h1>
        <p className="lead">Connect the CIP-30 wallet whose payment key is the authorized hot credential.</p>
        {switching && hotWallet && (
          <p className="status">
            Currently connected: <code>{hotWallet.name}</code> · <code>{hotWallet.ccHotId}</code>
          </p>
        )}
        <HotWalletPicker
          hotWallet={switching ? hotWallet : null}
          onConnected={onHotConnected}
          onError={(err) => setError(formatError(err))}
        />
        {switching && (
          <div className="row">
            <button type="button" onClick={() => setSwitching(false)}>
              Cancel
            </button>
            <button type="button" onClick={disconnect}>
              Disconnect
            </button>
          </div>
        )}
        {error && <p className="error">{error}</p>}
      </section>
    )
  }

  return (
    <section className="panel">
      <h1>Vote</h1>
      {!settingsReady && <MissingSettingsBanner />}
      <p className="lead">
        Voting as <code>{hotWallet.ccHotId}</code> through <code>{hotWallet.name}</code>
        {' '}
        (cold <code>{coldId}</code>)
        . Pending actions are selected by default. Already-voted actions stay listed so you can
        re-cast Yes with rationale <code>lgtm</code> if you need to change them.
      </p>

      <div className="row">
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={!settingsReady || loading || busy || inspecting}
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        <button
          type="button"
          onClick={() => void onInspect()}
          disabled={!settingsReady || inspecting || loading || allProposals.length === 0}
        >
          {inspecting ? 'Inspecting…' : 'Inspect constitutionality'}
        </button>
        <button type="button" onClick={() => void onReadConstitution()} disabled={loading}>
          Read constitution
        </button>
        <button type="button" onClick={() => setSwitching(true)} disabled={busy || inspecting}>
          Switch wallet
        </button>
        <button type="button" onClick={disconnect} disabled={busy || inspecting}>
          Disconnect
        </button>
        <button
          type="button"
          onClick={selectAllPending}
          disabled={!settingsReady || pending.length === 0 || !canCast}
        >
          Select pending
        </button>
        <button type="button" onClick={selectNone} disabled={selected.size === 0}>
          Clear
        </button>
        <button
          type="button"
          onClick={() => void onVote()}
          disabled={!settingsReady || busy || selectedList.length === 0 || !canCast}
        >
          {busy ? 'Submitting…' : `Cast ${selectedList.length} Yes vote(s)`}
        </button>
      </div>

      {authorized === true && (
        <p className="status">Hot credential is authorized on the committee.</p>
      )}
      {warning && <p className="error">{warning}</p>}

      {allProposals.length === 0 && !loading && (
        <p>No active governance actions in the voting period.</p>
      )}

      {pending.length > 0 && (
        <section className="vote-section">
          <h2>Pending ({pending.length})</h2>
          <p className="section-lead">Not yet voted with this hot credential.</p>
          <ProposalList
            proposals={pending}
            selected={selected}
            canCast={canCast}
            inspection={inspection}
            onToggle={toggle}
            onRead={(proposal) => setReader({ kind: 'proposal', proposal })}
          />
        </section>
      )}

      {voted.length > 0 && (
        <section className="vote-section">
          <h2>Already voted ({voted.length})</h2>
          <p className="section-lead">
            Prior votes from this hot. Select any to re-submit Yes / lgtm and overwrite on-chain.
          </p>
          <ProposalList
            proposals={voted.map((row) => row.proposal)}
            selected={selected}
            canCast={canCast}
            inspection={inspection}
            priorVotes={Object.fromEntries(
              voted.map((row) => [row.proposal.proposalId, row.vote]),
            )}
            onToggle={toggle}
            onRead={(proposal) => setReader({ kind: 'proposal', proposal })}
          />
        </section>
      )}

      {status && <p className="status">{status}</p>}
      {error && <p className="error">{error}</p>}
      {txHashes.length > 0 && (
        <ul className="hashes">
          {txHashes.map((hash) => (
            <li key={hash}>
              <a href={explorerTxUrl(hash)} target="_blank" rel="noreferrer">
                {hash}
              </a>
            </li>
          ))}
        </ul>
      )}

      <DocumentReader
        target={reader}
        onClose={() => setReader(null)}
        onProposalUpdated={(proposal) => {
          updateProposal(proposal)
          setReader({ kind: 'proposal', proposal })
        }}
      />
    </section>
  )
}

function ProposalList({
  proposals,
  selected,
  canCast,
  inspection,
  priorVotes,
  onToggle,
  onRead,
}: {
  proposals: Proposal[]
  selected: Set<string>
  canCast: boolean
  inspection: Record<string, ConstitutionalityResult>
  priorVotes?: Record<string, string | null>
  onToggle: (id: string) => void
  onRead: (proposal: Proposal) => void
}) {
  return (
    <ul className="proposal-list">
      {proposals.map((proposal) => {
        const result = inspection[proposal.proposalId]
        const prior = priorVotes?.[proposal.proposalId]
        return (
          <li key={proposal.proposalId}>
            <label>
              <input
                type="checkbox"
                checked={selected.has(proposal.proposalId)}
                onChange={() => onToggle(proposal.proposalId)}
                disabled={!canCast}
              />
              <span>
                <strong>{proposal.title}</strong>
                <small>
                  {proposal.type} · {proposal.proposalId}
                  {proposal.expiration != null ? ` · expires epoch ${proposal.expiration}` : ''}
                  {prior ? ` · prior vote: ${prior}` : ''}
                </small>
              </span>
            </label>
            <div className="proposal-actions">
              <button type="button" className="ghost-btn" onClick={() => onRead(proposal)}>
                Read
              </button>
              <ConstitutionalityBadge result={result} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function ConstitutionalityBadge({ result }: { result?: ConstitutionalityResult }) {
  if (!result) return null
  if (result.status === 'pending') {
    return <span className="constitution-badge pending">Queued</span>
  }
  if (result.status === 'running') {
    return <span className="constitution-badge running">Checking…</span>
  }
  if (result.status === 'error') {
    return (
      <span className="constitution-badge error" title={result.error}>
        {result.error ?? 'Inspection failed'}
      </span>
    )
  }
  if (result.verdict === 'fine') {
    return (
      <span className="constitution-badge fine" title={result.reasoning ?? 'Fine'} aria-label="Fine">
        ✓
      </span>
    )
  }
  if (result.verdict === 'clear_violation') {
    return (
      <details className="constitution-flag">
        <summary>⚠ Clear violation</summary>
        <p>{result.reasoning}</p>
      </details>
    )
  }
  return null
}
