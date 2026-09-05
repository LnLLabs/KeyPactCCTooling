import type { ReactNode } from 'react'

/** Very small markdown subset for constitution text — headings, lists, emphasis, paragraphs. */
export function renderMarkdownLite(source: string): ReactNode[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const nodes: ReactNode[] = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]!
    const trimmed = line.trim()

    if (!trimmed) {
      i++
      continue
    }

    if (trimmed.startsWith('```')) {
      const fence = trimmed.slice(3).trim()
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i]!.trim().startsWith('```')) {
        body.push(lines[i]!)
        i++
      }
      if (i < lines.length) i++
      nodes.push(
        <pre key={key++} className="md-pre">
          <code data-lang={fence || undefined}>{body.join('\n')}</code>
        </pre>,
      )
      continue
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.*)$/)
    if (heading) {
      const level = heading[1]!.length
      const Tag = (`h${Math.min(level + 1, 4)}` as 'h2' | 'h3' | 'h4')
      nodes.push(
        <Tag key={key++} className="md-heading">
          {inlineMarkdown(heading[2]!)}
        </Tag>,
      )
      i++
      continue
    }

    if (/^[-*•]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      const items: ReactNode[] = []
      const ordered = /^\d+\.\s+/.test(trimmed)
      while (i < lines.length) {
        const item = lines[i]!.trim()
        if (!item) break
        const bullet = item.match(/^[-*•]\s+(.*)$/)
        const numbered = item.match(/^\d+\.\s+(.*)$/)
        if (ordered ? !numbered : !bullet) break
        items.push(<li key={items.length}>{inlineMarkdown((numbered ?? bullet)![1]!)}</li>)
        i++
      }
      nodes.push(
        ordered ? (
          <ol key={key++} className="md-list">
            {items}
          </ol>
        ) : (
          <ul key={key++} className="md-list">
            {items}
          </ul>
        ),
      )
      continue
    }

    if (/^[-_*]{3,}$/.test(trimmed)) {
      nodes.push(<hr key={key++} className="md-hr" />)
      i++
      continue
    }

    const para: string[] = [trimmed]
    i++
    while (i < lines.length) {
      const next = lines[i]!.trim()
      if (
        !next ||
        next.startsWith('#') ||
        next.startsWith('```') ||
        /^[-*•]\s+/.test(next) ||
        /^\d+\.\s+/.test(next) ||
        /^[-_*]{3,}$/.test(next)
      ) {
        break
      }
      para.push(next)
      i++
    }
    nodes.push(
      <p key={key++} className="md-p">
        {inlineMarkdown(para.join(' '))}
      </p>,
    )
  }

  return nodes
}

function inlineMarkdown(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g
  let last = 0
  let match: RegExpExecArray | null
  let k = 0
  while ((match = re.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    const token = match[0]!
    if (token.startsWith('**')) {
      parts.push(<strong key={k++}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('*')) {
      parts.push(<em key={k++}>{token.slice(1, -1)}</em>)
    } else if (token.startsWith('`')) {
      parts.push(
        <code key={k++} className="md-inline-code">
          {token.slice(1, -1)}
        </code>,
      )
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      if (link) {
        parts.push(
          <a key={k++} href={link[2]} target="_blank" rel="noreferrer">
            {link[1]}
          </a>,
        )
      } else {
        parts.push(token)
      }
    }
    last = match.index + token.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

const BODY_KEYS = ['title', 'abstract', 'motivation', 'rationale', 'summary', 'description']
const SKIP_KEYS = new Set([
  '@context',
  'hashAlgorithm',
  'witness',
  'publicKey',
  'signature',
  'witnessAlgorithm',
  'bytes',
])

export type ProposalSection = { heading: string; body: string }

/** Turn CIP-108 / governance JSON into readable sections. */
export function proposalSections(description: unknown): ProposalSection[] {
  if (description == null) return []
  if (typeof description === 'string') {
    return description.trim() ? [{ heading: 'Description', body: description.trim() }] : []
  }
  if (typeof description !== 'object') {
    return [{ heading: 'Value', body: String(description) }]
  }

  if (Array.isArray(description)) {
    return [{ heading: 'Contents', body: JSON.stringify(description, null, 2) }]
  }

  const root = description as Record<string, unknown>
  const sections: ProposalSection[] = []

  const body = root.body
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const bodyObj = body as Record<string, unknown>
    for (const key of BODY_KEYS) {
      pushValue(sections, titleCase(key), bodyObj[key])
    }
    if ('references' in bodyObj) {
      pushReferences(sections, bodyObj.references)
    }
    for (const [key, value] of Object.entries(bodyObj)) {
      if (BODY_KEYS.includes(key) || key === 'references' || SKIP_KEYS.has(key)) continue
      pushValue(sections, titleCase(key), value)
    }
  } else {
    for (const key of BODY_KEYS) {
      pushValue(sections, titleCase(key), root[key])
    }
  }

  if (Array.isArray(root.authors)) {
    const names = root.authors
      .map((author) => {
        if (author && typeof author === 'object' && 'name' in author) {
          const name = (author as { name?: unknown }).name
          return typeof name === 'string' ? name : null
        }
        return null
      })
      .filter((name): name is string => Boolean(name))
    if (names.length) sections.push({ heading: 'Authors', body: names.join(', ') })
  }

  if ('references' in root && !(body && typeof body === 'object')) {
    pushReferences(sections, root.references)
  }

  if (typeof root.tag === 'string') {
    sections.push({ heading: 'Tag', body: root.tag })
  }

  // Remaining top-level keys (e.g. on-chain treasury contents) after CIP fields.
  for (const [key, value] of Object.entries(root)) {
    if (
      key === 'body' ||
      key === 'authors' ||
      key === 'references' ||
      key === 'tag' ||
      BODY_KEYS.includes(key) ||
      SKIP_KEYS.has(key)
    ) {
      continue
    }
    pushValue(sections, titleCase(key), value)
  }

  if (sections.length === 0) {
    return [{ heading: 'Raw', body: JSON.stringify(description, null, 2) }]
  }
  return sections
}

function pushReferences(sections: ProposalSection[], value: unknown) {
  if (!Array.isArray(value) || value.length === 0) return
  const lines = value.map((item) => {
    if (!item || typeof item !== 'object') return String(item)
    const row = item as Record<string, unknown>
    const label = typeof row.label === 'string' ? row.label : 'Reference'
    const uri = typeof row.uri === 'string' ? row.uri : typeof row.href === 'string' ? row.href : ''
    return uri ? `${label}: ${uri}` : label
  })
  sections.push({ heading: 'References', body: lines.join('\n') })
}

function pushValue(sections: ProposalSection[], heading: string, value: unknown) {
  if (value == null) return
  if (typeof value === 'string') {
    const text = value.trim()
    if (text) sections.push({ heading, body: text })
    return
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    sections.push({ heading, body: String(value) })
    return
  }
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === 'string' || typeof item === 'number')) {
      sections.push({ heading, body: value.map(String).join('\n') })
      return
    }
    sections.push({ heading, body: JSON.stringify(value, null, 2) })
    return
  }
  if (typeof value === 'object') {
    sections.push({ heading, body: JSON.stringify(value, null, 2) })
  }
}

function titleCase(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}
