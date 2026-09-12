import { useEffect, useState } from 'react'
import { formatError } from '../cardano/config'
import { explorerTxUrl } from '../cardano/governance'
import type { HotWallet } from '../cardano/hotWallet'
import { detectKeypact, enableKeypact } from '../cardano/keypact'
import {
  checkHotAuthorization,
  fetchCommitteeMembers,
  registerHotKey,
} from '../cardano/register'
import { HotWalletPicker } from '../components/HotWalletPicker'
import { MissingSettingsBanner } from '../components/SettingsGate'
import { useApp } from '../context/AppContext'

export function RegisterPage() {
  const {
    hotWallet,
    setHotWallet,
    keypactName,
    setKeypact,
    cip141,
    lastColdId,
    setLastColdId,
    settingsReady,
  } = useApp()
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [authorized, setAuthorized] = useState(false)
  const [walletPresent, setWalletPresent] = useState(Boolean(detectKeypact()))

  useEffect(() => {
    const timer = window.setInterval(() => setWalletPresent(Boolean(detectKeypact())), 1500)
    return () => window.clearInterval(timer)
  }, [])

  async function connectWallet() {
    setError(null)
    try {
      const connected = await enableKeypact()
      setKeypact(connected.name, connected.cip141)
      setStatus(`Connected ${connected.name} with CIP-141`)
    } catch (err) {
      setError(formatError(err))
    }
  }

  function onHotConnected(wallet: HotWallet) {
    setHotWallet(wallet)
    setAuthorized(false)
    setError(null)
    setStatus(`Fetched hot address from ${wallet.name}`)
  }

  async function onRegister() {
    if (!settingsReady) {
      setError('Configure Blockfrost in Settings first')
      return
    }
    if (!cip141) {
      setError('Connect Keypact first')
      return
    }
    if (!hotWallet) {
      setError('Connect a CIP-30 hot wallet first')
      return
    }
    setBusy(true)
    setError(null)
    setStatus('Building the CIP-141 authorization transaction…')
    try {
      const result = await registerHotKey(cip141, hotWallet)
      setTxHash(result.txHash)
      setLastColdId(result.coldId)
      setStatus(`Submitted ${result.txHash}. Waiting for Keypact signatures, then polling committee state…`)
      await pollAuthorization(hotWallet.ccHotId, result.coldId)
    } catch (err) {
      setError(formatError(err))
    } finally {
      setBusy(false)
    }
  }

  async function pollAuthorization(hotId: string, coldId: string) {
    for (let i = 0; i < 20; i++) {
      try {
        const members = await fetchCommitteeMembers()
        const check = checkHotAuthorization(members, hotId, coldId)
        if (check.authorized) {
          setAuthorized(true)
          setStatus(check.detail)
          return
        }
        // Cold not on roster will never flip via indexer lag — stop early.
        if (check.detail.includes('not on the current constitutional committee')) {
          setStatus(check.detail)
          return
        }
      } catch {
        // Indexer lag is expected immediately after submit.
      }
      await new Promise((resolve) => window.setTimeout(resolve, 15000))
    }
    try {
      const members = await fetchCommitteeMembers()
      setStatus(checkHotAuthorization(members, hotId, coldId).detail)
    } catch {
      setStatus('Submitted. Blockfrost has not yet shown the new hot credential — check again in a minute.')
    }
  }

  return (
    <section className="panel">
      <h1>Hot key registration</h1>
      {!settingsReady && <MissingSettingsBanner />}
      <p className="lead">
        The cold credential is your Keypact smart wallet script. The hot credential is the payment
        key of a CIP-30 wallet. This page builds an <code>authCommitteeHot</code> transaction with
        CIP-141 and sends the unsigned CBOR to Keypact.
      </p>

      <div className="card">
        <h2>1. Connect Keypact</h2>
        <p>{walletPresent ? 'Keypact / BroClan was detected.' : 'Waiting for the Keypact companion extension…'}</p>
        <button type="button" onClick={connectWallet} disabled={busy}>
          {keypactName ? `Connected: ${keypactName}` : 'Connect Keypact'}
        </button>
      </div>

      <div className="card">
        <h2>2. CIP-30 hot wallet</h2>
        <p>Connect the wallet that will vote. Its payment address is used as the committee hot credential.</p>
        <HotWalletPicker
          hotWallet={hotWallet}
          disabled={busy}
          onConnected={onHotConnected}
          onError={(err) => setError(formatError(err))}
        />
        {hotWallet?.api && (
          <dl className="meta">
            <div>
              <dt>Wallet</dt>
              <dd>{hotWallet.name}</dd>
            </div>
            <div>
              <dt>CC hot id</dt>
              <dd>{hotWallet.ccHotId}</dd>
            </div>
            <div>
              <dt>Payment address</dt>
              <dd>{hotWallet.addressBech32}</dd>
            </div>
            {lastColdId && (
              <div>
                <dt>Last cold id</dt>
                <dd>{lastColdId}</dd>
              </div>
            )}
          </dl>
        )}
      </div>

      <div className="card">
        <h2>3. Authorize on-chain</h2>
        <button
          type="button"
          onClick={onRegister}
          disabled={!settingsReady || busy || !cip141 || !hotWallet}
        >          {busy ? 'Submitting…' : 'Register hot key'}
        </button>
        {authorized && <p className="ok">Hot key is authorized.</p>}
        {txHash && (
          <p>
            <a href={explorerTxUrl(txHash)} target="_blank" rel="noreferrer">
              View {txHash.slice(0, 12)}… on Cardanoscan
            </a>
          </p>
        )}
      </div>

      {status && <p className="status">{status}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  )
}
