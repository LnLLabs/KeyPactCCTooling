import { Anchor, Url } from '@evolution-sdk/evolution'
import { blake2b } from '@noble/hashes/blake2.js'
import { assertPublicRationaleUrl } from './config'
import { getPinataJwt } from './settings'

const MAX_ANCHOR_URL_BYTES = 128

/**
 * Public files uploaded with network=public are served here, with
 * Access-Control-Allow-Origin: *. ipfs.io and dweb.link answer browser
 * fetches with 403, and w3s.link only redirects, so they cannot be checked
 * from the app.
 */
const PUBLIC_IPFS_GATEWAYS = ['https://gateway.pinata.cloud/ipfs']

type PinataUploadResponse = {
  data?: { cid?: string }
  error?: string | { reason?: string; details?: string }
}

function pinataUploadUrl(): string {
  // Dev goes through Vite so a rejected token is not hidden behind a CORS error.
  if (import.meta.env.DEV) return '/pinata-upload/v3/files'
  return 'https://uploads.pinata.cloud/v3/files'
}

/** The dashboard shows a key, a secret, and a JWT. Only the JWT is accepted here. */
function pinataToken(value: string): string {
  return value
    .trim()
    .replace(/^Bearer\s+/i, '')
    .replace(/^["']|["']$/g, '')
    .replace(/\s+/g, '')
}

/**
 * Upload the exact rationale bytes and return an anchor whose hash is
 * blake2b-256 of the bytes the public gateway actually serves.
 */
export async function publishNoRationale(bytes: Uint8Array, name: string): Promise<Anchor.Anchor> {
  if (bytes.length === 0) throw new Error('Refusing to pin an empty rationale')
  const jwt = pinataToken(getPinataJwt())
  if (!jwt) {
    throw new Error('Save a Pinata JWT in Settings before casting No votes.')
  }
  if (!jwt.startsWith('eyJ')) {
    throw new Error(
      'That Pinata value is not a JWT. On the API key page, copy the JWT. It starts with eyJ. The API key and the API secret will not authorize an upload.',
    )
  }

  const cid = await pinFile(bytes, name, jwt)
  const url = await resolvePublicGateway(cid, bytes)

  return new Anchor.Anchor({
    anchorUrl: new Url.Url({ href: url }),
    anchorDataHash: blake2b(bytes, { dkLen: 32 }),
  })
}

async function resolvePublicGateway(cid: string, bytes: Uint8Array): Promise<string> {
  const urls = PUBLIC_IPFS_GATEWAYS.map((prefix) => `${prefix}/${cid}`).filter(
    (url) => new TextEncoder().encode(url).length <= MAX_ANCHOR_URL_BYTES,
  )
  let lastStatus = 'no gateway responded'
  for (let attempt = 0; attempt < 4; attempt++) {
    for (const url of urls) {
      try {
        const response = await fetch(url, { cache: 'no-store' })
        if (!response.ok) {
          lastStatus = `${url} (${response.status})`
          continue
        }
        const served = new Uint8Array(await response.arrayBuffer())
        if (!sameBytes(served, bytes)) {
          lastStatus = `${url} (bytes did not match)`
          continue
        }
        return assertPublicRationaleUrl(url)
      } catch (error) {
        lastStatus = `${url} (${error instanceof Error ? error.message : String(error)})`
      }
    }
    if (attempt < 3) await delay(1500)
  }
  throw new Error(
    `The rationale was pinned as ${cid}, but no public IPFS gateway is serving those bytes yet (${lastStatus}). The No vote was not submitted.`,
  )
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function pinFile(bytes: Uint8Array, name: string, jwt: string): Promise<string> {
  const filename = name.endsWith('.jsonld') ? name : `${name}.jsonld`
  const copy = new Uint8Array(bytes)
  const form = new FormData()
  form.append('network', 'public')
  form.append('name', filename)
  form.append('cid_version', 'v0')
  form.append('file', new Blob([copy.buffer], { type: 'application/ld+json' }), filename)

  const response = await fetch(pinataUploadUrl(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
    body: form,
  })
  const raw = await response.text()
  if (response.status === 401) {
    throw new Error(
      'Pinata rejected this token (401 Not Authorized). Create a new API key with Files: Write, then paste its JWT into Settings. The JWT is the long value that starts with eyJ, not the API key or the secret.',
    )
  }
  if (response.status === 403) {
    throw new Error(
      'Pinata refused the upload (403). The key needs Files: Write, and it must be the JWT from that key.',
    )
  }
  if (!response.ok) {
    throw new Error(`Pinata pin failed (${response.status}): ${raw.slice(0, 400) || response.statusText}`)
  }

  let payload: PinataUploadResponse
  try {
    payload = JSON.parse(raw) as PinataUploadResponse
  } catch {
    throw new Error(`Pinata returned non-JSON: ${raw.slice(0, 400)}`)
  }
  if (payload.error) {
    const message =
      typeof payload.error === 'string'
        ? payload.error
        : (payload.error.reason ?? payload.error.details ?? JSON.stringify(payload.error))
    throw new Error(`Pinata pin failed: ${message}`)
  }
  const cid = payload.data?.cid?.trim()
  if (!cid) throw new Error('Pinata response did not include a CID')
  return cid
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) return false
  }
  return true
}
