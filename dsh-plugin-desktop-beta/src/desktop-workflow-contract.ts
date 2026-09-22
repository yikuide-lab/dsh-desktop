/** Private same-origin Desktop workflow API shared with the bundled renderer. */

/** Bump when request/response shapes change in a breaking way. */
export const DESKTOP_WORKFLOW_API_VERSION = 1

/** Single JSON-RPC-style endpoint for workflow CRUD, runs, gates, and bindings. */
export const DESKTOP_WORKFLOW_PATH = '/api/desktop/workflow'

export type DesktopWorkflowOp =
  | 'listWorkflows'
  | 'getWorkflow'
  | 'saveWorkflow'
  | 'deleteWorkflow'
  | 'validateWorkflow'
  | 'listRuns'
  | 'getRun'
  | 'getTranscript'
  | 'startRun'
  | 'stopRun'
  | 'deleteRun'
  | 'exportRun'
  | 'purgeRuns'
  | 'listGates'
  | 'resolveGate'
  | 'listTemplates'
  | 'saveTemplate'
  | 'deleteTemplate'
  | 'promoteWorkflowToTemplate'
  | 'listBindings'
  | 'getBinding'
  | 'setBinding'
  | 'clearBinding'
  | 'startBoundRun'
  | 'getStats'
  | 'getWorkflowStats'
  | 'getWorkflowStatsDetail'
  | 'getSettings'
  | 'setSettings'
  | 'listModelCatalog'
  | 'registerCustomProvider'
  | 'canonicalizeYaml'
  | 'exportWorkflowYaml'
  | 'designWorkflow'
  | 'listTriggers'
  | 'addTrigger'
  | 'removeTrigger'
  | 'enableTrigger'
  | 'disableTrigger'
  | 'fireManualTrigger'
  | 'fireTriggerEvent'
  | 'getOpenAiApiStatus'
  | 'setOpenAiApiSettings'
  | 'rotateOpenAiApiKey'
  | 'listOpenAiApiCalls'
  | 'clearOpenAiApiCalls'
  | 'awfGetSettings'
  | 'awfSetSettings'
  | 'awfCheckConnection'
  | 'awfSync'
  | 'awfRemoteRun'
  | 'awfSetTelemetrySettings'
  | 'awfGetExecutorStatus'
  | 'awfSetExecutorSettings'
  | 'awfGetTunnelStatus'
  | 'awfSetTunnelSettings'
  | 'awfAuthStatus'
  | 'awfAuthMethods'
  | 'awfAuthRegister'
  | 'awfAuthLogin'
  | 'awfAuthSendPhoneCode'
  | 'awfAuthPhoneLogin'
  | 'awfAuthLogout'

export interface DesktopWorkflowRequest {
  readonly op: DesktopWorkflowOp
  readonly name?: string
  readonly yaml?: string
  readonly workflowName?: string
  readonly runId?: string
  readonly stepId?: string
  readonly decision?: string
  readonly resolvedBy?: string
  readonly token?: string
  readonly workspaceId?: string
  readonly params?: Record<string, unknown>
  readonly settings?: Record<string, unknown>
  readonly customProvider?: Record<string, unknown>
  /** Natural-language design instructions for designWorkflow. */
  readonly prompt?: string
  /** create | modify for designWorkflow (inferred when omitted). */
  readonly mode?: string
  /** When true/omitted, inject live DSH model catalog into designWorkflow prompt. */
  readonly includeModelCatalog?: boolean
  /** Explicit provider/model route for the design LLM (designWorkflow). */
  readonly designModel?: string
  /** Completion token budget for designWorkflow. */
  readonly maxTokens?: number
  /** Trigger definition for addTrigger. */
  readonly triggerConfig?: Record<string, unknown>
  readonly triggerId?: string
  /** Event source / name for fireTriggerEvent. */
  readonly source?: string
  readonly eventName?: string
  readonly data?: Record<string, unknown>
  /** Transcript pagination cursor (event ts). */
  readonly after?: string
  readonly limit?: number
  /** ISO timestamp lower bound for stats day buckets. */
  readonly since?: string
  /** Cap for recentRuns in getWorkflowStatsDetail. */
  readonly recentLimit?: number
  /** Partial OpenAI API server settings for setOpenAiApiSettings. */
  readonly openAiApiSettings?: Record<string, unknown>
  /** saveTemplate / promoteWorkflowToTemplate display name. */
  readonly templateName?: string
  readonly templateDescription?: string
  readonly templateCategory?: string
  readonly templateId?: string
  /** AWF connector settings for awfSetSettings (token saved only via this path; env var wins). */
  readonly awfSettings?: { baseUrl?: string; apiTokenEnv?: string; apiToken?: string }
  /** awfSetTelemetrySettings: opt-in run-summary reporting (default off). */
  readonly awfTelemetrySettings?: { telemetryEnabled?: boolean }
  /** awfSetExecutorSettings: opt-in desktop executor loop (default off). */
  readonly awfExecutorSettings?: { executorEnabled?: boolean }
  /** awfSetTunnelSettings: opt-in reverse tunnel (default off). */
  readonly awfTunnelSettings?: { tunnelEnabled?: boolean; localPort?: number }
  /** awfAuth* 账号凭据；密码只在请求体内存在，绝不落盘。 */
  readonly awfAuthCredentials?: {
    email?: string
    password?: string
    displayName?: string
    phone?: string
    code?: string
  }
  /** Workflow visibility for awfSync (private | unlisted | public). */
  readonly awfVisibility?: string
  /** awfSync: publish-freeze the workflow on the platform after pushing (service enablement). */
  readonly awfPublish?: boolean
  /** awfRemoteRun target workflow id. */
  readonly awfWorkflowId?: number
}

export interface DesktopWorkflowErrorResponse {
  readonly error: string
}
