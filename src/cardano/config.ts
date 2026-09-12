import {
  getBlockfrostProjectId,
  getBlockfrostUrl,
  getConstitutionUrl,
  getDeepseekApiKey,
  getRationaleUrl,
  DEFAULT_CONSTITUTION_URL,
} from './settings'

export { DEFAULT_CONSTITUTION_URL }

export const RATIONALE_PATH = '/rationale/lgtm.jsonld'

export const CONSTITUTION_FALLBACK_PATH = '/constitution/cardano-constitution.md'

export function requireBlockfrostProjectId(): string {
  const id = getBlockfrostProjectId()
  if (!id) {
    throw new Error(
      'Missing Blockfrost project id. Open Settings and save your project id (stored only in this browser).',
    )
  }
  return id
}

export function blockfrostConfig() {
  return {
    baseUrl: getBlockfrostUrl(),
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
  const base = getBlockfrostUrl()
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`
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
  return getRationaleUrl()
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
        `Set a public HTTPS URL in Settings (anchors are resolved off-device).`,
    )
  }
  return url
}

export function constitutionUrl(): string {
  return getConstitutionUrl()
}

export function deepseekChatUrl(): string {
  if (import.meta.env.DEV) return '/deepseek/chat/completions'
  return 'https://api.deepseek.com/chat/completions'
}

export function requireDeepseekApiKey(): string {
  const key = getDeepseekApiKey()
  if (!key) {
    throw new Error(
      'Missing DeepSeek API key. Open Settings and save your key (stored only in this browser).',
    )
  }
  return key
}

export function deepseekHeaders(extra?: HeadersInit): HeadersInit {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${requireDeepseekApiKey()}`,
    ...extra,
  }
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
