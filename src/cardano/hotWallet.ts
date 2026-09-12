import {
  Address,
  Client,
  KeyHash,
  mainnet,
} from '@evolution-sdk/evolution'
import { ccHotBech32 } from './cip129'
import { blockfrostConfig } from './config'
import type { InjectedWallet } from './keypact'

const SKIP_KEYS = new Set(['keypact', 'broclan'])
const PREFERRED_ORDER = [
  'eternl',
  'lace',
  'vespr',
  'nami',
  'typhoncip30',
  'typhon',
  'gerowallet',
  'nufi',
  'yoroi',
  'begin',
  'tokeo',
  'flint',
  'exodus',
]

/** Brave (and some wallet injectors) wrap window.cardano in Proxies that throw if
 *  enumerated via Object.entries/keys. Prefer named lookups; never let listing crash the UI. */
function cardanoNamespace(): Record<string, InjectedWallet | undefined> | null {
  try {
    return window.cardano ?? null
  } catch {
    return null
  }
}

function walletKeys(cardano: Record<string, InjectedWallet | undefined>): string[] {
  const keys = new Set<string>(PREFERRED_ORDER)
  try {
    for (const key of Object.getOwnPropertyNames(cardano)) keys.add(key)
  } catch {
    // ignore proxy invariant errors while enumerating
  }
  try {
    for (const key of Object.keys(cardano)) keys.add(key)
  } catch {
    // ignore
  }
  return [...keys]
}

function readInjectedWallet(
  cardano: Record<string, InjectedWallet | undefined>,
  key: string,
): InjectedWallet | undefined {
  try {
    return cardano[key]
  } catch {
    return undefined
  }
}

export type Cip30WalletApi = {
  getUsedAddresses?: () => Promise<string[]>
  getUnusedAddresses?: () => Promise<string[]>
  getChangeAddress?: () => Promise<string>
  getRewardAddresses?: () => Promise<string[]>
  getUtxos?: (amount?: string, paginate?: unknown) => Promise<string[] | undefined>
  signTx: (tx: string, partialSign?: boolean) => Promise<string>
  signData?: (
    address: string,
    payload: string | Uint8Array,
  ) => Promise<{ signature: string; key?: string }>
  submitTx: (tx: string) => Promise<string>
}

export type HotWallet = {
  name: string
  key: string
  keyHash: KeyHash.KeyHash
  ccHotId: string
  addressBech32: string
  api: Cip30WalletApi
}

export type DetectedCip30 = {
  key: string
  name: string
  icon?: string
  wallet: InjectedWallet
}

export function listCip30Wallets(): DetectedCip30[] {
  const cardano = cardanoNamespace()
  if (!cardano) return []
  const found: DetectedCip30[] = []
  const seen = new Set<string>()

  for (const key of walletKeys(cardano)) {
    if (SKIP_KEYS.has(key) || seen.has(key)) continue
    const wallet = readInjectedWallet(cardano, key)
    if (!wallet) continue
    let enable: InjectedWallet['enable'] | undefined
    let name: string | undefined
    let icon: string | undefined
    try {
      enable = wallet.enable
      name = wallet.name
      icon = wallet.icon
    } catch {
      continue
    }
    if (typeof enable !== 'function') continue
    if (/keypact|broclan/i.test(key + (name ?? ''))) continue
    seen.add(key)
    found.push({
      key,
      name: name ?? key,
      icon,
      wallet,
    })
  }

  return found.sort((a, b) => {
    const ai = PREFERRED_ORDER.indexOf(a.key)
    const bi = PREFERRED_ORDER.indexOf(b.key)
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
  })
}

function parseWalletAddress(raw: string): Address.Address {
  const value = raw.trim()
  if (!value) throw new Error('CIP-30 wallet returned an empty address')
  if (value.startsWith('addr')) return Address.fromBech32(value)
  return Address.fromHex(value.replace(/^0x/i, ''))
}

async function fetchHotAddress(api: Cip30WalletApi): Promise<string> {
  if (api.getChangeAddress) {
    const change = await api.getChangeAddress()
    if (change) return change
  }
  const used = (await api.getUsedAddresses?.()) ?? []
  if (used[0]) return used[0]
  const unused = (await api.getUnusedAddresses?.()) ?? []
  if (unused[0]) return unused[0]
  throw new Error('CIP-30 wallet did not return a payment address')
}

function toEvolutionApi(api: Cip30WalletApi): Cip30WalletApi {
  return {
    getUsedAddresses: async () => (await api.getUsedAddresses?.()) ?? [],
    getUnusedAddresses: async () => (await api.getUnusedAddresses?.()) ?? [],
    getChangeAddress: api.getChangeAddress?.bind(api),
    getRewardAddresses: async () => (await api.getRewardAddresses?.()) ?? [],
    getUtxos: async () => (await api.getUtxos?.()) ?? [],
    signTx: (tx, partialSign) => api.signTx(tx, partialSign ?? true),
    signData: async (address, payload) => {
      if (!api.signData) throw new Error('Wallet does not support signData')
      return api.signData(address, payload)
    },
    submitTx: (tx) => api.submitTx(tx),
  }
}

export async function connectCip30Wallet(detected: DetectedCip30): Promise<HotWallet> {
  const rawApi = (await detected.wallet.enable()) as Cip30WalletApi
  if (typeof rawApi.signTx !== 'function' || typeof rawApi.submitTx !== 'function') {
    throw new Error(`${detected.name} did not expose CIP-30 signTx / submitTx`)
  }
  const api = toEvolutionApi(rawApi)
  const address = parseWalletAddress(await fetchHotAddress(api))
  if (Address.getNetworkId(address) !== 1) {
    throw new Error('Hot wallet is not on Mainnet')
  }
  const payment = address.paymentCredential
  if (payment._tag !== 'KeyHash') {
    throw new Error('Hot wallet address is script-controlled. Connect a key-based CIP-30 wallet.')
  }
  return {
    name: detected.name,
    key: detected.key,
    keyHash: payment,
    ccHotId: ccHotBech32(payment),
    addressBech32: Address.toBech32(address),
    api,
  }
}

export function createSigningClient(wallet: HotWallet) {
  return Client.make(mainnet)
    .withBlockfrost(blockfrostConfig())
    .withCip30(wallet.api as never)
}
