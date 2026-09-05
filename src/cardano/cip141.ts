import {
  Address,
  AddressEras,
  Assets,
  Bytes,
  CBOR,
  Client,
  Data,
  KeyHash,
  PlutusV1,
  PlutusV2,
  PlutusV3,
  Script,
  ScriptHash,
  Transaction,
  TransactionInput,
  TransactionOutput,
  UPLC,
  UTxO,
  mainnet,
} from '@evolution-sdk/evolution'
import { Schema } from 'effect'
import { blockfrostConfig } from './config'
import { unwrapKeypactResponse, type ScriptRequirement } from './keypact'

type TxBuilder = {
  attachScript: (params: { script: Script.Script }) => TxBuilder
  collectFrom: (params: { inputs: UTxO.UTxO[]; redeemer?: Data.Data }) => TxBuilder
  readFrom: (params: { referenceInputs: UTxO.UTxO[] }) => TxBuilder
  addSigner: (params: { keyHash: KeyHash.KeyHash }) => TxBuilder
  setValidity: (params: { from?: bigint; to?: bigint }) => TxBuilder
  authCommitteeHot: (params: {
    coldCredential: ScriptHash.ScriptHash | KeyHash.KeyHash
    hotCredential: KeyHash.KeyHash
    redeemer?: Data.Data
    label?: string
  }) => TxBuilder
  build: (options?: {
    changeAddress?: Address.Address
    availableUtxos?: UTxO.UTxO[]
    passAdditionalUtxos?: boolean
  }) => Promise<{ toTransaction: () => Promise<Transaction.Transaction> }>
}

export type ParsedScript = Script.Script

function asHex(value: unknown): string {
  if (typeof value === 'string') {
    const trimmed = value.trim().replace(/^0x/i, '')
    if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) return trimmed
    return ''
  }
  if (value instanceof Uint8Array) return Bytes.toHex(value)
  if (Array.isArray(value) && value.every((item) => typeof item === 'number')) {
    return Bytes.toHex(Uint8Array.from(value))
  }
  return ''
}

function versionFromUnknown(value: unknown, fallback = 3): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const match = value.match(/(\d+)/)
    if (match) return Number(match[1])
  }
  return fallback
}

function describeScriptPayload(raw: unknown): string {
  if (raw == null) return String(raw)
  if (typeof raw === 'string') return `string(len=${raw.length})`
  if (Array.isArray(raw)) return `array(len=${raw.length}, types=${raw.slice(0, 3).map((item) => typeof item).join(',')})`
  if (raw instanceof Uint8Array) return `bytes(len=${raw.length})`
  if (typeof raw === 'object') return `object(keys=${Object.keys(raw as object).slice(0, 12).join(',')})`
  return typeof raw
}

export function parseWalletScript(raw: unknown): ParsedScript {
  const unwrapped = unwrapKeypactResponse(raw)
  let version = 3
  let scriptHex = ''

  if (Array.isArray(unwrapped) && unwrapped.length >= 2) {
    version = versionFromUnknown(unwrapped[0])
    scriptHex = asHex(unwrapped[1]) || asHex(unwrapped[0])
  } else if (unwrapped instanceof Uint8Array) {
    scriptHex = asHex(unwrapped)
  } else if (unwrapped && typeof unwrapped === 'object') {
    const obj = unwrapped as {
      type?: unknown
      version?: unknown
      plutusVersion?: unknown
      script?: unknown
      cbor?: unknown
      cborHex?: unknown
      bytes?: unknown
    }
    version = versionFromUnknown(obj.version ?? obj.plutusVersion ?? obj.type)
    const nested = unwrapKeypactResponse(obj.script)
    const nestedHex =
      nested && typeof nested === 'object' && !Array.isArray(nested) && !(nested instanceof Uint8Array)
        ? asHex((nested as { script?: unknown; cbor?: unknown }).script ?? (nested as { cbor?: unknown }).cbor)
        : asHex(nested)
    scriptHex = nestedHex || asHex(obj.cbor ?? obj.cborHex ?? obj.bytes)
  } else if (typeof unwrapped === 'string') {
    scriptHex = asHex(unwrapped)
  }

  if (!scriptHex) {
    throw new Error(`Keypact getScript() returned an empty script (${describeScriptPayload(raw)})`)
  }

  // Keypact/Lucid store Plutus scripts as double-CBOR hex. Evolution's PlutusV*
  // bytes and ScriptHash.fromScript expect the on-chain single-CBOR form (what
  // CML stores inside PlutusV3Script after from_cbor_hex(double)).
  const bytes = Bytes.fromHex(UPLC.applySingleCborEncoding(scriptHex))
  if (version <= 1) return new PlutusV1.PlutusV1({ bytes })
  if (version === 2) return new PlutusV2.PlutusV2({ bytes })
  return new PlutusV3.PlutusV3({ bytes })
}

/** Prefer the on-chain scriptRef from CIP-141 reference inputs when present. */
export function scriptFromRequirements(requirement: ScriptRequirement): ParsedScript | undefined {
  for (const hex of requirement.reference_inputs ?? []) {
    try {
      const utxo = utxoFromCborHex(hex)
      if (utxo.scriptRef && utxo.scriptRef._tag.startsWith('Plutus')) {
        return utxo.scriptRef
      }
    } catch {
      // Skip non-CBOR entries; companion may still mix shapes.
    }
  }
  return undefined
}

export function scriptToColdCredential(script: ParsedScript): {
  credential: ScriptHash.ScriptHash
  script: ParsedScript
} {
  return { credential: ScriptHash.fromScript(script), script }
}

function valueToAssets(value: { _tag: string; coin: bigint; assets?: Assets.Assets['multiAsset'] }): Assets.Assets {
  if (value._tag === 'OnlyCoin') return Assets.fromLovelace(value.coin)
  if (value.assets) return Assets.withMultiAsset(value.coin, value.assets)
  return Assets.fromLovelace(value.coin)
}

function eraAddressToAddress(addr: TransactionOutput.TransactionOutput['address']): Address.Address {
  return Schema.decodeSync(Address.FromBytes)(Schema.encodeSync(AddressEras.FromBytes)(addr))
}

function outputToUtxo(
  input: TransactionInput.TransactionInput,
  output: TransactionOutput.TransactionOutput,
): UTxO.UTxO {
  const datumOption =
    output._tag === 'BabbageTransactionOutput'
      ? output.datumOption
      : output.datumHash
  const scriptRef =
    output._tag === 'BabbageTransactionOutput' && output.scriptRef
      ? Script.fromCBOR(output.scriptRef.bytes)
      : undefined

  return new UTxO.UTxO({
    transactionId: input.transactionId,
    index: input.index,
    address: eraAddressToAddress(output.address),
    assets: valueToAssets(output.amount),
    datumOption,
    scriptRef,
  })
}

export function utxoFromCborHex(hex: string): UTxO.UTxO {
  const decoded = CBOR.fromCBORHex(hex.replace(/^0x/, ''))
  if (!CBOR.isArray(decoded) || decoded.length < 2) {
    throw new Error('CIP-141 UTxO is not a transaction_unspent_output pair')
  }
  const input = TransactionInput.fromCBORBytes(CBOR.toCBORBytes(decoded[0]))
  const output = TransactionOutput.fromCBORBytes(CBOR.toCBORBytes(decoded[1]))
  return outputToUtxo(input, output)
}

function parseRedeemer(value: unknown): Data.Data {
  if (value == null) return Data.constr(0n, [])
  if (typeof value === 'string') {
    const hex = value.replace(/^0x/, '')
    if (/^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0) {
      try {
        return Data.fromCBORHex(hex)
      } catch {
        return Data.constr(0n, [])
      }
    }
    return Data.constr(0n, [])
  }
  if (typeof value === 'object' && value !== null) {
    const obj = value as { type?: number | string; redeemer?: string }
    if (obj.redeemer) return parseRedeemer(obj.redeemer)
  }
  return Data.constr(0n, [])
}

function pickRedeemer(redeemers: ScriptRequirement['redeemers'], ...keys: string[]): Data.Data {
  if (!redeemers || typeof redeemers !== 'object') return Data.constr(0n, [])
  const entries = Object.entries(redeemers)
  for (const key of keys) {
    const needle = key.toLowerCase()
    const match = entries.find(([name]) => typeof name === 'string' && name.toLowerCase().includes(needle))
    if (match) return parseRedeemer(match[1])
  }
  const first = Object.values(redeemers)[0]
  return parseRedeemer(first)
}

function parseSignatory(raw: string): KeyHash.KeyHash {
  const hex = raw.replace(/^0x/, '')
  if (/^[0-9a-fA-F]{56}$/.test(hex)) return KeyHash.fromHex(hex)
  return KeyHash.fromBech32(raw)
}

export function applyScriptRequirements(
  builder: TxBuilder,
  requirement: ScriptRequirement,
  script: ParsedScript,
): TxBuilder {
  const refInputs = (requirement.reference_inputs ?? []).map(utxoFromCborHex)
  const scriptHashHex = ScriptHash.toHex(ScriptHash.fromScript(script))
  const scriptOnRef = refInputs.some(
    (utxo) =>
      utxo.scriptRef && ScriptHash.toHex(ScriptHash.fromScript(utxo.scriptRef)) === scriptHashHex,
  )

  // Reference scripts already supply the bytes to the node; attaching Lucid
  // double-CBOR again used to put an un-hashable blob in the witness set.
  let next = scriptOnRef ? builder : builder.attachScript({ script })

  const spendRedeemer = pickRedeemer(requirement.redeemers, 'spend', 'input')
  const inputs = (requirement.inputs ?? []).map(utxoFromCborHex)
  if (inputs.length > 0) {
    next = next.collectFrom({ inputs, redeemer: spendRedeemer })
  }

  if (refInputs.length > 0) {
    next = next.readFrom({ referenceInputs: refInputs })
  }

  for (const hash of requirement.signatories ?? []) {
    next = next.addSigner({ keyHash: parseSignatory(hash) })
  }

  const after = requirement.validity_range?.valid_after
  const before = requirement.validity_range?.valid_before
  if (after != null || before != null) {
    // Match Keypact/Lucid: validFrom(now) when an After lock applies, validTo(before-1s).
    next = next.setValidity({
      from: after != null ? BigInt(Date.now()) : undefined,
      to: before != null ? BigInt(before - 1000) : undefined,
    })
  }

  return next
}

export function certificateRedeemer(requirement: ScriptRequirement): Data.Data {
  return pickRedeemer(requirement.redeemers, 'cert', 'certificate', 'committee')
}

export async function buildUnsignedCbor(built: {
  toTransaction: () => Promise<Transaction.Transaction>
}): Promise<string> {
  const tx = await built.toTransaction()
  return Transaction.toCBORHex(tx)
}

export function createReadClient(changeAddress: Address.Address) {
  return Client.make(mainnet)
    .withBlockfrost(blockfrostConfig())
    .withAddress(Address.toBech32(changeAddress))
}

export function parseWalletAddress(raw: unknown): Address.Address {
  const value = unwrapKeypactResponse(raw)
  const item = Array.isArray(value) ? value[0] : value
  if (typeof item !== 'string' || !item.trim()) {
    throw new Error('Keypact did not return a wallet address')
  }
  const text = item.trim()
  if (text.startsWith('addr')) return Address.fromBech32(text)
  return Address.fromHex(text.replace(/^0x/i, ''))
}

export function changeAddressFromRequirement(requirement: ScriptRequirement): Address.Address {
  const source = requirement.collateral ?? requirement.inputs?.[0]
  if (!source) {
    throw new Error(
      'Script requirements did not include collateral. In Keypact, set a collateral donor (payment key) for the smart wallet.',
    )
  }
  return utxoFromCborHex(source).address
}
