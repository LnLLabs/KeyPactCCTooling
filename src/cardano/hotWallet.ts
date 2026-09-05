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
  'gerowallet',
  'nufi',
  'yoroi',
  'begin',
  'tokeo',
]

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
  const cardano = window.cardano
  if (!cardano) return []
  const found: DetectedCip30[] = []
  for (const [key, wallet] of Object.entries(cardano)) {
    if (!wallet?.enable || SKIP_KEYS.has(key)) continue
    if (/keypact|broclan/i.test(key + (wallet.name ?? ''))) continue
    found.push({
      key,
      name: wallet.name ?? key,
      icon: wallet.icon,
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
