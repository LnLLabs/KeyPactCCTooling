import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import type { HotWallet } from '../cardano/hotWallet'
import type { Cip141Api } from '../cardano/keypact'
import { hasBlockfrostConfigured, seedSettingsFromEnvOnce } from '../cardano/settings'

const LAST_COLD_KEY = 'bsp.cc.lastColdId'

type AppState = {
  hotWallet: HotWallet | null
  setHotWallet: (wallet: HotWallet | null) => void
  keypactName: string | null
  cip141: Cip141Api | null
  setKeypact: (name: string, api: Cip141Api) => void
  lastColdId: string | null
  setLastColdId: (id: string | null) => void
  settingsReady: boolean
  settingsVersion: number
  refreshSettings: () => void
}

const AppContext = createContext<AppState | null>(null)

function readStoredColdId(): string | null {
  try {
    return localStorage.getItem(LAST_COLD_KEY)
  } catch {
    return null
  }
}

seedSettingsFromEnvOnce()

export function AppProvider({ children }: { children: ReactNode }) {
  const [hotWallet, setHotWallet] = useState<HotWallet | null>(null)
  const [keypactName, setKeypactName] = useState<string | null>(null)
  const [cip141, setCip141] = useState<Cip141Api | null>(null)
  const [lastColdId, setLastColdIdState] = useState<string | null>(() => readStoredColdId())
  const [settingsVersion, setSettingsVersion] = useState(0)

  function setLastColdId(id: string | null) {
    setLastColdIdState(id)
    try {
      if (id) localStorage.setItem(LAST_COLD_KEY, id)
      else localStorage.removeItem(LAST_COLD_KEY)
    } catch {
      // ignore storage failures
    }
  }

  function refreshSettings() {
    setSettingsVersion((n) => n + 1)
  }

  const settingsReady = hasBlockfrostConfigured()

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
      settingsReady,
      settingsVersion,
      refreshSettings,
    }),
    [hotWallet, keypactName, cip141, lastColdId, settingsReady, settingsVersion],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppState {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside AppProvider')
  return ctx
}
