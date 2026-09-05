import { bech32 } from '@scure/base'
import type { KeyHash, ScriptHash } from '@evolution-sdk/evolution'

/**
 * CIP-129 governance credential bech32 helpers.
 *
 * Evolution 0.5.13 encodes wrong header bytes (e.g. cc_hot KeyHash as 0x1e).
 * Blockfrost and explorers expect the CIP-129 headers below.
 *
 * | Role   | Credential  | Header |
 * |--------|-------------|--------|
 * | CC Hot | KeyHash     | 0x02   |
 * | CC Hot | ScriptHash  | 0x03   |
 * | CC Cold| KeyHash     | 0x12   |
 * | CC Cold| ScriptHash  | 0x13   |
 */

type Credential = KeyHash.KeyHash | ScriptHash.ScriptHash

function isKeyHash(credential: Credential): credential is KeyHash.KeyHash {
  return credential._tag === 'KeyHash'
}

function encode(prefix: 'cc_hot' | 'cc_cold', header: number, credential: Credential): string {
  const hash = credential.hash
  if (hash.length !== 28) {
    throw new Error(`CIP-129 credential hash must be 28 bytes, got ${hash.length}`)
  }
  const bytes = new Uint8Array(29)
  bytes[0] = header
  bytes.set(hash, 1)
  return bech32.encode(prefix, bech32.toWords(bytes))
}

export function ccHotBech32(credential: Credential): string {
  return encode('cc_hot', isKeyHash(credential) ? 0x02 : 0x03, credential)
}

export function ccColdBech32(credential: Credential): string {
  return encode('cc_cold', isKeyHash(credential) ? 0x12 : 0x13, credential)
}
