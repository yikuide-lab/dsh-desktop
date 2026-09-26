/** ASP-shaped JID parse/format for desktop.local peers */

import type { PeerKind } from './types.js'

export const DESKTOP_LOCAL_DOMAIN = 'desktop.local'

export interface ParsedJid {
  node: string
  domain: string
  resource?: string
  bare: string
  full: string
}

const JID_RE = /^([^@/]+)@([^/]+)(?:\/(.+))?$/

export function parseJid(jid: string): ParsedJid {
  const trimmed = jid.trim()
  const match = JID_RE.exec(trimmed)
  if (!match) {
    throw new Error(`Invalid JID: ${jid}`)
  }
  const node = match[1]
  const domain = match[2]
  const resource = match[3]
  const bare = `${node}@${domain}`
  const full = resource ? `${bare}/${resource}` : bare
  return { node, domain, resource, bare, full }
}

export function formatJid(
  node: string,
  domain: string = DESKTOP_LOCAL_DOMAIN,
  resource?: string,
): string {
  const bare = `${node}@${domain}`
  return resource ? `${bare}/${resource}` : bare
}

export function isLocalDesktopJid(jid: string): boolean {
  try {
    return parseJid(jid).domain === DESKTOP_LOCAL_DOMAIN
  } catch {
    return false
  }
}

export function peerKindFromJid(jid: string): PeerKind | 'admin' | 'awf' {
  const { node } = parseJid(jid)
  switch (node) {
    case 'session':
      return 'session'
    case 'agent':
      return 'agent'
    case 'workflow':
      return 'workflow'
    case 'awf':
      return 'awf'
    case 'admin':
      return 'admin'
    default:
      throw new Error(`Unknown JID node kind: ${node}`)
  }
}

export function rosterPeerKindFromJid(jid: string): PeerKind {
  const kind = peerKindFromJid(jid)
  if (kind === 'admin' || kind === 'awf') {
    throw new Error(`JID ${jid} is not a roster peer kind`)
  }
  return kind
}
