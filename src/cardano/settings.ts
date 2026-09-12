const STORAGE_PREFIX = 'bsp.cc.'

export const DEFAULT_BLOCKFROST_API_URL = 'https://cardano-mainnet.blockfrost.io/api/v0'

export const DEFAULT_RATIONALE_URL =
  'https://gateway.pinata.cloud/ipfs/QmStxNez278vdY6eqWAZBiq6XdGes242G9VEsa3DPdVsL6'

export const DEFAULT_CONSTITUTION_URL =
  'https://raw.githubusercontent.com/IntersectMBO/cardano-constitution/main/cardano-constitution-2/cardano-constitution-2.txt.md'

export type AppSettings = {
  blockfrostProjectId: string
  blockfrostUrl: string
  deepseekApiKey: string
  rationaleUrl: string
  constitutionUrl: string
}

const KEYS = {
  blockfrostProjectId: `${STORAGE_PREFIX}blockfrostProjectId`,
  blockfrostUrl: `${STORAGE_PREFIX}blockfrostUrl`,
  deepseekApiKey: `${STORAGE_PREFIX}deepseekApiKey`,
  rationaleUrl: `${STORAGE_PREFIX}rationaleUrl`,
  constitutionUrl: `${STORAGE_PREFIX}constitutionUrl`,
  seeded: `${STORAGE_PREFIX}seeded`,
} as const

function read(key: string): string {
  try {
    return localStorage.getItem(key)?.trim() ?? ''
  } catch {
    return ''
  }
}

function write(key: string, value: string) {
  try {
    const trimmed = value.trim()
    if (trimmed) localStorage.setItem(key, trimmed)
    else localStorage.removeItem(key)
  } catch {
    // ignore quota / private mode
  }
}

/** Dev-only: optionally copy non-secret URL defaults. Never seeds API keys. */
export function seedSettingsFromEnvOnce() {
  try {
    if (localStorage.getItem(KEYS.seeded)) return
    localStorage.setItem(KEYS.seeded, '1')
  } catch {
    return
  }

  // Do not seed blockfrostProjectId or deepseekApiKey — those must be pasted in Settings.
  const envRationale = import.meta.env.VITE_RATIONALE_URL?.trim()
  const envConstitution = import.meta.env.VITE_CONSTITUTION_URL?.trim()
  const envBfUrl = import.meta.env.VITE_BLOCKFROST_URL?.trim()

  if (envBfUrl && !read(KEYS.blockfrostUrl)) write(KEYS.blockfrostUrl, envBfUrl)
  if (envRationale && !read(KEYS.rationaleUrl)) write(KEYS.rationaleUrl, envRationale)
  if (envConstitution && !read(KEYS.constitutionUrl)) write(KEYS.constitutionUrl, envConstitution)
}

export function loadSettings(): AppSettings {
  return {
    blockfrostProjectId: read(KEYS.blockfrostProjectId),
    blockfrostUrl: read(KEYS.blockfrostUrl),
    deepseekApiKey: read(KEYS.deepseekApiKey),
    rationaleUrl: read(KEYS.rationaleUrl),
    constitutionUrl: read(KEYS.constitutionUrl),
  }
}

export function saveSettings(settings: AppSettings) {
  write(KEYS.blockfrostProjectId, settings.blockfrostProjectId)
  write(KEYS.blockfrostUrl, settings.blockfrostUrl)
  write(KEYS.deepseekApiKey, settings.deepseekApiKey)
  write(KEYS.rationaleUrl, settings.rationaleUrl)
  write(KEYS.constitutionUrl, settings.constitutionUrl)
}

export function clearSettings() {
  for (const key of Object.values(KEYS)) {
    if (key === KEYS.seeded) continue
    try {
      localStorage.removeItem(key)
    } catch {
      // ignore
    }
  }
}

export function getBlockfrostProjectId(): string {
  return loadSettings().blockfrostProjectId
}

export function hasBlockfrostConfigured(): boolean {
  return Boolean(getBlockfrostProjectId())
}

export function getBlockfrostUrl(): string {
  const configured = loadSettings().blockfrostUrl
  if (configured) return configured.replace(/\/$/, '')
  if (import.meta.env.DEV) return '/blockfrost'
  return DEFAULT_BLOCKFROST_API_URL
}

export function getDeepseekApiKey(): string {
  return loadSettings().deepseekApiKey
}

export function getRationaleUrl(): string {
  return loadSettings().rationaleUrl || DEFAULT_RATIONALE_URL
}

export function getConstitutionUrl(): string {
  return loadSettings().constitutionUrl || DEFAULT_CONSTITUTION_URL
}

export function settingsDefaultsForForm(): AppSettings {
  const current = loadSettings()
  return {
    blockfrostProjectId: current.blockfrostProjectId,
    blockfrostUrl: current.blockfrostUrl || (import.meta.env.DEV ? '' : DEFAULT_BLOCKFROST_API_URL),
    deepseekApiKey: current.deepseekApiKey,
    rationaleUrl: current.rationaleUrl || DEFAULT_RATIONALE_URL,
    constitutionUrl: current.constitutionUrl || DEFAULT_CONSTITUTION_URL,
  }
}
