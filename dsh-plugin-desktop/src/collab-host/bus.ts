/** Process-wide CollabBus + AspBridge mode for Desktop Host. */

import { readFileSync } from 'node:fs'
import {
  CollabBus,
  createInProcessAspBridge,
  createTcpFramedAspBridge,
  parseAspTcpEndpoint,
  type AspAuthOptions,
  type AspBridge,
  type AspBridgeMode,
  type AspBridgeStatus,
  type AspTlsOptions,
  type TcpFramedAspBridge,
} from 'dsh-plugin-workflow/collab'

let bus: CollabBus | undefined
let bridgeMode: AspBridgeMode = 'in-process'
let bridgeEndpoint: string | undefined
let lastBridgeError: string | undefined
let externalBridge: TcpFramedAspBridge | undefined

function ensureBus(): CollabBus {
  if (!bus) bus = new CollabBus()
  return bus
}

function readEnvTlsOptions(): AspTlsOptions | undefined {
  const caFile = process.env.DSH_COLLAB_ASP_TLS_CA
  const certFile = process.env.DSH_COLLAB_ASP_TLS_CERT
  const keyFile = process.env.DSH_COLLAB_ASP_TLS_KEY
  const servername = process.env.DSH_COLLAB_ASP_TLS_SERVERNAME
  const reject = process.env.DSH_COLLAB_ASP_TLS_REJECT_UNAUTHORIZED
  const options: AspTlsOptions = {}
  let used = false
  if (caFile) {
    options.ca = readFileSync(caFile)
    used = true
  }
  if (certFile && keyFile) {
    options.cert = readFileSync(certFile)
    options.key = readFileSync(keyFile)
    used = true
  }
  if (servername) {
    options.servername = servername
    used = true
  }
  if (reject === '0' || reject === 'false') {
    options.rejectUnauthorized = false
    used = true
  }
  return used ? options : undefined
}

function readEnvAuthOptions(): AspAuthOptions | undefined {
  const jid = process.env.DSH_COLLAB_ASP_JID?.trim()
  const password = process.env.DSH_COLLAB_ASP_PASSWORD
  if (!jid || password === undefined) return undefined
  return { jid, password, mechanism: 'PLAIN' }
}

function syncBridgeToBus(collabBus: CollabBus): void {
  if (bridgeMode === 'in-process') {
    void externalBridge?.close()
    externalBridge = undefined
    collabBus.setAspBridge(createInProcessAspBridge(collabBus))
    return
  }
  if (bridgeMode === 'disconnected') {
    void externalBridge?.close()
    externalBridge = undefined
    collabBus.setAspBridge(undefined)
    return
  }
  // external — ASP protobuf over TCP/TLS (u32 BE length-prefixed AgentStreamMessage)
  if (!bridgeEndpoint?.trim()) {
    collabBus.setAspBridge(undefined)
    return
  }
  if (!externalBridge || externalBridge.endpoint !== bridgeEndpoint) {
    void externalBridge?.close()
    const parsed = parseAspTcpEndpoint(bridgeEndpoint)
    const envTls = readEnvTlsOptions()
    let tlsOption: boolean | AspTlsOptions = false
    if (parsed.tls) {
      const rejectUnauthorized = !(
        process.env.DSH_COLLAB_ASP_TLS_REJECT_UNAUTHORIZED === '0'
        || process.env.DSH_COLLAB_ASP_TLS_REJECT_UNAUTHORIZED === 'false'
      )
      tlsOption = { ...(envTls ?? {}), rejectUnauthorized: envTls?.rejectUnauthorized ?? rejectUnauthorized }
    } else if (envTls) {
      tlsOption = envTls
    }

    externalBridge = createTcpFramedAspBridge(bridgeEndpoint, {
      codec: 'protobuf',
      tls: tlsOption,
      auth: readEnvAuthOptions(),
      onError: (message) => {
        lastBridgeError = message
      },
      onInbound: (envelope) => {
        collabBus.deliverLocal(envelope)
      },
    })
  }
  collabBus.setAspBridge(externalBridge)
}

function applyAspBridgeMode(mode: AspBridgeMode, endpoint?: string): void {
  bridgeMode = mode
  bridgeEndpoint = endpoint
  lastBridgeError = undefined
  syncBridgeToBus(ensureBus())
}

export function getCollabBus(): CollabBus {
  const collabBus = ensureBus()
  syncBridgeToBus(collabBus)
  return collabBus
}

export function getAspBridgeStatus(): AspBridgeStatus {
  const status: AspBridgeStatus = { mode: bridgeMode }
  if (bridgeEndpoint !== undefined) status.endpoint = bridgeEndpoint
  if (externalBridge) {
    status.tls = externalBridge.useTls
    status.codec = externalBridge.codec
    status.authenticated = externalBridge.authenticated
  }
  const tcpErr = externalBridge?.lastError
  const err = lastBridgeError ?? tcpErr
  if (err !== undefined) status.lastError = err
  return status
}

export function setAspBridgeMode(
  mode: 'in-process' | 'disconnected' | 'external',
  endpoint?: string,
): AspBridgeStatus | { error: string } {
  if (mode === 'external' && !endpoint?.trim()) {
    return { error: 'ASP external bridge requires endpoint ([tls://]host:port)' }
  }
  try {
    if (mode === 'external' && endpoint?.trim()) {
      parseAspTcpEndpoint(endpoint.trim())
    }
    applyAspBridgeMode(mode, endpoint?.trim())
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { error: message }
  }
  return getAspBridgeStatus()
}

/** Host/test hook to inject an external AspBridge once a custom transport is needed. */
export function setExternalAspBridge(bridge: AspBridge, endpoint: string): AspBridgeStatus {
  bridgeMode = 'external'
  bridgeEndpoint = endpoint
  lastBridgeError = undefined
  void externalBridge?.close()
  externalBridge = undefined
  ensureBus().setAspBridge(bridge)
  return getAspBridgeStatus()
}

export function recordAspBridgeError(message: string): void {
  lastBridgeError = message
}

export function resetCollabBusForTests(): void {
  void externalBridge?.close()
  externalBridge = undefined
  bus = undefined
  bridgeMode = 'in-process'
  bridgeEndpoint = undefined
  lastBridgeError = undefined
}
