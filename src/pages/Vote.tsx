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
  pendingProposals,
  type Proposal,
} from '../cardano/governance'
import type { HotWallet } from '../cardano/hotWallet'
import { fetchCommitteeMembers, checkHotAuthorization } from '../cardano/register'
import { DocumentReader, type ReaderTarget } from '../components/DocumentReader'
import { HotWalletPicker } from '../components/HotWalletPicker'
import { useApp } from '../context/AppContext'

/** Remove after NewCommittee enacts (epoch 654+): skip per-hot vote filter + unlock cast UI. */
const TEMP_LIST_ALL_OPEN_PROPOSALS = true

export function VotePage() {
  const { hotWallet, setHotWallet, lastColdId } = useApp()
  const [proposals, setProposals] = useState<Proposal[]>([])
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

  const canCast = TEMP_LIST_ALL_OPEN_PROPOSALS || authorized === true

  const selectedList = useMemo(
    () => proposals.filter((proposal) => selected.has(proposal.proposalId)),
    [proposals, selected],
  )

  const refresh = useCallback(async () => {
    if (!hotWallet) return
    setLoading(true)
    setError(null)
    setWarning(null)
    try {
      const members = await fetchCommitteeMembers()
      const check = checkHotAuthorization(members, hotWallet.ccHotId, lastColdId ?? undefined)
      setAuthorized(check.authorized)
      if (!check.authorized) {
        setWarning(
          TEMP_LIST_ALL_OPEN_PROPOSALS
            ? `${check.detail} Temporary mode: listing active proposals and allowing cast UI anyway.`
            : check.detail,
        )
      }

      const open = await fetchProposalList()
      let listed = open
      if (!TEMP_LIST_ALL_OPEN_PROPOSALS) {
        const votes = await fetchCommitteeVotes(hotWallet.ccHotId)
        listed = pendingProposals(open, votes)
      }
      setProposals(listed)
      setSelected(new Set(listed.map((proposal) => proposal.proposalId)))
      setInspection({})
      setStatus(`${listed.length} active governance action${listed.length === 1 ? '' : 's'}`)
    } catch (err) {
      setError(formatError(err))
    } finally {
      setLoading(false)
    }
  }, [hotWallet, lastColdId])

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
    setProposals([])
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

  function selectAll() {
    setSelected(new Set(proposals.map((proposal) => proposal.proposalId)))
  }

  function selectNone() {
    setSelected(new Set())
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
    if (proposals.length === 0 || inspecting) return
    setInspecting(true)
    setError(null)
    setStatus(`Inspecting constitutionality of ${proposals.length} proposal(s)…`)
    try {
      await inspectProposalsConstitutionality(proposals, (proposalId, result) => {
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
      <h1>Pending votes</h1>
      <p className="lead">
        Voting as <code>{hotWallet.ccHotId}</code> through <code>{hotWallet.name}</code>
        {lastColdId ? (
          <>
            {' '}
            (cold <code>{lastColdId}</code>)
          </>
        ) : null}
        . Selected actions are cast Yes with rationale <code>lgtm</code> in a single transaction when
        they fit. Approve the CIP-30 prompt to sign.
      </p>

      <div className="row">
        <button type="button" onClick={() => void refresh()} disabled={loading || busy || inspecting}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        <button
          type="button"
          onClick={() => void onInspect()}
          disabled={inspecting || loading || proposals.length === 0}
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
        <button type="button" onClick={selectAll} disabled={proposals.length === 0 || !canCast}>
          Select all
        </button>
        <button type="button" onClick={selectNone} disabled={selected.size === 0}>
          Clear
        </button>
        <button
          type="button"
          onClick={() => void onVote()}
          disabled={busy || selectedList.length === 0 || !canCast}
        >
          {busy ? 'Submitting…' : `Cast ${selectedList.length} Yes vote(s)`}
        </button>
      </div>

      {authorized === true && (
        <p className="status">Hot credential is authorized on the committee.</p>
      )}
      {warning && <p className="error">{warning}</p>}

      {proposals.length === 0 && !loading && (
        <p>No active governance actions in the voting period.</p>
      )}

      <ul className="proposal-list">
        {proposals.map((proposal) => {
          const result = inspection[proposal.proposalId]
          return (
            <li key={proposal.proposalId}>
              <label>
                <input
                  type="checkbox"
                  checked={selected.has(proposal.proposalId)}
                  onChange={() => toggle(proposal.proposalId)}
                  disabled={!canCast}
                />
                <span>
                  <strong>{proposal.title}</strong>
                  <small>
                    {proposal.type} · {proposal.proposalId}
                    {proposal.expiration != null ? ` · expires epoch ${proposal.expiration}` : ''}
                  </small>
                </span>
              </label>
              <div className="proposal-actions">
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => setReader({ kind: 'proposal', proposal })}
                >
                  Read
                </button>
                <ConstitutionalityBadge result={result} />
              </div>
            </li>
          )
        })}
      </ul>

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
          setProposals((current) =>
            current.map((row) => (row.proposalId === proposal.proposalId ? proposal : row)),
          )
          setReader({ kind: 'proposal', proposal })
        }}
      />
    </section>
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
