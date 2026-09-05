import { useEffect, useState } from 'react'
import {
  connectCip30Wallet,
  listCip30Wallets,
  type DetectedCip30,
  type HotWallet,
} from '../cardano/hotWallet'

type Props = {
  hotWallet: HotWallet | null
  disabled?: boolean
  onConnected: (wallet: HotWallet) => void
  onError: (error: unknown) => void
}

export function HotWalletPicker({ hotWallet, disabled, onConnected, onError }: Props) {
  const [wallets, setWallets] = useState<DetectedCip30[]>(() => listCip30Wallets())
  const [busyKey, setBusyKey] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setInterval(() => setWallets(listCip30Wallets()), 1500)
    return () => window.clearInterval(timer)
  }, [])

  async function connect(detected: DetectedCip30) {
    setBusyKey(detected.key)
    try {
      onConnected(await connectCip30Wallet(detected))
    } catch (error) {
      onError(error)
    } finally {
      setBusyKey(null)
    }
  }

  if (wallets.length === 0) {
    return <p>No CIP-30 wallet extension was detected. Install Lace, Eternl, Vespr, or similar.</p>
  }

  return (
    <div className="wallet-list">
      {wallets.map((wallet) => (
        <button
          key={wallet.key}
          type="button"
          disabled={disabled || busyKey !== null}
          onClick={() => void connect(wallet)}
        >
          {wallet.icon && <img src={wallet.icon} alt="" width={20} height={20} />}
          {busyKey === wallet.key
            ? `Connecting ${wallet.name}…`
            : hotWallet?.key === wallet.key
              ? `Connected: ${wallet.name}`
              : `Connect ${wallet.name}`}
        </button>
      ))}
    </div>
  )
}
