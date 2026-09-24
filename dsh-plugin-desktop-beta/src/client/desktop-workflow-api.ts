/** Same-origin browser client for Desktop workflow Host operations. */

const WORKFLOW_PATH = '/api/desktop/workflow'

export type WorkflowStepType = 'script' | 'task' | 'llm' | 'approval' | 'sub_workflow'
export type WorkflowOnFailure = 'fail' | 'skip' | 'compensate'

/** 本地引擎可执行的步骤类型；之外的类型仅 AWF 平台可运行（能力协商，见 /api/dsl/capabilities）。 */
export const LOCAL_STEP_TYPES: ReadonlySet<string> = new Set<string>([
  'script',
  'task',
  'llm',
  'approval',
  'sub_workflow',
])

/** 返回该工作流中超出本地引擎能力的步骤类型（去重、保序）；空数组表示可本地运行。 */
export function platformOnlySteps(
  workflow: { steps?: Array<{ type: string }> } | undefined,
): string[] {
  const seen = new Set<string>()
  for (const step of workflow?.steps ?? []) {
    if (!LOCAL_STEP_TYPES.has(step.type)) seen.add(step.type)
  }
  return [...seen]
}


export interface WorkflowCompensationView {
  run: string
  env?: Record<string, string>
}

export interface WorkflowStepView {
  id: string
  type: WorkflowStepType
  run?: string
  prompt?: string
  deps?: string[]
  timeout?: number
  /** Optional LLM completion token budget. */
  maxTokens?: number
  env?: Record<string, string>
  inputs?: Record<string, unknown>
  outputs?: string[]
  acceptance?: string[]
  harness?: string
  question?: string
  options?: string[]
  /** Approval decisions that complete the gate successfully. */
  pass?: string[]
  ref?: string
  model?: string
  role?: string
  /** Extra attempts after the first failure. */
  retries?: number
  onFailure?: WorkflowOnFailure
  compensation?: WorkflowCompensationView
  /** Optional canvas position for the visual designer. */
  ui?: { x: number; y: number }
}

export interface WorkflowView {
  /** Stable document id (UUID). Storage key; view-only in the editor. */
  uid?: string
  name: string
  title: string
  description?: string
  steps: WorkflowStepView[]
  apiVersion?: string
  kind?: string
}

export interface RunDispatchView {
  id: string
  status: string
  attempt?: number
  /** Normal step work vs post-failure compensation script. */
  phase?: 'execute' | 'compensate'
  startedAt?: string
  completedAt?: string
  error?: string
  cost?: number
}

export interface RunStepView {
  id: string
  status: string
  startedAt?: string
  completedAt?: string
  /** Wall-clock duration once the step is terminal. */
  durationMs?: number
  /** Highest attempt number seen across execute dispatches. */
  attempt?: number
  /** Per-attempt dispatch history (engine `tasks[].dispatches[]`). */
  dispatches?: RunDispatchView[]
  output?: string
  error?: string
}

export interface PendingGateView {
  runId: string
  stepId: string
  question: string
  options: string[]
  /** Decisions that complete the gate; defaults applied on the Host. */
  pass?: string[]
  token: string
}

export interface WorkflowRunView {
  id: string
  workflowName: string
  status: string
  startedAt?: string
  completedAt?: string
  params?: Record<string, unknown>
  steps?: RunStepView[]
  gates?: PendingGateView[]
  error?: string
}

export interface WorkflowTranscriptEventView {
  ts: string
  type: string
  stepId?: string
  dispatchId?: string
  data?: Record<string, unknown>
}

export interface WorkflowTemplateView {
  id: string
  name: string
  description: string
  category: string
  yaml: string
  /** Built-in catalog entries are true; user-saved templates are false/omitted. */
  builtin?: boolean
}

export interface WorkspaceBindingView {
  workspaceId: string
  workflowName: string
  updatedAt: string
}

export interface WorkflowLlmProviderPrefView {
  id: string
  model: string
  bias: string[]
}

export interface WorkflowSettingsView {
  providers: WorkflowLlmProviderPrefView[]
  defaultBias: string
  defaultRetries: number
  defaultOnFailure: WorkflowOnFailure
  /** Keep at most this many finished runs (0 = unlimited). */
  maxRetainedRuns?: number
  /** Delete finished runs older than this many days (0 = unlimited). */
  maxRunAgeDays?: number
  scriptPolicy?: 'allow' | 'deny' | 'workspace-only'
}

export type WorkflowTriggerType = 'cron' | 'event' | 'manual'

export interface WorkflowTriggerConfigView {
  type: WorkflowTriggerType
  workflowName: string
  schedule?: string
  source?: string
  on?: string
  filter?: string
  params?: Record<string, unknown>
}

export interface WorkflowTriggerView {
  id: string
  config: WorkflowTriggerConfigView
  enabled: boolean
  nextTrigger?: string
}

export interface WorkflowTranscriptPageView {
  events: WorkflowTranscriptEventView[]
  nextAfter?: string
}

export interface WorkflowRunExportView {
  schemaVersion: number
  run: WorkflowRunView
  transcript: WorkflowTranscriptEventView[]
}

export interface WorkflowStatsSummaryView {
  workflowName: string
  title?: string
  totalRuns: number
  completed: number
  failed: number
  aborted: number
  running: number
  successRate: number
  avgDurationMs: number | null
  lastRunAt: string | null
  lastStatus: string | null
}

export interface WorkflowStatsDayBucketView {
  date: string
  total: number
  completed: number
  failed: number
  avgDurationMs: number | null
}

export interface WorkflowStatsRecentRunView {
  id: string
  status: string
  startedAt: string
  completedAt?: string
  durationMs?: number
  error?: string
}

export interface WorkflowStatsDetailView extends WorkflowStatsSummaryView {
  byDay: WorkflowStatsDayBucketView[]
  recentRuns: WorkflowStatsRecentRunView[]
}

export interface WorkflowOpenAiApiStatusView {
  enabled: boolean
  bindHost: string
  port: number
  hasApiKey: boolean
  maxBodyBytes: number
  maxConcurrent: number
  listening: boolean
  baseUrl: string | null
  usingTls: boolean
  lastError: string | null
}

export interface WorkflowOpenAiApiCallView {
  id: string
  ts: string
  method: string
  path: string
  clientIp: string
  model?: string
  workflowName?: string
  runId?: string
  statusCode: number
  ok: boolean
  error?: string
  durationMs?: number
  stream?: boolean
}

export interface WorkflowOpenAiApiSettingsInput {
  enabled?: boolean
  bindHost?: string
  port?: number
  maxBodyBytes?: number
  maxConcurrent?: number
}

export interface AwfStatusView {
  baseUrl: string
  apiTokenEnv: string
  hasToken: boolean
  tokenFingerprint: string
  telemetryEnabled: boolean
  executorEnabled: boolean
  tunnelEnabled: boolean
  tunnelLocalPort: number
}

export interface AwfAuthAccountView {
  hasSession: boolean
  email?: string
  displayName?: string
  tokenFingerprint?: string
  accessTokenExpiresAt?: string
  errorKind?: string
  errorMessage?: string
}

export interface AwfAuthMethodsView {
  email: boolean
  phone: boolean
  wechat: boolean
  wechatReason?: string
}

export interface AwfExecutorStatusView {
  running: boolean
  registered: boolean
  executorId: number | null
  executingTaskId: number | null
  lastClaimAt: string | null
  lastError: string | null
}

export interface AwfTunnelStatusView {
  connected: boolean
  localPort: number
  executorId: number | null
  since: string | null
  error: string | null
}

export interface AwfConnectionView {
  ok: boolean
  email?: string
  errorKind?: string
  errorMessage?: string
}

export interface AwfSyncReceiptView {
  ok: boolean
  stage: 'preflight' | 'pushed' | 'error'
  validation?: { name: string; ok: boolean; errors: Array<{ path: string; code: string; msg: string }>; conflict: string | null }
  workflow?: { id: number; name: string; title: string; status: string; visibility: string }
  errorKind?: string
  errorMessage?: string
}

export interface WorkflowModelEntryView {
  id: string
  name: string
}

export interface WorkflowProviderGroupView {
  id: string
  name: string
  models: WorkflowModelEntryView[]
}

export interface WorkflowModelCatalogView {
  protocols: string[]
  providers: WorkflowProviderGroupView[]
  defaultRoute?: string
  defaultModel?: string
}

export interface WorkflowCustomProviderInput {
  routeId: string
  displayName?: string
  api: string
  baseURL: string
  apiKey?: string
  modelId: string
  modelName?: string
  contextWindow?: number
  maxTokens?: number
}

export interface ValidationView {
  ok: boolean
  errors: Array<{ path: string; message: string; severity: string }>
}

export interface DesktopWorkflowApi {
  listWorkflows(): Promise<WorkflowView[]>
  getWorkflow(name: string): Promise<WorkflowView | null>
  saveWorkflow(yaml: string): Promise<{ workflow: WorkflowView; validation: ValidationView }>
  deleteWorkflow(name: string): Promise<boolean>
  validateWorkflow(yaml: string): Promise<ValidationView>
  /** Host js-yaml canonicalize (parse → serialize). Falls back to client yaml on failure. */
  canonicalizeYaml(yaml: string): Promise<string>
  exportWorkflowYaml(name: string): Promise<string>
  designWorkflow(input: {
    prompt: string
    yaml?: string
    mode?: 'create' | 'modify'
    /** Inject live DSH model catalog into the design prompt (default true). */
    includeModelCatalog?: boolean
    /** Explicit `provider/model` that generates the design YAML. */
    designModel?: string
    /** Completion token budget (default 16384). */
    maxTokens?: number
  }): Promise<{
    yaml: string
    mode: 'create' | 'modify'
    validation: ValidationView
  }>
  listRuns(workflowName?: string): Promise<WorkflowRunView[]>
  getRun(runId: string): Promise<WorkflowRunView | null>
  getTranscript(
    runId: string,
    options?: { after?: string; limit?: number },
  ): Promise<WorkflowTranscriptPageView>
  startRun(workflowName: string, params?: Record<string, unknown>): Promise<WorkflowRunView>
  stopRun(runId: string): Promise<WorkflowRunView>
  listGates(runId?: string): Promise<PendingGateView[]>
  resolveGate(input: {
    runId: string
    stepId: string
    decision: string
    token: string
    resolvedBy?: string
  }): Promise<WorkflowRunView>
  listTemplates(): Promise<WorkflowTemplateView[]>
  saveTemplate(input: {
    yaml: string
    name?: string
    description?: string
    category?: string
    id?: string
    sourceWorkflowName?: string
  }): Promise<WorkflowTemplateView>
  deleteTemplate(templateId: string): Promise<boolean>
  promoteWorkflowToTemplate(workflowName: string, options?: {
    name?: string
    description?: string
    category?: string
    id?: string
  }): Promise<WorkflowTemplateView>
  getBinding(workspaceId: string): Promise<WorkspaceBindingView | null>
  setBinding(workspaceId: string, workflowName: string): Promise<WorkspaceBindingView>
  clearBinding(workspaceId: string): Promise<boolean>
  startBoundRun(workspaceId: string, params?: Record<string, unknown>): Promise<WorkflowRunView>
  getSettings(): Promise<WorkflowSettingsView>
  setSettings(settings: WorkflowSettingsView): Promise<WorkflowSettingsView>
  listModelCatalog(): Promise<WorkflowModelCatalogView>
  registerCustomProvider(input: WorkflowCustomProviderInput): Promise<{ provider: string; model: string; route: string }>
  listTriggers(): Promise<WorkflowTriggerView[]>
  addTrigger(config: WorkflowTriggerConfigView): Promise<{ id: string; config: WorkflowTriggerConfigView }>
  removeTrigger(triggerId: string): Promise<boolean>
  enableTrigger(triggerId: string): Promise<void>
  disableTrigger(triggerId: string): Promise<void>
  fireManualTrigger(triggerId: string, params?: Record<string, unknown>): Promise<void>
  fireTriggerEvent(source: string, eventName: string, data?: Record<string, unknown>): Promise<void>
  deleteRun(runId: string): Promise<boolean>
  exportRun(runId: string): Promise<WorkflowRunExportView>
  purgeRuns(): Promise<{ deleted: number }>
  getWorkflowStats(workflowName?: string): Promise<WorkflowStatsSummaryView[]>
  getWorkflowStatsDetail(
    workflowName: string,
    options?: { since?: string; recentLimit?: number },
  ): Promise<WorkflowStatsDetailView>
  getOpenAiApiStatus(): Promise<WorkflowOpenAiApiStatusView>
  getAwfStatus(): Promise<AwfStatusView>
  setAwfSettings(input: { baseUrl?: string; apiTokenEnv?: string; apiToken?: string }): Promise<AwfStatusView>
  checkAwfConnection(): Promise<AwfConnectionView>
  setAwfTelemetrySettings(telemetryEnabled: boolean): Promise<AwfStatusView>
  getAwfExecutorStatus(): Promise<AwfExecutorStatusView>
  setAwfExecutorSettings(executorEnabled: boolean): Promise<AwfStatusView>
  getAwfTunnelStatus(): Promise<AwfTunnelStatusView>
  setAwfTunnelSettings(tunnelEnabled: boolean, localPort: number): Promise<AwfStatusView>
  getAwfAuthStatus(): Promise<AwfAuthAccountView>
  getAwfAuthMethods(): Promise<AwfAuthMethodsView>
  awfAuthRegister(input: { email: string; password: string; displayName?: string }): Promise<AwfAuthAccountView>
  awfAuthLogin(input: { email: string; password: string }): Promise<AwfAuthAccountView>
  awfAuthSendPhoneCode(phone: string): Promise<{ ok: boolean; errorKind?: string; errorMessage?: string }>
  awfAuthPhoneLogin(input: { phone: string; code: string }): Promise<AwfAuthAccountView>
  awfAuthLogout(): Promise<{ ok: boolean }>
  syncWorkflowToAwf(name: string, visibility?: string, yaml?: string, publish?: boolean): Promise<AwfSyncReceiptView>
  remoteRunOnAwf(workflowId: number, params?: Record<string, string>): Promise<{
    ok: boolean
    status?: string
    resultText?: string
    errorText?: string
    runId?: number
    errorKind?: string
    errorMessage?: string
  }>
  setOpenAiApiSettings(settings: WorkflowOpenAiApiSettingsInput): Promise<{
    settings: WorkflowOpenAiApiStatusView
    apiKey?: string
  }>
  rotateOpenAiApiKey(): Promise<{
    settings: WorkflowOpenAiApiStatusView
    apiKey: string
  }>
  listOpenAiApiCalls(limit?: number): Promise<WorkflowOpenAiApiCallView[]>
  clearOpenAiApiCalls(): Promise<void>
  rsiListProblems(): Promise<Array<{
    id: number
    title: string
    domain: string
    maxIterations: number
    status: string
    scenarioCount: number
  }>>
  rsiCreateProblem(config: {
    title: string
    domain?: string
    maxIterations?: number
    reviewProviderId?: number
    improvementCriteria?: string
    baseYaml?: string
  }): Promise<{ id: number }>
  rsiRunIteration(problemId: number): Promise<{
    iterationNumber: number
    reviewScore: number
    reviewFeedback: string
    improvedYaml: string
  }>
  rsiGetIterations(problemId: number): Promise<Array<{
    id: number
    iterationNumber: number
    reviewScore: number
    reviewFeedback: string
    status: string
    durationMs: number
  }>>
  rsiDeleteProblem(problemId: number): Promise<{ ok: boolean }>
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function mapStep(raw: Record<string, unknown>): WorkflowStepView {
  const step: WorkflowStepView = {
    id: String(raw.id ?? ''),
    type: (raw.type as WorkflowStepType) || 'script',
  }
  if (typeof raw.run === 'string') step.run = raw.run
  if (typeof raw.prompt === 'string') step.prompt = raw.prompt
  if (Array.isArray(raw.deps)) step.deps = raw.deps.map(String)
  if (typeof raw.timeout === 'number') step.timeout = raw.timeout
  if (typeof raw.maxTokens === 'number') step.maxTokens = raw.maxTokens
  if (isObject(raw.env)) {
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(raw.env)) {
      if (typeof value === 'string') env[key] = value
    }
    if (Object.keys(env).length > 0) step.env = env
  }
  if (isObject(raw.inputs)) step.inputs = raw.inputs
  if (Array.isArray(raw.outputs)) step.outputs = raw.outputs.map(String)
  if (Array.isArray(raw.acceptance)) step.acceptance = raw.acceptance.map(String)
  if (typeof raw.harness === 'string') step.harness = raw.harness
  if (typeof raw.question === 'string') step.question = raw.question
  if (Array.isArray(raw.options)) step.options = raw.options.map(String)
  if (Array.isArray(raw.pass)) step.pass = raw.pass.map(String)
  if (typeof raw.ref === 'string') step.ref = raw.ref
  if (typeof raw.model === 'string') step.model = raw.model
  if (typeof raw.role === 'string') step.role = raw.role
  if (typeof raw.retries === 'number' && Number.isInteger(raw.retries) && raw.retries >= 0) {
    step.retries = raw.retries
  }
  const onFailure = raw.on_failure ?? raw.onFailure
  if (onFailure === 'fail' || onFailure === 'skip' || onFailure === 'compensate') {
    step.onFailure = onFailure
  }
  const compensation = raw.compensation
  if (isObject(compensation) && typeof compensation.run === 'string') {
    const view: WorkflowCompensationView = { run: compensation.run }
    if (isObject(compensation.env)) {
      const env: Record<string, string> = {}
      for (const [key, value] of Object.entries(compensation.env)) {
        if (typeof value === 'string') env[key] = value
      }
      if (Object.keys(env).length > 0) view.env = env
    }
    step.compensation = view
  }
  const ui = raw.ui
  if (isObject(ui) && typeof ui.x === 'number' && typeof ui.y === 'number') {
    step.ui = { x: ui.x, y: ui.y }
  }
  return step
}

/** Map engine Workflow document to the flat UI view. */
export function mapEngineWorkflow(value: unknown): WorkflowView {
  if (!isObject(value)) throw new Error('invalid workflow')
  if (isObject(value.metadata) && isObject(value.spec) && Array.isArray(value.spec.steps)) {
    const view: WorkflowView = {
      name: String(value.metadata.name ?? ''),
      title: typeof value.metadata.title === 'string' ? value.metadata.title : String(value.metadata.name ?? ''),
      steps: value.spec.steps.map((step) => mapStep(isObject(step) ? step : {})),
    }
    if (typeof value.metadata.uid === 'string' && value.metadata.uid.trim()) {
      view.uid = value.metadata.uid.trim()
    }
    if (typeof value.metadata.description === 'string') view.description = value.metadata.description
    if (typeof value.apiVersion === 'string') view.apiVersion = value.apiVersion
    if (typeof value.kind === 'string') view.kind = value.kind
    return view
  }
  const view: WorkflowView = {
    name: String(value.name ?? ''),
    title: typeof value.title === 'string' ? value.title : String(value.name ?? ''),
    steps: Array.isArray(value.steps)
      ? value.steps.map((step) => mapStep(isObject(step) ? step : {}))
      : [],
  }
  if (typeof value.uid === 'string' && value.uid.trim()) view.uid = value.uid.trim()
  if (typeof value.description === 'string') view.description = value.description
  return view
}

function mapGate(runId: string, value: unknown): PendingGateView | null {
  if (!isObject(value) || value.resolved || typeof value.token !== 'string') return null
  const gate: PendingGateView = {
    runId,
    stepId: String(value.stepId ?? ''),
    question: String(value.question ?? ''),
    options: Array.isArray(value.options) ? value.options.map(String) : [],
    token: value.token,
  }
  if (Array.isArray(value.pass)) gate.pass = value.pass.map(String)
  return gate
}

/** Map a single engine Dispatch to the UI dispatch view. */
function mapDispatch(value: unknown): RunDispatchView | null {
  if (!isObject(value)) return null
  const dispatch: RunDispatchView = {
    id: String(value.id ?? ''),
    status: String(value.status ?? 'queued'),
  }
  if (typeof value.attempt === 'number') dispatch.attempt = value.attempt
  if (value.phase === 'execute' || value.phase === 'compensate') dispatch.phase = value.phase
  if (typeof value.startedAt === 'string') dispatch.startedAt = value.startedAt
  if (typeof value.completedAt === 'string') dispatch.completedAt = value.completedAt
  if (typeof value.error === 'string') dispatch.error = value.error
  if (typeof value.cost === 'number') dispatch.cost = value.cost
  return dispatch
}

/** Wall-clock step duration in ms, or undefined when timestamps are missing/not terminal. */
export function computeStepDuration(
  startedAt?: string,
  completedAt?: string,
): number | undefined {
  if (!startedAt || !completedAt) return undefined
  const start = Date.parse(startedAt)
  const end = Date.parse(completedAt)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined
  return end - start
}

/** Map engine Run to UI run view with flattened step statuses. */
export function mapEngineRun(value: unknown): WorkflowRunView {
  if (!isObject(value)) throw new Error('invalid run')
  const id = String(value.id ?? '')
  const tasks = isObject(value.tasks) ? value.tasks : {}
  const gatesObj = isObject(value.gates) ? value.gates : {}
  const steps: RunStepView[] = Object.values(tasks).map((task) => {
    const t = isObject(task) ? task : {}
    const result = t.result
    const step: RunStepView = {
      id: String(t.stepId ?? t.id ?? ''),
      status: mapTaskStatus(String(t.status ?? 'pending')),
    }
    if (typeof t.startedAt === 'string') step.startedAt = t.startedAt
    if (typeof t.completedAt === 'string') step.completedAt = t.completedAt
    const durationMs = computeStepDuration(step.startedAt, step.completedAt)
    if (durationMs !== undefined) step.durationMs = durationMs
    const dispatches = Array.isArray(t.dispatches)
      ? t.dispatches
        .map((entry) => mapDispatch(entry))
        .filter((d): d is RunDispatchView => d !== null)
      : []
    if (dispatches.length > 0) step.dispatches = dispatches
    let attempt = 0
    for (const dispatch of dispatches) {
      if (dispatch.phase === 'compensate') continue
      if (typeof dispatch.attempt === 'number' && dispatch.attempt > attempt) attempt = dispatch.attempt
    }
    if (attempt > 0) step.attempt = attempt
    if (typeof result === 'string') step.output = result
    else if (result !== undefined) {
      try { step.output = JSON.stringify(result) } catch { step.output = String(result) }
    }
    if (typeof t.error === 'string') step.error = t.error
    return step
  })
  const gates = Object.values(gatesObj)
    .map((gate) => mapGate(id, gate))
    .filter((g): g is PendingGateView => g !== null)

  const run: WorkflowRunView = {
    id,
    workflowName: String(value.workflowName ?? ''),
    status: String(value.status ?? 'pending'),
    steps,
    gates,
  }
  if (typeof value.startedAt === 'string') run.startedAt = value.startedAt
  if (typeof value.completedAt === 'string') run.completedAt = value.completedAt
  if (isObject(value.params)) run.params = value.params
  if (typeof value.error === 'string') run.error = value.error
  return run
}

function mapTaskStatus(status: string): string {
  switch (status) {
    case 'in_progress': return 'running'
    case 'completed': return 'completed'
    case 'failed': return 'failed'
    case 'skipped': return 'skipped'
    case 'blocked': return 'pending'
    case 'ready': return 'pending'
    default: return status || 'pending'
  }
}

/** Build canonical YAML from the visual editor model. */
export function workflowViewToYaml(workflow: WorkflowView): string {
  const lines = [
    'apiVersion: workflow-wise/v1',
    'kind: Workflow',
    'metadata:',
  ]
  if (workflow.uid) lines.push(`  uid: ${workflow.uid}`)
  lines.push(`  name: ${workflow.name}`)
  if (workflow.title) lines.push(`  title: ${escapeYamlScalar(workflow.title)}`)
  if (workflow.description) lines.push(`  description: ${escapeYamlScalar(workflow.description)}`)
  lines.push('spec:', '  steps:')
  for (const step of workflow.steps) {
    lines.push(`    - id: ${step.id}`)
    lines.push(`      type: ${step.type}`)
    if (step.deps && step.deps.length > 0) {
      lines.push(`      deps: [${step.deps.join(', ')}]`)
    }
    if (step.run) lines.push(`      run: ${escapeYamlScalar(step.run)}`)
    if (step.env && Object.keys(step.env).length > 0) {
      lines.push('      env:')
      for (const [key, value] of Object.entries(step.env)) {
        lines.push(`        ${key}: ${escapeYamlScalar(value)}`)
      }
    }
    if (step.prompt) {
      lines.push('      prompt: |')
      for (const line of step.prompt.split('\n')) lines.push(`        ${line}`)
    }
    if (step.inputs && Object.keys(step.inputs).length > 0) {
      lines.push('      inputs:')
      for (const [key, value] of Object.entries(step.inputs)) {
        lines.push(...formatYamlMappingLines(key, value, 8))
      }
    }
    if (step.outputs && step.outputs.length > 0) {
      lines.push(`      outputs: [${step.outputs.map((item) => escapeYamlScalar(item)).join(', ')}]`)
    }
    if (step.acceptance && step.acceptance.length > 0) {
      lines.push('      acceptance:')
      for (const item of step.acceptance) {
        lines.push(`        - ${escapeYamlScalar(item)}`)
      }
    }
    if (step.harness) lines.push(`      harness: ${escapeYamlScalar(step.harness)}`)
    if (step.question) lines.push(`      question: ${escapeYamlScalar(step.question)}`)
    if (step.options && step.options.length > 0) {
      lines.push(`      options: [${step.options.map((item) => escapeYamlScalar(item)).join(', ')}]`)
    } else if (step.type === 'approval') {
      lines.push('      options: [approved, rejected]')
    }
    if (step.pass && step.pass.length > 0) {
      lines.push(`      pass: [${step.pass.map((item) => escapeYamlScalar(item)).join(', ')}]`)
    }
    if (step.ref) lines.push(`      ref: ${step.ref}`)
    if (step.model) lines.push(`      model: ${step.model}`)
    if (step.role) lines.push(`      role: ${step.role}`)
    if (step.timeout) lines.push(`      timeout: ${step.timeout}`)
    if (typeof step.maxTokens === 'number') lines.push(`      maxTokens: ${step.maxTokens}`)
    if (typeof step.retries === 'number') lines.push(`      retries: ${step.retries}`)
    if (step.onFailure) lines.push(`      on_failure: ${step.onFailure}`)
    if (step.compensation?.run) {
      lines.push('      compensation:')
      lines.push(`        run: ${escapeYamlScalar(step.compensation.run)}`)
      if (step.compensation.env && Object.keys(step.compensation.env).length > 0) {
        lines.push('        env:')
        for (const [key, value] of Object.entries(step.compensation.env)) {
          lines.push(`          ${key}: ${escapeYamlScalar(value)}`)
        }
      }
    }
    if (step.ui && typeof step.ui.x === 'number' && typeof step.ui.y === 'number') {
      lines.push('      ui:')
      lines.push(`        x: ${step.ui.x}`)
      lines.push(`        y: ${step.ui.y}`)
    }
  }
  return `${lines.join('\n')}\n`
}

function escapeYamlScalar(value: string): string {
  if (/[:#{}[\],&*?|>!%@`]/.test(value) || value.includes('\n') || value.includes('"')) {
    return JSON.stringify(value)
  }
  return value
}

function formatYamlScalar(value: unknown): string {
  if (typeof value === 'string') return escapeYamlScalar(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value === null || value === undefined) return 'null'
  return escapeYamlScalar(String(value))
}

/** Emit nested YAML mapping lines for objects/arrays (preserve types on round-trip). */
function formatYamlMappingLines(key: string, value: unknown, indent: number): string[] {
  const pad = ' '.repeat(indent)
  if (value === null || value === undefined
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean') {
    return [`${pad}${key}: ${formatYamlScalar(value)}`]
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${pad}${key}: []`]
    const lines = [`${pad}${key}:`]
    for (const item of value) {
      if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
        const entries = Object.entries(item as Record<string, unknown>)
        if (entries.length === 0) {
          lines.push(`${pad}  - {}`)
          continue
        }
        let first = true
        for (const [nestedKey, nestedVal] of entries) {
          const nestedLines = formatYamlMappingLines(nestedKey, nestedVal, indent + 4)
          if (first) {
            const head = nestedLines[0] ?? `${pad}    ${nestedKey}:`
            lines.push(`${pad}  - ${head.trimStart()}`)
            lines.push(...nestedLines.slice(1))
            first = false
          } else {
            lines.push(...nestedLines)
          }
        }
      } else if (Array.isArray(item) || (item !== null && typeof item === 'object')) {
        lines.push(`${pad}  - ${JSON.stringify(item)}`)
      } else {
        lines.push(`${pad}  - ${formatYamlScalar(item)}`)
      }
    }
    return lines
  }
  if (isObject(value)) {
    const entries = Object.entries(value)
    if (entries.length === 0) return [`${pad}${key}: {}`]
    const lines = [`${pad}${key}:`]
    for (const [nestedKey, nestedVal] of entries) {
      lines.push(...formatYamlMappingLines(nestedKey, nestedVal, indent + 2))
    }
    return lines
  }
  return [`${pad}${key}: ${formatYamlScalar(value)}`]
}

function mapTriggerConfig(raw: unknown): WorkflowTriggerConfigView {
  const record = isObject(raw) ? raw : {}
  const type = record.type === 'event' || record.type === 'manual' || record.type === 'cron'
    ? record.type
    : 'manual'
  const config: WorkflowTriggerConfigView = {
    type,
    workflowName: String(record.workflowName ?? ''),
  }
  if (typeof record.schedule === 'string') config.schedule = record.schedule
  if (typeof record.source === 'string') config.source = record.source
  if (typeof record.on === 'string') config.on = record.on
  if (typeof record.filter === 'string') config.filter = record.filter
  if (isObject(record.params)) config.params = record.params
  return config
}

function mapTrigger(raw: unknown): WorkflowTriggerView {
  const record = isObject(raw) ? raw : {}
  const view: WorkflowTriggerView = {
    id: String(record.id ?? ''),
    config: mapTriggerConfig(record.config),
    enabled: Boolean(record.enabled),
  }
  if (typeof record.nextTrigger === 'string') view.nextTrigger = record.nextTrigger
  return view
}

function mapTranscriptEvents(result: unknown): WorkflowTranscriptEventView[] {
  if (!Array.isArray(result)) return []
  return result.map((item) => {
    const raw = isObject(item) ? item : {}
    const event: WorkflowTranscriptEventView = {
      ts: String(raw.ts ?? ''),
      type: String(raw.type ?? ''),
    }
    if (typeof raw.stepId === 'string') event.stepId = raw.stepId
    if (typeof raw.dispatchId === 'string') event.dispatchId = raw.dispatchId
    if (isObject(raw.data)) event.data = raw.data
    return event
  })
}

function mapTranscriptPage(result: unknown): WorkflowTranscriptPageView {
  if (Array.isArray(result)) {
    return { events: mapTranscriptEvents(result) }
  }
  if (!isObject(result)) return { events: [] }
  const page: WorkflowTranscriptPageView = {
    events: mapTranscriptEvents(result.events),
  }
  if (typeof result.nextAfter === 'string') page.nextAfter = result.nextAfter
  return page
}

function mapSettings(result: unknown, fallback?: WorkflowSettingsView): WorkflowSettingsView {
  const defaults: WorkflowSettingsView = fallback ?? {
    providers: [],
    defaultBias: 'coding',
    defaultRetries: 2,
    defaultOnFailure: 'fail',
  }
  if (!isObject(result)) return defaults
  const settings: WorkflowSettingsView = {
    providers: Array.isArray(result.providers)
      ? result.providers as WorkflowLlmProviderPrefView[]
      : defaults.providers,
    defaultBias: typeof result.defaultBias === 'string' ? result.defaultBias : defaults.defaultBias,
    defaultRetries: typeof result.defaultRetries === 'number' ? result.defaultRetries : defaults.defaultRetries,
    defaultOnFailure: result.defaultOnFailure === 'skip' || result.defaultOnFailure === 'compensate' || result.defaultOnFailure === 'fail'
      ? result.defaultOnFailure
      : defaults.defaultOnFailure,
  }
  if (typeof result.maxRetainedRuns === 'number') settings.maxRetainedRuns = result.maxRetainedRuns
  if (typeof result.maxRunAgeDays === 'number') settings.maxRunAgeDays = result.maxRunAgeDays
  if (result.scriptPolicy === 'allow' || result.scriptPolicy === 'deny' || result.scriptPolicy === 'workspace-only') {
    settings.scriptPolicy = result.scriptPolicy
  }
  return settings
}

function mapStatsSummary(value: unknown): WorkflowStatsSummaryView | null {
  if (!isObject(value) || typeof value.workflowName !== 'string') return null
  return {
    workflowName: value.workflowName,
    ...(typeof value.title === 'string' ? { title: value.title } : {}),
    totalRuns: typeof value.totalRuns === 'number' ? value.totalRuns : 0,
    completed: typeof value.completed === 'number' ? value.completed : 0,
    failed: typeof value.failed === 'number' ? value.failed : 0,
    aborted: typeof value.aborted === 'number' ? value.aborted : 0,
    running: typeof value.running === 'number' ? value.running : 0,
    successRate: typeof value.successRate === 'number' ? value.successRate : 0,
    avgDurationMs: typeof value.avgDurationMs === 'number' ? value.avgDurationMs : null,
    lastRunAt: typeof value.lastRunAt === 'string' ? value.lastRunAt : null,
    lastStatus: typeof value.lastStatus === 'string' ? value.lastStatus : null,
  }
}

function mapStatsDetail(value: unknown): WorkflowStatsDetailView {
  const summary = mapStatsSummary(value)
  if (!summary) {
    throw new Error('invalid workflow stats detail')
  }
  const raw = isObject(value) ? value : {}
  const byDay = Array.isArray(raw.byDay)
    ? raw.byDay.flatMap((entry) => {
      if (!isObject(entry) || typeof entry.date !== 'string') return []
      return [{
        date: entry.date,
        total: typeof entry.total === 'number' ? entry.total : 0,
        completed: typeof entry.completed === 'number' ? entry.completed : 0,
        failed: typeof entry.failed === 'number' ? entry.failed : 0,
        avgDurationMs: typeof entry.avgDurationMs === 'number' ? entry.avgDurationMs : null,
      }]
    })
    : []
  const recentRuns = Array.isArray(raw.recentRuns)
    ? raw.recentRuns.flatMap((entry) => {
      if (!isObject(entry) || typeof entry.id !== 'string') return []
      return [{
        id: entry.id,
        status: String(entry.status ?? ''),
        startedAt: String(entry.startedAt ?? ''),
        ...(typeof entry.completedAt === 'string' ? { completedAt: entry.completedAt } : {}),
        ...(typeof entry.durationMs === 'number' ? { durationMs: entry.durationMs } : {}),
        ...(typeof entry.error === 'string' ? { error: entry.error } : {}),
      }]
    })
    : []
  return { ...summary, byDay, recentRuns }
}

function mapOpenAiApiCall(value: unknown): WorkflowOpenAiApiCallView | null {
  if (!isObject(value) || typeof value.id !== 'string' || typeof value.ts !== 'string') return null
  if (typeof value.method !== 'string' || typeof value.path !== 'string') return null
  if (typeof value.clientIp !== 'string' || typeof value.statusCode !== 'number') return null
  return {
    id: value.id,
    ts: value.ts,
    method: value.method,
    path: value.path,
    clientIp: value.clientIp,
    statusCode: value.statusCode,
    ok: value.ok === true,
    ...(typeof value.model === 'string' ? { model: value.model } : {}),
    ...(typeof value.workflowName === 'string' ? { workflowName: value.workflowName } : {}),
    ...(typeof value.runId === 'string' ? { runId: value.runId } : {}),
    ...(typeof value.error === 'string' ? { error: value.error } : {}),
    ...(typeof value.durationMs === 'number' ? { durationMs: value.durationMs } : {}),
    ...(typeof value.stream === 'boolean' ? { stream: value.stream } : {}),
  }
}

function mapOpenAiApiStatus(value: unknown): WorkflowOpenAiApiStatusView {
  const defaults: WorkflowOpenAiApiStatusView = {
    enabled: false,
    bindHost: '0.0.0.0',
    port: 8787,
    hasApiKey: false,
    maxBodyBytes: 512 * 1024,
    maxConcurrent: 4,
    listening: false,
    baseUrl: null,
    usingTls: false,
    lastError: null,
  }
  if (!isObject(value)) return defaults
  return {
    enabled: Boolean(value.enabled),
    bindHost: typeof value.bindHost === 'string' ? value.bindHost : defaults.bindHost,
    port: typeof value.port === 'number' ? value.port : defaults.port,
    hasApiKey: Boolean(value.hasApiKey),
    maxBodyBytes: typeof value.maxBodyBytes === 'number' ? value.maxBodyBytes : defaults.maxBodyBytes,
    maxConcurrent: typeof value.maxConcurrent === 'number' ? value.maxConcurrent : defaults.maxConcurrent,
    listening: Boolean(value.listening),
    baseUrl: typeof value.baseUrl === 'string' ? value.baseUrl : null,
    usingTls: Boolean(value.usingTls),
    lastError: typeof value.lastError === 'string' ? value.lastError : null,
  }
}

function mapAwfAuthAccount(value: unknown): AwfAuthAccountView {
  if (!isObject(value)) return { hasSession: false }
  return {
    hasSession: value.hasSession === true,
    ...(typeof value.email === 'string' ? { email: value.email } : {}),
    ...(typeof value.displayName === 'string' ? { displayName: value.displayName } : {}),
    ...(typeof value.tokenFingerprint === 'string' ? { tokenFingerprint: value.tokenFingerprint } : {}),
    ...(typeof value.accessTokenExpiresAt === 'string' ? { accessTokenExpiresAt: value.accessTokenExpiresAt } : {}),
    ...(typeof value.errorKind === 'string' ? { errorKind: value.errorKind } : {}),
    ...(typeof value.errorMessage === 'string' ? { errorMessage: value.errorMessage } : {}),
  }
}

function mapAwfStatus(value: unknown): AwfStatusView {
  if (!isObject(value)) {
    return {
      baseUrl: '',
      apiTokenEnv: 'AWF_API_TOKEN',
      hasToken: false,
      tokenFingerprint: '',
      telemetryEnabled: false,
      executorEnabled: false,
      tunnelEnabled: false,
      tunnelLocalPort: 8787,
    }
  }
  return {
    baseUrl: typeof value.baseUrl === 'string' ? value.baseUrl : '',
    apiTokenEnv: typeof value.apiTokenEnv === 'string' ? value.apiTokenEnv : 'AWF_API_TOKEN',
    hasToken: Boolean(value.hasToken),
    tokenFingerprint: typeof value.tokenFingerprint === 'string' ? value.tokenFingerprint : '',
    telemetryEnabled: value.telemetryEnabled === true,
    executorEnabled: value.executorEnabled === true,
    tunnelEnabled: value.tunnelEnabled === true,
    tunnelLocalPort: typeof value.tunnelLocalPort === 'number' ? value.tunnelLocalPort : 8787,
  }
}

async function callOp(
  fetchImpl: FetchLike,
  body: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetchImpl(WORKFLOW_PATH, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let payload: unknown
  try {
    payload = text.length > 0 ? JSON.parse(text) as unknown : null
  } catch {
    throw new Error(
      response.ok
        ? `invalid workflow response: ${text.slice(0, 120)}`
        : `workflow API unavailable (${response.status}): ${text.slice(0, 120)}`,
    )
  }
  if (!isObject(payload)) throw new Error('invalid workflow response')
  if (!response.ok || payload.ok !== true) {
    throw new Error(typeof payload.error === 'string' ? payload.error : `workflow ${String(body.op)} failed`)
  }
  return payload.result
}

/** Create the browser-side workflow API facade. */
export function createDesktopWorkflowApi(fetchImpl: FetchLike = fetch): DesktopWorkflowApi {
  return {
    async listWorkflows() {
      const result = await callOp(fetchImpl, { op: 'listWorkflows' })
      if (!Array.isArray(result)) return []
      return result.map(mapEngineWorkflow)
    },
    async getWorkflow(name) {
      const result = await callOp(fetchImpl, { op: 'getWorkflow', name })
      return result ? mapEngineWorkflow(result) : null
    },
    async saveWorkflow(yaml) {
      const result = await callOp(fetchImpl, { op: 'saveWorkflow', yaml })
      if (!isObject(result)) throw new Error('invalid save response')
      return {
        workflow: mapEngineWorkflow(result.workflow),
        validation: (result.validation ?? { ok: true, errors: [] }) as ValidationView,
      }
    },
    async deleteWorkflow(name) {
      const result = await callOp(fetchImpl, { op: 'deleteWorkflow', name })
      return isObject(result) ? Boolean(result.deleted) : false
    },
    async validateWorkflow(yaml) {
      const result = await callOp(fetchImpl, { op: 'validateWorkflow', yaml })
      return (result ?? { ok: false, errors: [] }) as ValidationView
    },
    async canonicalizeYaml(yaml) {
      const result = await callOp(fetchImpl, { op: 'canonicalizeYaml', yaml })
      if (isObject(result) && typeof result.yaml === 'string') return result.yaml
      throw new Error('invalid canonicalize response')
    },
    async exportWorkflowYaml(name) {
      const result = await callOp(fetchImpl, { op: 'exportWorkflowYaml', name })
      if (isObject(result) && typeof result.yaml === 'string') return result.yaml
      throw new Error('invalid export response')
    },
    async designWorkflow(input) {
      const result = await callOp(fetchImpl, {
        op: 'designWorkflow',
        prompt: input.prompt,
        ...(input.yaml ? { yaml: input.yaml } : {}),
        ...(input.mode ? { mode: input.mode } : {}),
        includeModelCatalog: input.includeModelCatalog !== false,
        ...(input.designModel?.trim() ? { designModel: input.designModel.trim() } : {}),
        ...(typeof input.maxTokens === 'number' ? { maxTokens: input.maxTokens } : {}),
      })
      if (!isObject(result) || typeof result.yaml !== 'string') {
        throw new Error('invalid designWorkflow response')
      }
      return {
        yaml: result.yaml,
        mode: result.mode === 'modify' ? 'modify' : 'create',
        validation: (result.validation ?? { ok: false, errors: [] }) as ValidationView,
      }
    },
    async listRuns(workflowName) {
      const result = await callOp(fetchImpl, { op: 'listRuns', workflowName })
      if (!Array.isArray(result)) return []
      return result.map(mapEngineRun)
    },
    async getRun(runId) {
      const result = await callOp(fetchImpl, { op: 'getRun', runId })
      return result ? mapEngineRun(result) : null
    },
    async getTranscript(runId, options) {
      const result = await callOp(fetchImpl, {
        op: 'getTranscript',
        runId,
        ...(options?.after ? { after: options.after } : {}),
        ...(typeof options?.limit === 'number' ? { limit: options.limit } : {}),
      })
      return mapTranscriptPage(result)
    },
    async startRun(workflowName, params) {
      const result = await callOp(fetchImpl, { op: 'startRun', workflowName, params })
      return mapEngineRun(result)
    },
    async stopRun(runId) {
      const result = await callOp(fetchImpl, { op: 'stopRun', runId })
      return mapEngineRun(result)
    },
    async deleteRun(runId) {
      const result = await callOp(fetchImpl, { op: 'deleteRun', runId })
      return isObject(result) ? Boolean(result.deleted) : false
    },
    async exportRun(runId) {
      const result = await callOp(fetchImpl, { op: 'exportRun', runId })
      if (!isObject(result)) throw new Error('invalid exportRun response')
      return {
        schemaVersion: typeof result.schemaVersion === 'number' ? result.schemaVersion : 0,
        run: mapEngineRun(result.run),
        transcript: mapTranscriptEvents(result.transcript),
      }
    },
    async purgeRuns() {
      const result = await callOp(fetchImpl, { op: 'purgeRuns' })
      return {
        deleted: isObject(result) && typeof result.deleted === 'number' ? result.deleted : 0,
      }
    },
    async listGates(runId) {
      const result = await callOp(fetchImpl, { op: 'listGates', runId })
      if (!Array.isArray(result)) return []
      return result as PendingGateView[]
    },
    async resolveGate(input) {
      const result = await callOp(fetchImpl, { op: 'resolveGate', ...input })
      return mapEngineRun(result)
    },
    async listTemplates() {
      const result = await callOp(fetchImpl, { op: 'listTemplates' })
      if (!Array.isArray(result)) return []
      return result as WorkflowTemplateView[]
    },
    async saveTemplate(input) {
      const result = await callOp(fetchImpl, {
        op: 'saveTemplate',
        yaml: input.yaml,
        ...(input.name ? { templateName: input.name } : {}),
        ...(input.description ? { templateDescription: input.description } : {}),
        ...(input.category ? { templateCategory: input.category } : {}),
        ...(input.id ? { templateId: input.id } : {}),
        ...(input.sourceWorkflowName ? { workflowName: input.sourceWorkflowName } : {}),
      })
      if (!isObject(result) || typeof result.id !== 'string') {
        throw new Error('invalid saveTemplate response')
      }
      return result as unknown as WorkflowTemplateView
    },
    async deleteTemplate(templateId) {
      const result = await callOp(fetchImpl, { op: 'deleteTemplate', templateId })
      return isObject(result) ? Boolean(result.removed) : false
    },
    async promoteWorkflowToTemplate(workflowName, options) {
      const result = await callOp(fetchImpl, {
        op: 'promoteWorkflowToTemplate',
        workflowName,
        ...(options?.name ? { templateName: options.name } : {}),
        ...(options?.description ? { templateDescription: options.description } : {}),
        ...(options?.category ? { templateCategory: options.category } : {}),
        ...(options?.id ? { templateId: options.id } : {}),
      })
      if (!isObject(result) || typeof result.id !== 'string') {
        throw new Error('invalid promoteWorkflowToTemplate response')
      }
      return result as unknown as WorkflowTemplateView
    },
    async getBinding(workspaceId) {
      const result = await callOp(fetchImpl, { op: 'getBinding', workspaceId })
      return (result ?? null) as WorkspaceBindingView | null
    },
    async setBinding(workspaceId, workflowName) {
      const result = await callOp(fetchImpl, { op: 'setBinding', workspaceId, workflowName })
      return result as WorkspaceBindingView
    },
    async clearBinding(workspaceId) {
      const result = await callOp(fetchImpl, { op: 'clearBinding', workspaceId })
      return isObject(result) ? Boolean(result.cleared) : false
    },
    async startBoundRun(workspaceId, params) {
      const result = await callOp(fetchImpl, { op: 'startBoundRun', workspaceId, params })
      return mapEngineRun(result)
    },
    async getSettings() {
      const result = await callOp(fetchImpl, { op: 'getSettings' })
      return mapSettings(result)
    },
    async setSettings(settings) {
      const result = await callOp(fetchImpl, { op: 'setSettings', settings })
      return mapSettings(result, settings)
    },
    async listModelCatalog() {
      const result = await callOp(fetchImpl, { op: 'listModelCatalog' })
      if (!isObject(result)) {
        return { protocols: [], providers: [] }
      }
      const protocols = Array.isArray(result.protocols)
        ? result.protocols.map(String)
        : []
      const providers = Array.isArray(result.providers)
        ? result.providers.flatMap((entry) => {
          if (!isObject(entry)) return []
          const models = Array.isArray(entry.models)
            ? entry.models.flatMap((model) => {
              if (!isObject(model)) return []
              return [{ id: String(model.id ?? ''), name: String(model.name ?? model.id ?? '') }]
            })
            : []
          return [{
            id: String(entry.id ?? ''),
            name: String(entry.name ?? entry.id ?? ''),
            models,
          }]
        })
        : []
      return {
        protocols,
        providers,
        ...(typeof result.defaultRoute === 'string' ? { defaultRoute: result.defaultRoute } : {}),
        ...(typeof result.defaultModel === 'string' ? { defaultModel: result.defaultModel } : {}),
      }
    },
    async registerCustomProvider(input) {
      const result = await callOp(fetchImpl, { op: 'registerCustomProvider', customProvider: input })
      if (!isObject(result)) throw new Error('invalid custom provider response')
      return {
        provider: String(result.provider ?? input.routeId),
        model: String(result.model ?? input.modelId),
        route: String(result.route ?? `${input.routeId}/${input.modelId}`),
      }
    },
    async listTriggers() {
      const result = await callOp(fetchImpl, { op: 'listTriggers' })
      if (!Array.isArray(result)) return []
      return result.map(mapTrigger)
    },
    async addTrigger(config) {
      const result = await callOp(fetchImpl, { op: 'addTrigger', triggerConfig: config })
      if (!isObject(result)) throw new Error('invalid addTrigger response')
      return {
        id: String(result.id ?? ''),
        config: mapTriggerConfig(result.config ?? config),
      }
    },
    async removeTrigger(triggerId) {
      const result = await callOp(fetchImpl, { op: 'removeTrigger', triggerId })
      return isObject(result) ? Boolean(result.removed) : false
    },
    async enableTrigger(triggerId) {
      await callOp(fetchImpl, { op: 'enableTrigger', triggerId })
    },
    async disableTrigger(triggerId) {
      await callOp(fetchImpl, { op: 'disableTrigger', triggerId })
    },
    async fireManualTrigger(triggerId, params) {
      await callOp(fetchImpl, {
        op: 'fireManualTrigger',
        triggerId,
        ...(params ? { params } : {}),
      })
    },
    async fireTriggerEvent(source, eventName, data) {
      await callOp(fetchImpl, {
        op: 'fireTriggerEvent',
        source,
        eventName,
        ...(data ? { data } : {}),
      })
    },
    async getWorkflowStats(workflowName) {
      const result = await callOp(fetchImpl, {
        op: 'getWorkflowStats',
        ...(workflowName ? { workflowName } : {}),
      })
      if (!Array.isArray(result)) return []
      return result.flatMap((entry) => {
        const mapped = mapStatsSummary(entry)
        return mapped ? [mapped] : []
      })
    },
    async getWorkflowStatsDetail(workflowName, options) {
      const result = await callOp(fetchImpl, {
        op: 'getWorkflowStatsDetail',
        workflowName,
        ...(options?.since ? { since: options.since } : {}),
        ...(typeof options?.recentLimit === 'number' ? { recentLimit: options.recentLimit } : {}),
      })
      return mapStatsDetail(result)
    },
    async getOpenAiApiStatus() {
      const result = await callOp(fetchImpl, { op: 'getOpenAiApiStatus' })
      return mapOpenAiApiStatus(result)
    },
    async getAwfStatus() {
      const result = await callOp(fetchImpl, { op: 'awfGetSettings' })
      if (!isObject(result)) throw new Error('invalid awfGetSettings response')
      return mapAwfStatus(result)
    },
    async setAwfSettings(input) {
      const result = await callOp(fetchImpl, { op: 'awfSetSettings', awfSettings: input })
      if (!isObject(result)) throw new Error('invalid awfSetSettings response')
      return mapAwfStatus(result)
    },
    async checkAwfConnection() {
      const result = await callOp(fetchImpl, { op: 'awfCheckConnection' })
      if (!isObject(result)) throw new Error('invalid awfCheckConnection response')
      return {
        ok: Boolean(result.ok),
        ...(typeof result.email === 'string' ? { email: result.email } : {}),
        ...(typeof result.errorKind === 'string' ? { errorKind: result.errorKind } : {}),
        ...(typeof result.errorMessage === 'string' ? { errorMessage: result.errorMessage } : {}),
      }
    },
    async setAwfTelemetrySettings(telemetryEnabled) {
      const result = await callOp(fetchImpl, {
        op: 'awfSetTelemetrySettings',
        awfTelemetrySettings: { telemetryEnabled },
      })
      if (!isObject(result)) throw new Error('invalid awfSetTelemetrySettings response')
      return mapAwfStatus(result)
    },
    async getAwfExecutorStatus() {
      const result = await callOp(fetchImpl, { op: 'awfGetExecutorStatus' })
      if (!isObject(result)) throw new Error('invalid awfGetExecutorStatus response')
      return {
        running: result.running === true,
        registered: result.registered === true,
        executorId: typeof result.executorId === 'number' ? result.executorId : null,
        executingTaskId: typeof result.executingTaskId === 'number' ? result.executingTaskId : null,
        lastClaimAt: typeof result.lastClaimAt === 'string' ? result.lastClaimAt : null,
        lastError: typeof result.lastError === 'string' ? result.lastError : null,
      }
    },
    async setAwfExecutorSettings(executorEnabled) {
      const result = await callOp(fetchImpl, {
        op: 'awfSetExecutorSettings',
        awfExecutorSettings: { executorEnabled },
      })
      if (!isObject(result)) throw new Error('invalid awfSetExecutorSettings response')
      return mapAwfStatus(result)
    },
    async getAwfTunnelStatus() {
      const result = await callOp(fetchImpl, { op: 'awfGetTunnelStatus' })
      if (!isObject(result)) throw new Error('invalid awfGetTunnelStatus response')
      return {
        connected: result.connected === true,
        localPort: typeof result.localPort === 'number' ? result.localPort : 8787,
        executorId: typeof result.executorId === 'number' ? result.executorId : null,
        since: typeof result.since === 'string' ? result.since : null,
        error: typeof result.error === 'string' ? result.error : null,
      }
    },
    async setAwfTunnelSettings(tunnelEnabled, localPort) {
      const result = await callOp(fetchImpl, {
        op: 'awfSetTunnelSettings',
        awfTunnelSettings: { tunnelEnabled, localPort },
      })
      if (!isObject(result)) throw new Error('invalid awfSetTunnelSettings response')
      return mapAwfStatus(result)
    },
    async getAwfAuthStatus() {
      const result = await callOp(fetchImpl, { op: 'awfAuthStatus' })
      if (!isObject(result)) throw new Error('invalid awfAuthStatus response')
      return mapAwfAuthAccount(result)
    },
    async getAwfAuthMethods() {
      const result = await callOp(fetchImpl, { op: 'awfAuthMethods' })
      if (!isObject(result)) throw new Error('invalid awfAuthMethods response')
      return {
        email: result.email === true,
        phone: result.phone === true,
        wechat: result.wechat === true,
        ...(typeof result.wechatReason === 'string' ? { wechatReason: result.wechatReason } : {}),
      }
    },
    async awfAuthRegister(input) {
      const result = await callOp(fetchImpl, {
        op: 'awfAuthRegister',
        awfAuthCredentials: { ...input },
      })
      if (!isObject(result)) throw new Error('invalid awfAuthRegister response')
      return mapAwfAuthAccount(result)
    },
    async awfAuthLogin(input) {
      const result = await callOp(fetchImpl, {
        op: 'awfAuthLogin',
        awfAuthCredentials: { ...input },
      })
      if (!isObject(result)) throw new Error('invalid awfAuthLogin response')
      return mapAwfAuthAccount(result)
    },
    async awfAuthSendPhoneCode(phone) {
      const result = await callOp(fetchImpl, {
        op: 'awfAuthSendPhoneCode',
        awfAuthCredentials: { phone },
      })
      if (!isObject(result)) throw new Error('invalid awfAuthSendPhoneCode response')
      return {
        ok: result.ok === true,
        ...(typeof result.errorKind === 'string' ? { errorKind: result.errorKind } : {}),
        ...(typeof result.errorMessage === 'string' ? { errorMessage: result.errorMessage } : {}),
      }
    },
    async awfAuthPhoneLogin(input) {
      const result = await callOp(fetchImpl, {
        op: 'awfAuthPhoneLogin',
        awfAuthCredentials: { ...input },
      })
      if (!isObject(result)) throw new Error('invalid awfAuthPhoneLogin response')
      return mapAwfAuthAccount(result)
    },
    async awfAuthLogout() {
      const result = await callOp(fetchImpl, { op: 'awfAuthLogout' })
      if (!isObject(result)) throw new Error('invalid awfAuthLogout response')
      return { ok: result.ok === true }
    },
    async syncWorkflowToAwf(name, visibility, yaml, publish) {
      const result = await callOp(fetchImpl, {
        op: 'awfSync',
        name,
        ...(visibility ? { awfVisibility: visibility } : {}),
        ...(yaml ? { yaml } : {}),
        ...(publish === true ? { awfPublish: true } : {}),
      })
      if (!isObject(result)) throw new Error('invalid awfSync response')
      const validation = isObject(result.validation)
        ? {
          name: String(result.validation.name ?? ''),
          ok: Boolean(result.validation.ok),
          errors: Array.isArray(result.validation.errors)
            ? result.validation.errors.flatMap((e) => {
              if (!isObject(e)) return []
              return [{
                path: String(e.path ?? ''),
                code: String(e.code ?? ''),
                msg: String(e.msg ?? ''),
              }]
            })
            : [],
          conflict: typeof result.validation.conflict === 'string' ? result.validation.conflict : null,
        }
        : undefined
      const workflow = isObject(result.workflow)
        ? {
          id: Number(result.workflow.id ?? 0),
          name: String(result.workflow.name ?? ''),
          title: String(result.workflow.title ?? ''),
          status: String(result.workflow.status ?? ''),
          visibility: String(result.workflow.visibility ?? ''),
        }
        : undefined
      return {
        ok: Boolean(result.ok),
        stage: (result.stage === 'preflight' || result.stage === 'pushed' || result.stage === 'error'
          ? result.stage
          : 'error') as AwfSyncReceiptView['stage'],
        ...(validation ? { validation } : {}),
        ...(workflow ? { workflow } : {}),
        ...(typeof result.errorKind === 'string' ? { errorKind: result.errorKind } : {}),
        ...(typeof result.errorMessage === 'string' ? { errorMessage: result.errorMessage } : {}),
      }
    },
    async remoteRunOnAwf(workflowId, params) {
      const result = await callOp(fetchImpl, {
        op: 'awfRemoteRun',
        awfWorkflowId: workflowId,
        ...(params ? { params } : {}),
      })
      if (!isObject(result)) throw new Error('invalid awfRemoteRun response')
      return {
        ok: Boolean(result.ok),
        ...(typeof result.status === 'string' ? { status: result.status } : {}),
        ...(typeof result.resultText === 'string' ? { resultText: result.resultText } : {}),
        ...(typeof result.errorText === 'string' ? { errorText: result.errorText } : {}),
        ...(typeof result.runId === 'number' ? { runId: result.runId } : {}),
        ...(typeof result.errorKind === 'string' ? { errorKind: result.errorKind } : {}),
        ...(typeof result.errorMessage === 'string' ? { errorMessage: result.errorMessage } : {}),
      }
    },
    async setOpenAiApiSettings(settings) {
      const result = await callOp(fetchImpl, {
        op: 'setOpenAiApiSettings',
        openAiApiSettings: settings,
      })
      if (!isObject(result)) throw new Error('invalid setOpenAiApiSettings response')
      return {
        settings: mapOpenAiApiStatus(result.settings),
        ...(typeof result.apiKey === 'string' ? { apiKey: result.apiKey } : {}),
      }
    },
    async rotateOpenAiApiKey() {
      const result = await callOp(fetchImpl, { op: 'rotateOpenAiApiKey' })
      if (!isObject(result) || typeof result.apiKey !== 'string') {
        throw new Error('invalid rotateOpenAiApiKey response')
      }
      return {
        settings: mapOpenAiApiStatus(result.settings),
        apiKey: result.apiKey,
      }
    },
    async listOpenAiApiCalls(limit) {
      const result = await callOp(fetchImpl, {
        op: 'listOpenAiApiCalls',
        ...(typeof limit === 'number' ? { limit } : {}),
      })
      if (!isObject(result) || !Array.isArray(result.calls)) {
        throw new Error('invalid listOpenAiApiCalls response')
      }
      return result.calls.flatMap((entry) => {
        const mapped = mapOpenAiApiCall(entry)
        return mapped ? [mapped] : []
      })
    },
    async clearOpenAiApiCalls() {
      await callOp(fetchImpl, { op: 'clearOpenAiApiCalls' })
    },
    async rsiListProblems() {
      const result = await callOp(fetchImpl, { op: 'rsiListProblems' })
      return Array.isArray(result) ? result : []
    },
    async rsiCreateProblem(config: {
      title: string
      domain?: string | undefined
      maxIterations?: number | undefined
      reviewProviderId?: number | undefined
      improvementCriteria?: string | undefined
      baseYaml?: string | undefined
    }) {
      const result = await callOp(fetchImpl, { op: 'rsiCreateProblem', rsiConfig: config })
      return isObject(result) ? result as { id: number } : { id: 0 }
    },
    async rsiRunIteration(problemId) {
      const result = await callOp(fetchImpl, { op: 'rsiRunIteration', rsiProblemId: problemId })
      return result as { iterationNumber: number; reviewScore: number; reviewFeedback: string; improvedYaml: string }
    },
    async rsiGetIterations(problemId) {
      const result = await callOp(fetchImpl, { op: 'rsiGetIterations', rsiProblemId: problemId })
      return Array.isArray(result) ? result : []
    },
    async rsiDeleteProblem(problemId) {
      const result = await callOp(fetchImpl, { op: 'rsiDeleteProblem', rsiProblemId: problemId })
      return isObject(result) ? result as { ok: boolean } : { ok: false }
    },
  }
}

export const desktopWorkflowPaths = { workflow: WORKFLOW_PATH } as const
