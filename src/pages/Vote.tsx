import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatError } from '../cardano/config'
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
import { HotWalletPicker } from '../components/HotWalletPicker'
import { useApp } from '../context/AppContext'

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
        setWarning(check.detail)
      }

      const [open, votes] = await Promise.all([
        fetchProposalList(),
        fetchCommitteeVotes(hotWallet.ccHotId),
      ])
      const pending = pendingProposals(open, votes)
      setProposals(pending)
      setSelected(new Set(pending.map((proposal) => proposal.proposalId)))
      setStatus(`${pending.length} pending action${pending.length === 1 ? '' : 's'}`)
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
    if (authorized === false) {
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
        <button type="button" onClick={() => void refresh()} disabled={loading || busy}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        <button type="button" onClick={() => setSwitching(true)} disabled={busy}>
          Switch wallet
        </button>
        <button type="button" onClick={disconnect} disabled={busy}>
          Disconnect
        </button>
        <button type="button" onClick={selectAll} disabled={proposals.length === 0 || authorized === false}>
          Select all
        </button>
        <button type="button" onClick={selectNone} disabled={selected.size === 0}>
          Clear
        </button>
        <button
          type="button"
          onClick={() => void onVote()}
          disabled={busy || selectedList.length === 0 || authorized === false}
        >
          {busy ? 'Submitting…' : `Cast ${selectedList.length} Yes vote(s)`}
        </button>
      </div>

      {authorized === true && (
        <p className="status">Hot credential is authorized on the committee.</p>
      )}
      {warning && <p className="error">{warning}</p>}

      {proposals.length === 0 && !loading && (
        <p>No pending governance actions for this hot credential.</p>
      )}

      <ul className="proposal-list">
        {proposals.map((proposal) => (
          <li key={proposal.proposalId}>
            <label>
              <input
                type="checkbox"
                checked={selected.has(proposal.proposalId)}
                onChange={() => toggle(proposal.proposalId)}
                disabled={authorized === false}
              />
              <span>
                <strong>{proposal.title}</strong>
                <small>
                  {proposal.type} · {proposal.proposalId}
                  {proposal.expiration != null ? ` · expires epoch ${proposal.expiration}` : ''}
                </small>
              </span>
            </label>
          </li>
        ))}
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
    </section>
  )
}
