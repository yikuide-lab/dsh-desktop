/** Process-wide CollabBus + AspBridge mode for Desktop Host. */

import {
  CollabBus,
  createInProcessAspBridge,
  type AspBridge,
  type AspBridgeMode,
  type AspBridgeStatus,
} from 'dsh-plugin-workflow/collab'

let bus: CollabBus | undefined
let bridgeMode: AspBridgeMode = 'in-process'
let bridgeEndpoint: string | undefined
let lastBridgeError: string | undefined

function ensureBus(): CollabBus {
  if (!bus) bus = new CollabBus()
  return bus
}

function syncBridgeToBus(collabBus: CollabBus): void {
  if (bridgeMode === 'in-process') {
    collabBus.setAspBridge(createInProcessAspBridge(collabBus))
    return
  }
  if (bridgeMode === 'disconnected') {
    collabBus.setAspBridge(undefined)
    return
  }
  // external — reserved for V2 TCP; caller must supply a bridge instance later
  collabBus.setAspBridge(undefined)
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
  if (lastBridgeError !== undefined) status.lastError = lastBridgeError
  return status
}

export function setAspBridgeMode(
  mode: 'in-process' | 'disconnected' | 'external',
  endpoint?: string,
): AspBridgeStatus | { error: string } {
  if (mode === 'external' && !endpoint?.trim()) {
    return { error: 'ASP external bridge not configured (V2 TCP pending)' }
  }
  applyAspBridgeMode(mode, endpoint?.trim())
  return getAspBridgeStatus()
}

/** Host/test hook to inject an external AspBridge once TCP lands. */
export function setExternalAspBridge(bridge: AspBridge, endpoint: string): AspBridgeStatus {
  bridgeMode = 'external'
  bridgeEndpoint = endpoint
  lastBridgeError = undefined
  ensureBus().setAspBridge(bridge)
  return getAspBridgeStatus()
}

export function recordAspBridgeError(message: string): void {
  lastBridgeError = message
}

export function resetCollabBusForTests(): void {
  bus = undefined
  bridgeMode = 'in-process'
  bridgeEndpoint = undefined
  lastBridgeError = undefined
}
