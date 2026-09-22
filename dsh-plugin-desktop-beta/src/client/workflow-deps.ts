import type {
  WorkflowModelCatalogView,
  WorkflowSettingsView,
  WorkflowStepView,
  WorkflowView,
} from './desktop-workflow-api.js'

/** One missing or weak dependency required by a workflow. */
export interface WorkflowDependencyIssue {
  id: string
  kind: 'llm-route' | 'prompt' | 'task-agent'
  /** Human-readable summary. */
  detail: string
  /** If true, start should be blocked until resolved or user explicitly continues. */
  blocking: boolean
}

export interface WorkflowDependencyReport {
  ok: boolean
  issues: WorkflowDependencyIssue[]
}

export interface WorkflowDependencyOptions {
  prompt?: string | undefined
  requirePrompt?: boolean | undefined
  /**
   * DSH Models catalog (system providers). Distinct from workflow settings.providers
   * (bias → provider/model preferences). Either source can satisfy LLM routing.
   */
  catalog?: Pick<WorkflowModelCatalogView, 'providers'> | undefined
}

function stepNeedsLlmRoute(step: WorkflowStepView): boolean {
  return step.type === 'llm' || step.type === 'task'
}

function isProviderModelRoute(value: string | undefined): boolean {
  return typeof value === 'string' && value.includes('/')
}

function catalogHasModels(catalog: WorkflowDependencyOptions['catalog']): boolean {
  return (catalog?.providers ?? []).some((group) => group.models.length > 0)
}

function providerCoversRole(settings: WorkflowSettingsView, role: string): boolean {
  const want = role.toLowerCase()
  return settings.providers.some((provider) => (
    isProviderModelRoute(provider.model)
    && provider.bias.some((tag) => {
      const t = tag.toLowerCase()
      return t === want || want.includes(t) || t.includes(want)
    })
  ))
}

function providerCoversDefault(settings: WorkflowSettingsView): boolean {
  const want = settings.defaultBias.trim().toLowerCase() || 'coding'
  return settings.providers.some((provider) => (
    isProviderModelRoute(provider.model)
    && (
      provider.bias.length === 0
      || provider.bias.some((tag) => tag.toLowerCase() === want)
    )
  ))
}

/**
 * Inspect a workflow against LLM preference settings before start.
 * Incomplete provider/bias coverage yields issues the UI can prompt to fix.
 *
 * Routing sources (any one is enough to avoid a hard block), matching Host executor:
 * 1. workflow settings.providers (bias → provider/model)
 * 2. DSH Models catalog
 * 3. per-step model: provider/model
 * 4. soft fallback: session agentDefaultModel (warned, not blocked)
 */
export function checkWorkflowDependencies(
  workflow: Pick<WorkflowView, 'name' | 'steps'>,
  settings: WorkflowSettingsView,
  options: WorkflowDependencyOptions = {},
): WorkflowDependencyReport {
  const issues: WorkflowDependencyIssue[] = []

  if (options.requirePrompt && !(options.prompt ?? '').trim()) {
    issues.push({
      id: 'prompt',
      kind: 'prompt',
      detail: '缺少运行提示词（PROMPT）',
      blocking: true,
    })
  }

  const routed = workflow.steps.filter(stepNeedsLlmRoute)
  if (routed.length === 0) {
    return { ok: issues.length === 0, issues }
  }

  const roles = [...new Set(
    routed
      .map((step) => (typeof step.role === 'string' ? step.role.trim() : ''))
      .filter(Boolean),
  )]

  const hasWorkflowPrefs = settings.providers.some((p) => isProviderModelRoute(p.model))
  const hasCatalog = catalogHasModels(options.catalog)
  const hasStepModels = routed.some((step) => isProviderModelRoute(step.model))
  const hasAnyRoute = hasWorkflowPrefs || hasCatalog || hasStepModels

  if (!hasAnyRoute) {
    const onlyRouted = workflow.steps.every(
      (step) => step.type === 'llm' || step.type === 'task' || step.type === 'approval',
    )
    // Host executor can still fall back to the session default model — warn, do not hard-block.
    issues.push({
      id: 'providers-empty',
      kind: 'llm-route',
      detail: onlyRouted
        ? '未配置工作流 LLM 路由偏好（工作流设置 → Providers，格式 provider/model），也未在 DSH Models 中发现可用模型；将尝试会话默认模型（若也没有则会失败）。可在「工作流 → 设置」从已配置模型添加路由，或给步骤指定 model'
        : '未配置工作流 LLM 路由偏好；LLM/task 步骤将回退到会话默认模型（若也没有则会失败）',
      blocking: false,
    })
  } else if (hasWorkflowPrefs) {
    for (const role of roles) {
      if (!providerCoversRole(settings, role)) {
        issues.push({
          id: `role:${role}`,
          kind: 'llm-route',
          detail: `角色 “${role}” 没有匹配的 provider 能力倾向（bias）；将回退默认倾向 “${settings.defaultBias || 'coding'}”${hasCatalog ? '或 DSH 默认模型' : ''}`,
          blocking: false,
        })
      }
    }
    if (roles.length === 0 && !providerCoversDefault(settings)) {
      issues.push({
        id: 'default-bias',
        kind: 'llm-route',
        detail: `默认倾向 “${settings.defaultBias || 'coding'}” 没有匹配的 provider`,
        blocking: false,
      })
    }
  } else if (hasCatalog && !hasStepModels) {
    // Catalog alone: executor still needs workflow prefs or session default for role routing.
    issues.push({
      id: 'prefs-from-catalog',
      kind: 'llm-route',
      detail: '已检测到 DSH Models，但工作流设置中尚未添加路由偏好；运行时将优先用会话默认模型。建议在「工作流 → 设置」从目录添加 provider/model，并把 bias 设为步骤 role（如 risk-control）',
      blocking: false,
    })
  }

  const taskSteps = workflow.steps.filter((step) => step.type === 'task')
  if (taskSteps.length > 0) {
    issues.push({
      id: 'task-agents',
      kind: 'task-agent',
      detail: `包含 ${taskSteps.length} 个 task 步骤，需要 Host agents 服务可用`,
      blocking: false,
    })
  }

  const explicitModels = routed
    .map((step) => step.model)
    .filter((model): model is string => typeof model === 'string' && model.length > 0)
  for (const model of explicitModels) {
    if (!isProviderModelRoute(model)) {
      issues.push({
        id: `model:${model}`,
        kind: 'llm-route',
        detail: `步骤 model “${model}” 不是 provider/model 路由；需配合工作流 Providers 或会话默认 provider`,
        blocking: false,
      })
    }
  }

  return {
    ok: issues.filter((issue) => issue.blocking).length === 0,
    issues,
  }
}

/** Format issues for a confirm/prompt dialog. */
export function formatDependencyIssues(issues: readonly WorkflowDependencyIssue[]): string {
  if (issues.length === 0) return ''
  return issues.map((issue, index) => `${index + 1}. ${issue.detail}`).join('\n')
}
