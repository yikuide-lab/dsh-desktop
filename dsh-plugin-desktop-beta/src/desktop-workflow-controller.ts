/** Host-side operations for the private Desktop workflow HTTP API. */

import type { Context } from '@deepseek-ai/cordis'
import type { WorkflowPlugin } from 'dsh-plugin-workflow'
import type { DesktopWorkflowRequest } from './desktop-workflow-contract.ts'
import {
  listWorkflowModelCatalog,
  registerWorkflowCustomProvider,
  type WorkflowCustomProviderInput,
} from './desktop-workflow-models.ts'
import { designWorkflowWithLlm, type WorkflowDesignMode } from './desktop-workflow-design.ts'
import type { WorkflowOpenAiApiController } from './desktop-workflow-openai-controller.ts'
import type { AwfBridge } from './desktop-awf-bridge.ts'
import type { AwfExecutorController } from './desktop-awf-executor.ts'

export interface DesktopWorkflowOpExtras {
  readonly openAiApi?: WorkflowOpenAiApiController
  readonly awf?: AwfBridge
  readonly awfBridge?: AwfBridge
  readonly awfExecutor?: AwfExecutorController
}

function parseCustomProvider(raw: Record<string, unknown> | undefined): WorkflowCustomProviderInput {
  if (raw === undefined) throw new Error('customProvider is required')
  const routeId = typeof raw.routeId === 'string' ? raw.routeId : ''
  const api = typeof raw.api === 'string' ? raw.api : ''
  const baseURL = typeof raw.baseURL === 'string' ? raw.baseURL : ''
  const modelId = typeof raw.modelId === 'string' ? raw.modelId : ''
  if (!routeId || !api || !baseURL || !modelId) {
    throw new Error('customProvider requires routeId, api, baseURL, and modelId')
  }
  return {
    routeId,
    api,
    baseURL,
    modelId,
    ...(typeof raw.displayName === 'string' ? { displayName: raw.displayName } : {}),
    ...(typeof raw.apiKey === 'string' ? { apiKey: raw.apiKey } : {}),
    ...(typeof raw.modelName === 'string' ? { modelName: raw.modelName } : {}),
    ...(typeof raw.contextWindow === 'number' ? { contextWindow: raw.contextWindow } : {}),
    ...(typeof raw.maxTokens === 'number' ? { maxTokens: raw.maxTokens } : {}),
  }
}

/** Execute one workflow API operation against the loaded plugin (and optional Host LLM/settings). */
export async function executeDesktopWorkflowOp(
  plugin: WorkflowPlugin,
  request: DesktopWorkflowRequest,
  hostCtx?: Context,
  extras?: DesktopWorkflowOpExtras,
): Promise<unknown> {
  switch (request.op) {
    case 'listWorkflows':
      return plugin.listWorkflows()
    case 'getWorkflow': {
      if (!request.name) throw new Error('name is required')
      return plugin.getWorkflow(request.name)
    }
    case 'saveWorkflow': {
      if (!request.yaml) throw new Error('yaml is required')
      return plugin.createWorkflow(request.yaml)
    }
    case 'deleteWorkflow': {
      if (!request.name) throw new Error('name is required')
      return { deleted: await plugin.deleteWorkflow(request.name) }
    }
    case 'validateWorkflow': {
      if (!request.yaml) throw new Error('yaml is required')
      return plugin.validateYaml(request.yaml)
    }
    case 'listRuns':
      return plugin.listRuns(request.workflowName)
    case 'getRun': {
      if (!request.runId) throw new Error('runId is required')
      return plugin.getRun(request.runId)
    }
    case 'getTranscript': {
      if (!request.runId) throw new Error('runId is required')
      return plugin.getTranscript(request.runId, {
        ...(typeof request.after === 'string' ? { after: request.after } : {}),
        ...(typeof request.limit === 'number' ? { limit: request.limit } : {}),
      })
    }
    case 'startRun': {
      if (!request.workflowName) throw new Error('workflowName is required')
      return plugin.startRun(request.workflowName, request.params)
    }
    case 'stopRun': {
      if (!request.runId) throw new Error('runId is required')
      return plugin.stopRun(request.runId)
    }
    case 'deleteRun': {
      if (!request.runId) throw new Error('runId is required')
      return { deleted: await plugin.deleteRun(request.runId) }
    }
    case 'exportRun': {
      if (!request.runId) throw new Error('runId is required')
      const exported = await plugin.exportRun(request.runId)
      if (exported === null) throw new Error(`Run not found: ${request.runId}`)
      return exported
    }
    case 'purgeRuns':
      return plugin.purgeRuns()
    case 'listGates':
      return plugin.listPendingGates(request.runId)
    case 'resolveGate': {
      if (!request.runId || !request.stepId || !request.decision || !request.token) {
        throw new Error('runId, stepId, decision, and token are required')
      }
      return plugin.resolveGate(
        request.runId,
        request.stepId,
        request.decision,
        request.resolvedBy ?? 'desktop-user',
        request.token,
      )
    }
    case 'listTemplates':
      return plugin.listTemplates()
    case 'saveTemplate': {
      if (!request.yaml?.trim()) throw new Error('yaml is required')
      const category = request.templateCategory === 'development'
        || request.templateCategory === 'devops'
        || request.templateCategory === 'analysis'
        || request.templateCategory === 'custom'
        ? request.templateCategory
        : undefined
      return plugin.saveUserTemplate({
        yaml: request.yaml,
        ...(request.templateName ? { name: request.templateName } : {}),
        ...(request.templateDescription ? { description: request.templateDescription } : {}),
        ...(category ? { category } : {}),
        ...(request.templateId ? { id: request.templateId } : {}),
        ...(request.workflowName ? { sourceWorkflowName: request.workflowName } : {}),
      })
    }
    case 'deleteTemplate': {
      if (!request.templateId && !request.name) throw new Error('templateId is required')
      return {
        removed: await plugin.deleteUserTemplate(request.templateId ?? request.name!),
      }
    }
    case 'promoteWorkflowToTemplate': {
      if (!request.workflowName && !request.name) {
        throw new Error('workflowName is required')
      }
      const category = request.templateCategory === 'development'
        || request.templateCategory === 'devops'
        || request.templateCategory === 'analysis'
        || request.templateCategory === 'custom'
        ? request.templateCategory
        : undefined
      return plugin.promoteWorkflowToTemplate(request.workflowName ?? request.name!, {
        ...(request.templateName ? { name: request.templateName } : {}),
        ...(request.templateDescription ? { description: request.templateDescription } : {}),
        ...(category ? { category } : {}),
        ...(request.templateId ? { id: request.templateId } : {}),
      })
    }
    case 'listBindings':
      return plugin.listBindings()
    case 'getBinding': {
      if (!request.workspaceId) throw new Error('workspaceId is required')
      return plugin.getBinding(request.workspaceId)
    }
    case 'setBinding': {
      if (!request.workspaceId || !request.workflowName) {
        throw new Error('workspaceId and workflowName are required')
      }
      return plugin.setBinding(request.workspaceId, request.workflowName)
    }
    case 'clearBinding': {
      if (!request.workspaceId) throw new Error('workspaceId is required')
      return { cleared: await plugin.clearBinding(request.workspaceId) }
    }
    case 'startBoundRun': {
      if (!request.workspaceId) throw new Error('workspaceId is required')
      return plugin.startBoundRun(request.workspaceId, request.params)
    }
    case 'getStats':
      return plugin.getStats()
    case 'getWorkflowStats':
      return plugin.getWorkflowStats(request.workflowName)
    case 'getWorkflowStatsDetail': {
      if (!request.workflowName) throw new Error('workflowName is required')
      return plugin.getWorkflowStatsDetail(request.workflowName, {
        ...(typeof request.since === 'string' ? { since: request.since } : {}),
        ...(typeof request.recentLimit === 'number' ? { recentLimit: request.recentLimit } : {}),
      })
    }
    case 'getSettings':
      return plugin.getSettings()
    case 'setSettings': {
      if (!request.settings || typeof request.settings !== 'object') {
        throw new Error('settings is required')
      }
      return plugin.setSettings(request.settings as unknown as Parameters<WorkflowPlugin['setSettings']>[0])
    }
    case 'listModelCatalog': {
      if (hostCtx === undefined) {
        return { protocols: [], providers: [] }
      }
      return listWorkflowModelCatalog(hostCtx)
    }
    case 'registerCustomProvider': {
      if (hostCtx === undefined) {
        throw new Error('host LLM/settings services are unavailable')
      }
      const parsed = parseCustomProvider(request.customProvider)
      // Drop plaintext key from the request object as soon as it is copied.
      if (request.customProvider && typeof request.customProvider === 'object') {
        delete (request.customProvider as Record<string, unknown>).apiKey
      }
      return registerWorkflowCustomProvider(hostCtx, parsed)
    }
    case 'canonicalizeYaml': {
      if (!request.yaml) throw new Error('yaml is required')
      return { yaml: await plugin.canonicalizeYaml(request.yaml) }
    }
    case 'exportWorkflowYaml': {
      if (!request.name) throw new Error('name is required')
      const yaml = await plugin.exportWorkflowYaml(request.name)
      if (yaml === null) throw new Error(`Workflow not found: ${request.name}`)
      return { yaml }
    }
    case 'designWorkflow': {
      if (hostCtx === undefined) {
        throw new Error('host LLM service is unavailable')
      }
      if (!request.prompt?.trim()) throw new Error('prompt is required')
      const mode = request.mode === 'create' || request.mode === 'modify'
        ? request.mode as WorkflowDesignMode
        : undefined
      return designWorkflowWithLlm(plugin, hostCtx, {
        prompt: request.prompt,
        ...(request.yaml ? { yaml: request.yaml } : {}),
        ...(mode ? { mode } : {}),
        includeModelCatalog: request.includeModelCatalog !== false,
        ...(typeof request.designModel === 'string' && request.designModel.trim()
          ? { designModel: request.designModel.trim() }
          : {}),
        ...(typeof request.maxTokens === 'number' ? { maxTokens: request.maxTokens } : {}),
      })
    }
    case 'listTriggers':
      return plugin.listTriggers()
    case 'addTrigger': {
      if (!request.triggerConfig || typeof request.triggerConfig !== 'object') {
        throw new Error('triggerConfig is required')
      }
      return plugin.addTrigger(
        request.triggerConfig as unknown as Parameters<WorkflowPlugin['addTrigger']>[0],
      )
    }
    case 'removeTrigger': {
      if (!request.triggerId) throw new Error('triggerId is required')
      return { removed: plugin.removeTrigger(request.triggerId) }
    }
    case 'enableTrigger': {
      if (!request.triggerId) throw new Error('triggerId is required')
      plugin.enableTrigger(request.triggerId)
      return { ok: true, enabled: true }
    }
    case 'disableTrigger': {
      if (!request.triggerId) throw new Error('triggerId is required')
      plugin.disableTrigger(request.triggerId)
      return { ok: true, enabled: false }
    }
    case 'fireManualTrigger': {
      if (!request.triggerId) throw new Error('triggerId is required')
      plugin.fireManualTrigger(request.triggerId, request.params)
      return { ok: true }
    }
    case 'fireTriggerEvent': {
      if (!request.source || !request.eventName) {
        throw new Error('source and eventName are required')
      }
      plugin.fireEvent(request.source, request.eventName, request.data)
      return { ok: true }
    }
    case 'getOpenAiApiStatus': {
      if (!extras?.openAiApi) throw new Error('OpenAI API controller unavailable')
      return extras.openAiApi.getStatus()
    }
    case 'setOpenAiApiSettings': {
      if (!extras?.openAiApi) throw new Error('OpenAI API controller unavailable')
      return extras.openAiApi.setSettings(request.openAiApiSettings ?? {})
    }
    case 'rotateOpenAiApiKey': {
      if (!extras?.openAiApi) throw new Error('OpenAI API controller unavailable')
      return extras.openAiApi.rotateKey()
    }
    case 'listOpenAiApiCalls': {
      if (!extras?.openAiApi) throw new Error('OpenAI API controller unavailable')
      const calls = await extras.openAiApi.listCalls(request.limit)
      return { calls }
    }
    case 'clearOpenAiApiCalls': {
      if (!extras?.openAiApi) throw new Error('OpenAI API controller unavailable')
      await extras.openAiApi.clearCalls()
      return { ok: true }
    }
    case 'awfGetSettings': {
      if (!extras?.awf) throw new Error('AWF connector unavailable')
      return extras.awf.getSettings()
    }
    case 'awfSetSettings': {
      if (!extras?.awf) throw new Error('AWF connector unavailable')
      return extras.awf.setSettings(request.awfSettings ?? {})
    }
    case 'awfCheckConnection': {
      if (!extras?.awf) throw new Error('AWF connector unavailable')
      return extras.awf.checkConnection()
    }
    case 'awfSync': {
      if (!extras?.awf) throw new Error('AWF connector unavailable')
      if (!request.name) throw new Error('name is required')
      return extras.awf.syncWorkflow({
        name: request.name,
        ...(request.yaml ? { yaml: request.yaml } : {}),
        ...(typeof request.awfVisibility === 'string' ? { visibility: request.awfVisibility } : {}),
        ...(request.awfPublish === true ? { publish: true } : {}),
      })
    }
    case 'awfRemoteRun': {
      if (!extras?.awf) throw new Error('AWF connector unavailable')
      if (!request.awfWorkflowId) throw new Error('awfWorkflowId is required')
      return extras.awf.remoteRun({
        workflowId: request.awfWorkflowId,
        ...(request.params ? { params: request.params as Record<string, string> } : {}),
      })
    }
    case 'awfSetTelemetrySettings': {
      if (!extras?.awf) throw new Error('AWF connector unavailable')
      const telemetry = request.awfTelemetrySettings?.telemetryEnabled
      return extras.awf.setSettings({
        ...(typeof telemetry === 'boolean' ? { telemetryEnabled: telemetry } : {}),
      })
    }
    case 'awfAuthStatus': {
      if (!extras?.awf) throw new Error('AWF connector unavailable')
      return extras.awf.authStatus()
    }
    case 'awfAuthMethods': {
      if (!extras?.awf) throw new Error('AWF connector unavailable')
      return extras.awf.authMethods()
    }
    case 'awfAuthRegister': {
      if (!extras?.awf) throw new Error('AWF connector unavailable')
      const creds = request.awfAuthCredentials ?? {}
      if (!creds.email || !creds.password) throw new Error('email and password are required')
      return extras.awf.authRegister({
        email: creds.email,
        password: creds.password,
        ...(creds.displayName ? { displayName: creds.displayName } : {}),
      })
    }
    case 'awfAuthLogin': {
      if (!extras?.awf) throw new Error('AWF connector unavailable')
      const creds = request.awfAuthCredentials ?? {}
      if (!creds.email || !creds.password) throw new Error('email and password are required')
      return extras.awf.authLogin({ email: creds.email, password: creds.password })
    }
    case 'awfAuthSendPhoneCode': {
      if (!extras?.awf) throw new Error('AWF connector unavailable')
      const phone = request.awfAuthCredentials?.phone
      if (!phone) throw new Error('phone is required')
      return extras.awf.authSendPhoneCode(phone)
    }
    case 'awfAuthPhoneLogin': {
      if (!extras?.awf) throw new Error('AWF connector unavailable')
      const creds = request.awfAuthCredentials ?? {}
      if (!creds.phone || !creds.code) throw new Error('phone and code are required')
      return extras.awf.authPhoneLogin({ phone: creds.phone, code: creds.code })
    }
    case 'awfAuthLogout': {
      if (!extras?.awf) throw new Error('AWF connector unavailable')
      return extras.awf.authLogout()
    }
    case 'awfGetExecutorStatus': {
      if (!extras?.awfExecutor) {
        return { running: false, registered: false, executorId: null, executingTaskId: null, lastClaimAt: null, lastError: null }
      }
      return extras.awfExecutor.status()
    }
    case 'awfSetExecutorSettings': {
      if (!extras?.awf || !extras?.awfExecutor) throw new Error('AWF connector unavailable')
      const enabled = request.awfExecutorSettings?.executorEnabled
      const status = await extras.awf.setSettings({
        ...(typeof enabled === 'boolean' ? { executorEnabled: enabled } : {}),
      })
      if (enabled === true) extras.awfExecutor.start()
      if (enabled === false) await extras.awfExecutor.stop()
      return status
    }
    case 'awfGetTunnelStatus': {
      if (!extras?.awfBridge) throw new Error('AWF bridge unavailable')
      return extras.awfBridge.getTunnelStatus()
    }
    case 'awfSetTunnelSettings': {
      if (!extras?.awfBridge) throw new Error('AWF bridge unavailable')
      const { tunnelEnabled, localPort } = request.awfTunnelSettings ?? {}
      return extras.awfBridge.setTunnelSettings(
        typeof tunnelEnabled === 'boolean' ? tunnelEnabled : false,
        typeof localPort === 'number' ? localPort : 8787,
      )
    }
    case 'rsiListProblems': {
      return plugin.rsiListProblems()
    }
    case 'rsiCreateProblem': {
      const cfg = request.rsiConfig
      if (!cfg?.title) throw new Error('rsiConfig.title is required')
      return plugin.rsiCreateProblem({
        title: cfg.title,
        ...(cfg.domain !== undefined ? { domain: cfg.domain } : {}),
        ...(cfg.maxIterations !== undefined ? { maxIterations: cfg.maxIterations } : {}),
        ...(cfg.reviewProviderId !== undefined ? { reviewProviderId: cfg.reviewProviderId } : {}),
        ...(cfg.improvementCriteria !== undefined ? { improvementCriteria: cfg.improvementCriteria } : {}),
        ...(cfg.baseYaml !== undefined ? { baseYaml: cfg.baseYaml } : {}),
      })
    }
    case 'rsiRunIteration': {
      if (!request.rsiProblemId) throw new Error('rsiProblemId is required')
      return plugin.rsiRunIteration(request.rsiProblemId)
    }
    case 'rsiGetIterations': {
      if (!request.rsiProblemId) throw new Error('rsiProblemId is required')
      return plugin.rsiGetIterations(request.rsiProblemId)
    }
    case 'rsiDeleteProblem': {
      if (!request.rsiProblemId) throw new Error('rsiProblemId is required')
      return plugin.rsiDeleteProblem(request.rsiProblemId)
    }
    default: {
      const _exhaustive: never = request.op
      throw new Error(`Unsupported op: ${String(_exhaustive)}`)
    }
  }
}
