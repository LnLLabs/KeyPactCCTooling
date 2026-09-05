export const BLOCKFROST_URL =
  import.meta.env.VITE_BLOCKFROST_URL?.trim() ||
  (import.meta.env.DEV ? '/blockfrost' : 'https://cardano-mainnet.blockfrost.io/api/v0')

export const BLOCKFROST_PROJECT_ID = import.meta.env.VITE_BLOCKFROST_PROJECT_ID?.trim() || ''

export const RATIONALE_PATH = '/rationale/lgtm.jsonld'

export const CONSTITUTION_FALLBACK_PATH = '/constitution/cardano-constitution.md'

export const DEFAULT_CONSTITUTION_URL =
  'https://raw.githubusercontent.com/IntersectMBO/cardano-constitution/main/cardano-constitution-2/cardano-constitution-2.txt.md'

export const DEEPSEEK_PROXY_URL = '/deepseek'

export function requireBlockfrostProjectId(): string {
  if (!BLOCKFROST_PROJECT_ID) {
    throw new Error(
      'Missing VITE_BLOCKFROST_PROJECT_ID. Copy .env.example to .env and set your Blockfrost project id.',
    )
  }
  return BLOCKFROST_PROJECT_ID
}

export function blockfrostConfig() {
  return {
    baseUrl: BLOCKFROST_URL,
    projectId: requireBlockfrostProjectId(),
  }
}

export function blockfrostHeaders(extra?: HeadersInit): HeadersInit {
  return {
    accept: 'application/json',
    project_id: requireBlockfrostProjectId(),
    ...extra,
  }
}

export async function blockfrostFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${BLOCKFROST_URL}${path.startsWith('/') ? path : `/${path}`}`
  const response = await fetch(url, {
    ...init,
    headers: blockfrostHeaders(init?.headers),
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Blockfrost ${path} failed: ${response.status}${body ? ` ${body}` : ''}`)
  }
  return (await response.json()) as T
}

export function rationaleUrl(): string {
  const configured = import.meta.env.VITE_RATIONALE_URL?.trim()
  if (configured) return configured
  return `${window.location.origin}${RATIONALE_PATH}`
}

/** Anchors are fetched by chain indexers; localhost / private hosts are not usable on mainnet. */
export function assertPublicRationaleUrl(url = rationaleUrl()): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`Invalid rationale URL: ${url}`)
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Rationale URL must be http(s): ${url}`)
  }
  const host = parsed.hostname.toLowerCase()
  const local =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.startsWith('192.168.') ||
    host.startsWith('10.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  if (local) {
    throw new Error(
      `Rationale URL cannot be a local address (${url}). ` +
        `Set VITE_RATIONALE_URL to a public HTTPS URL of /rationale/lgtm.jsonld (anchors are resolved off-device).`,
    )
  }
  return url
}

export function constitutionUrl(): string {
  return import.meta.env.VITE_CONSTITUTION_URL?.trim() || DEFAULT_CONSTITUTION_URL
}

export function deepseekChatUrl(): string {
  return `${DEEPSEEK_PROXY_URL}/chat/completions`
}

export function formatError(error: unknown): string {
  const parts: string[] = []
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current != null && !seen.has(current)) {
    seen.add(current)
    if (current instanceof Error) {
      if (current.message) parts.push(current.message)
      current = current.cause
      continue
    }
    if (typeof current === 'object') {
      const obj = current as {
        message?: unknown
        cause?: unknown
        failures?: unknown
      }
      if (Array.isArray(obj.failures) && obj.failures.length > 0) {
        parts.push(safeJson(obj.failures))
      } else if (obj.message != null) {
        parts.push(typeof obj.message === 'string' ? obj.message : safeJson(obj.message))
      } else {
        parts.push(safeJson(obj))
      }
      current = obj.cause
      continue
    }
    parts.push(String(current))
    break
  }
  return parts.join('\n') || String(error)
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item), 2)
  } catch {
    return String(value)
  }
}
