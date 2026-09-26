/** Process-wide CollabBus + AspBridge mode for Desktop Host. */

import {
  CollabBus,
  createInProcessAspBridge,
  createTcpFramedAspBridge,
  type AspBridge,
  type AspBridgeMode,
  type AspBridgeStatus,
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
  // external — length-prefixed JSON TCP (Protobuf ASP wire still pending)
  if (!bridgeEndpoint?.trim()) {
    collabBus.setAspBridge(undefined)
    return
  }
  if (!externalBridge || externalBridge.endpoint !== bridgeEndpoint) {
    void externalBridge?.close()
    externalBridge = createTcpFramedAspBridge(bridgeEndpoint, (message) => {
      lastBridgeError = message
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
    return { error: 'ASP external bridge requires endpoint (host:port)' }
  }
  try {
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
