import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import type { HotWallet } from '../cardano/hotWallet'
import type { Cip141Api } from '../cardano/keypact'

const LAST_COLD_KEY = 'keypacktcc.lastColdId'

type AppState = {
  hotWallet: HotWallet | null
  setHotWallet: (wallet: HotWallet | null) => void
  keypactName: string | null
  cip141: Cip141Api | null
  setKeypact: (name: string, api: Cip141Api) => void
  lastColdId: string | null
  setLastColdId: (id: string | null) => void
}

const AppContext = createContext<AppState | null>(null)

function readStoredColdId(): string | null {
  try {
    return localStorage.getItem(LAST_COLD_KEY)
  } catch {
    return null
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [hotWallet, setHotWallet] = useState<HotWallet | null>(null)
  const [keypactName, setKeypactName] = useState<string | null>(null)
  const [cip141, setCip141] = useState<Cip141Api | null>(null)
  const [lastColdId, setLastColdIdState] = useState<string | null>(() => readStoredColdId())

  function setLastColdId(id: string | null) {
    setLastColdIdState(id)
    try {
      if (id) localStorage.setItem(LAST_COLD_KEY, id)
      else localStorage.removeItem(LAST_COLD_KEY)
    } catch {
      // ignore storage failures
    }
  }

  const value = useMemo<AppState>(
    () => ({
      hotWallet,
      setHotWallet,
      keypactName,
      cip141,
      setKeypact: (name, api) => {
        setKeypactName(name)
        setCip141(api)
      },
      lastColdId,
      setLastColdId,
    }),
    [hotWallet, keypactName, cip141, lastColdId],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppState {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside AppProvider')
  return ctx
}
