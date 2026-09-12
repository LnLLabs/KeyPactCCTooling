export type ScriptRequirement = {
  collateral?: string
  inputs?: string[]
  reference_inputs?: string[]
  outputs?: string[]
  mint?: string
  certificates?: string[]
  withdrawals?: Record<string, number>
  validity_range?: {
    valid_before?: number
    valid_after?: number
  }
  signatories?: string[]
  redeemers?: Record<string, unknown>
  datums?: Array<[string, string] | { hash: string; data: string }>
}

export type Cip141Api = {
  getScriptRequirements: () => Promise<unknown>
  getScript: () => Promise<unknown>
  submitUnsignedTx: (tx: string) => Promise<string>
  getCompletedTx?: (txId: string) => Promise<[string, string]>
  getWalletAddress?: () => Promise<unknown>
}

export type Cip30Api = {
  getUsedAddresses?: () => Promise<unknown>
  getUnusedAddresses?: () => Promise<unknown>
  getChangeAddress?: () => Promise<unknown>
  cip141?: Cip141Api
}

export type InjectedWallet = {
  name: string
  apiVersion?: string
  icon?: string
  supportedExtensions?: unknown[]
  // Keypact takes a positional CIP/version list. CIP-30 wallets take { extensions: [{ cip }] }.
  enable: (extensions?: unknown) => Promise<Cip30Api>
  isEnabled?: () => Promise<boolean>
}

declare global {
  interface Window {
    cardano?: Record<string, InjectedWallet | undefined>
  }
}

const WALLET_KEYS = ['keypact', 'broclan'] as const

export function detectKeypact(): { key: string; wallet: InjectedWallet } | null {
  let cardano: Record<string, InjectedWallet | undefined> | undefined
  try {
    cardano = window.cardano
  } catch {
    return null
  }
  if (!cardano) return null

  for (const key of WALLET_KEYS) {
    try {
      const wallet = cardano[key]
      if (wallet?.enable) return { key, wallet }
    } catch {
      // Brave proxy invariant on some injectors
    }
  }

  const keys = new Set<string>(WALLET_KEYS)
  try {
    for (const key of Object.getOwnPropertyNames(cardano)) keys.add(key)
  } catch {
    // stick to known keys
  }

  for (const key of keys) {
    try {
      const wallet = cardano[key]
      if (wallet?.enable && /keypact|broclan/i.test(key + (wallet.name ?? ''))) {
        return { key, wallet }
      }
    } catch {
      // continue
    }
  }
  return null
}

async function keypactEnableArg(wallet: InjectedWallet): Promise<unknown[]> {
  for (let i = 0; i < 20; i++) {
    const supported = wallet.supportedExtensions
    if (Array.isArray(supported) && supported.length > 0) return supported
    await new Promise((resolve) => window.setTimeout(resolve, 150))
  }
  return [141]
}

export async function enableKeypact(): Promise<{
  name: string
  api: Cip30Api
  cip141: Cip141Api
}> {
  const detected = detectKeypact()
  if (!detected) {
    throw new Error('Keypact / BroClan wallet was not found. Install the companion extension and unlock the smart wallet.')
  }
  // Keypact's injected enable() is `enable(extensions: unknown[])` and calls
  // `extensions.includes(...)`. Passing the CIP-30 options object throws
  // "t.includes is not a function".
  const api = await detected.wallet.enable(await keypactEnableArg(detected.wallet))
  const cip141 = api.cip141
  if (!cip141?.getScriptRequirements || !cip141.getScript || !cip141.submitUnsignedTx) {
    throw new Error('Connected wallet did not expose CIP-141. Enable the Plutus / smart-wallet extension.')
  }
  const wrapped: Cip141Api = {
    getScriptRequirements: async () => {
      try {
        return unwrapKeypactResponse(await cip141.getScriptRequirements())
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        // Keypact Messaging.ts does `response.collateral = …` even when the wallet returned false.
        if (/collateral|false|not enough signers|default signer/i.test(message)) {
          throw new Error(
            'Keypact could not build script requirements. Open the smart wallet in Keypact, set default signers that satisfy the spend condition, set a collateral donor, then reconnect.',
          )
        }
        throw error
      }
    },
    getScript: async () => unwrapKeypactResponse(await cip141.getScript()),
    submitUnsignedTx: async (tx) => {
      const result = unwrapKeypactResponse(await cip141.submitUnsignedTx(tx))
      if (typeof result === 'string') return result
      if (result && typeof result === 'object' && 'txHash' in result) {
        return String((result as { txHash: unknown }).txHash)
      }
      return String(result)
    },
    getCompletedTx: cip141.getCompletedTx
      ? async (txId) => unwrapKeypactResponse(await cip141.getCompletedTx!(txId)) as [string, string]
      : undefined,
    getWalletAddress: async () => {
      if (api.getChangeAddress) return unwrapKeypactResponse(await api.getChangeAddress())
      if (api.getUsedAddresses) return unwrapKeypactResponse(await api.getUsedAddresses())
      if (api.getUnusedAddresses) return unwrapKeypactResponse(await api.getUnusedAddresses())
      return undefined
    },
  }
  return { name: detected.wallet.name ?? detected.key, api, cip141: wrapped }
}

function describePayload(raw: unknown): string {
  if (raw == null) return String(raw)
  if (typeof raw === 'string') return `string(len=${raw.length})`
  if (typeof raw !== 'object') return typeof raw
  if (Array.isArray(raw)) {
    return `array(len=${raw.length}, head=${raw.slice(0, 2).map((item) => typeof item).join(',')})`
  }
  return `object(keys=${Object.keys(raw as object).slice(0, 12).join(',')})`
}

function isScriptTuple(value: unknown): value is [unknown, unknown] {
  if (!Array.isArray(value) || value.length < 2) return false
  const version = value[0]
  const script = value[1]
  const versionOk =
    (typeof version === 'number' && version >= 1 && version <= 3) ||
    (typeof version === 'string' && /plutusv?[123]/i.test(version))
  const scriptOk =
    typeof script === 'string' ||
    script instanceof Uint8Array ||
    (Array.isArray(script) && script.every((item) => typeof item === 'number'))
  return versionOk && scriptOk
}

function looksLikeRequirement(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Uint8Array) {
    return false
  }
  const obj = value as Record<string, unknown>
  return (
    'collateral' in obj ||
    'inputs' in obj ||
    'reference_inputs' in obj ||
    'signatories' in obj ||
    'redeemers' in obj ||
    'datums' in obj ||
    'validity_range' in obj ||
    'certificates' in obj ||
    'withdrawals' in obj ||
    'outputs' in obj ||
    'mint' in obj
  )
}

/** Peel Keypact chrome-message envelopes without mangling CIP-141 payloads. */
export function unwrapKeypactResponse(raw: unknown, depth = 0): unknown {
  if (depth > 5 || raw == null) return raw
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        return unwrapKeypactResponse(JSON.parse(trimmed) as unknown, depth + 1)
      } catch {
        return raw
      }
    }
    return raw
  }
  if (Array.isArray(raw)) {
    if (raw.length === 1) return unwrapKeypactResponse(raw[0], depth + 1)
    return raw
  }
  if (typeof raw !== 'object' || raw instanceof Uint8Array) return raw
  const obj = raw as Record<string, unknown>
  if (obj.error != null) {
    const message =
      typeof obj.error === 'string'
        ? obj.error
        : obj.error && typeof obj.error === 'object' && 'message' in obj.error
          ? String((obj.error as { message: unknown }).message)
          : 'Keypact returned an error'
    throw new Error(message)
  }
  // Only unwrap clear transport envelopes, never CIP-141 requirement / script bodies.
  if ('response' in obj && (Object.keys(obj).length <= 3 || 'action' in obj)) {
    return unwrapKeypactResponse(obj.response, depth + 1)
  }
  // Sparse array clone: {0: 3, 1: "cbor…"} from getScript only.
  if (obj[0] != null && obj[1] != null && isScriptTuple([obj[0], obj[1]])) {
    return [obj[0], obj[1]]
  }
  return raw
}

function normalizeValidity(raw: ScriptRequirement['validity_range'] | { from?: number; to?: number } | undefined) {
  if (!raw) return undefined
  const range = raw as {
    valid_before?: number
    valid_after?: number
    before?: number
    after?: number
    from?: number
    to?: number
  }
  // Keypact getScriptRequirements maps checkSigners as:
  //   from ← before (unix ms upper bound / validTo)
  //   to   ← after  (unix ms lower bound / validFrom marker)
  // which is inverted vs CIP-141 valid_after/valid_before names.
  const valid_before = range.valid_before ?? range.before ?? range.from
  const valid_after = range.valid_after ?? range.after ?? range.to
  if (valid_before == null && valid_after == null) return undefined
  return {
    valid_before: valid_before ?? undefined,
    valid_after: valid_after ?? undefined,
  }
}

const REQUIREMENTS_NOT_READY =
  'Keypact getScriptRequirements() returned no usable ScriptRequirement. In the Keypact app, open the smart wallet, set default signers that satisfy the spend condition, and set a collateral donor — then reconnect and try again.'

function requirementsNotReady(raw: unknown): Error {
  if (raw === false) {
    return new Error(
      'Keypact refused script requirements (false): default signers do not satisfy this smart wallet. ' +
        REQUIREMENTS_NOT_READY,
    )
  }
  if (raw === true) {
    return new Error(
      'Keypact returned true instead of ScriptRequirement[]. ' + REQUIREMENTS_NOT_READY,
    )
  }
  return new Error(`${REQUIREMENTS_NOT_READY} (got ${describePayload(raw)})`)
}

function asRequirement(raw: unknown): ScriptRequirement {
  if (!looksLikeRequirement(raw)) {
    throw requirementsNotReady(raw)
  }
  const req = raw as ScriptRequirement & { validity_range?: { from?: number; to?: number } }
  return {
    ...req,
    collateral: req.collateral ?? undefined,
    validity_range: normalizeValidity(req.validity_range),
  }
}

export function firstRequirement(requirements: unknown): ScriptRequirement {
  const unwrapped = unwrapKeypactResponse(requirements)
  // Keypact SmartWallet.getScriptRequirements() returns false when checkSigners(defaultSigners) fails.
  if (typeof unwrapped === 'boolean' || unwrapped == null) {
    throw requirementsNotReady(unwrapped)
  }
  // CIP-141: ScriptRequirement[]. Keypact smart wallets currently return one object.
  if (looksLikeRequirement(unwrapped)) return asRequirement(unwrapped)
  if (Array.isArray(unwrapped)) {
    if (unwrapped.length === 0) throw requirementsNotReady(unwrapped)
    if (isScriptTuple(unwrapped)) {
      throw new Error(
        'Keypact getScriptRequirements() returned a script tuple. Reconnect Keypact and try again.',
      )
    }
    const match = unwrapped.find(looksLikeRequirement)
    if (match) return asRequirement(match)
  }
  throw requirementsNotReady(unwrapped)
}
