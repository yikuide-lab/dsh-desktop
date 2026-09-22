/**
 * Host-side controller for Workflow OpenAI API settings / lifecycle.
 */

import type { WorkflowPlugin } from 'dsh-plugin-workflow'
import {
  assertSafeBindHost,
  WorkflowOpenAiServer,
} from './desktop-workflow-openai-server.ts'
import {
  generateWorkflowOpenAiApiKey,
  normalizeWorkflowOpenAiApiSettings,
  readWorkflowOpenAiApiSettings,
  toPublicWorkflowOpenAiApiSettings,
  writeWorkflowOpenAiApiSettings,
  type WorkflowOpenAiApiPublicSettings,
  type WorkflowOpenAiApiSettings,
} from './desktop-workflow-openai-settings.ts'
import {
  clearWorkflowOpenAiApiCallLog,
  readWorkflowOpenAiApiCallLog,
} from './desktop-workflow-openai-call-log.ts'

export interface WorkflowOpenAiApiController {
  getStatus(): Promise<WorkflowOpenAiApiPublicSettings>
  setSettings(partial: Record<string, unknown>): Promise<{
    settings: WorkflowOpenAiApiPublicSettings
    /** Present only when a new key was generated because none existed. */
    apiKey?: string
  }>
  rotateKey(): Promise<{
    settings: WorkflowOpenAiApiPublicSettings
    apiKey: string
  }>
  listCalls(limit?: number): Promise<import('./desktop-workflow-openai-call-log.ts').WorkflowOpenAiApiCallRecord[]>
  clearCalls(): Promise<void>
  stop(): Promise<void>
}

export function createWorkflowOpenAiApiController(input: {
  plugin: WorkflowPlugin
  stateDir: string
  log?: (message: string) => void
}): WorkflowOpenAiApiController {
  let settingsPromise = readWorkflowOpenAiApiSettings(input.stateDir)
  const server = new WorkflowOpenAiServer({
    plugin: input.plugin,
    stateDir: input.stateDir,
    settings: normalizeWorkflowOpenAiApiSettings(undefined),
    ...(input.log ? { log: input.log } : {}),
  })

  const refresh = async (next: WorkflowOpenAiApiSettings): Promise<WorkflowOpenAiApiPublicSettings> => {
    const saved = await writeWorkflowOpenAiApiSettings(input.stateDir, next)
    settingsPromise = Promise.resolve(saved)
    try {
      await server.applySettings(saved)
    } catch (error) {
      // Persist settings even when listen fails; surface error via status.
      input.log?.(
        `[workflow-openai-api] failed to apply settings: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    return toPublicWorkflowOpenAiApiSettings(saved, {
      ...server.getStatus(),
      lastError: server.getStatus().lastError,
    })
  }

  // Boot: apply persisted settings when enabled.
  void settingsPromise.then(async (settings) => {
    if (!settings.enabled) return
    try {
      await server.applySettings(settings)
    } catch (error) {
      input.log?.(
        `[workflow-openai-api] startup failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  })

  return {
    async getStatus() {
      const settings = await settingsPromise
      return toPublicWorkflowOpenAiApiSettings(settings, server.getStatus())
    },
    async setSettings(partial) {
      const current = await settingsPromise
      const merged = normalizeWorkflowOpenAiApiSettings({
        ...current,
        ...partial,
        apiKey: typeof partial.apiKey === 'string' ? partial.apiKey : current.apiKey,
      })
      assertSafeBindHost(merged.bindHost)

      let issuedKey: string | undefined
      let next = merged
      if (merged.enabled && !merged.apiKey) {
        issuedKey = generateWorkflowOpenAiApiKey()
        next = { ...merged, apiKey: issuedKey }
      }
      if (!merged.enabled) {
        // Keep existing key when disabling.
        next = { ...merged, apiKey: current.apiKey }
      }

      const settings = await refresh(next)
      return issuedKey ? { settings, apiKey: issuedKey } : { settings }
    },
    async rotateKey() {
      const current = await settingsPromise
      const apiKey = generateWorkflowOpenAiApiKey()
      const settings = await refresh({ ...current, apiKey })
      return { settings, apiKey }
    },
    async listCalls(limit) {
      return readWorkflowOpenAiApiCallLog(input.stateDir, limit)
    },
    async clearCalls() {
      await clearWorkflowOpenAiApiCallLog(input.stateDir)
    },
    async stop() {
      await server.stop()
    },
  }
}
