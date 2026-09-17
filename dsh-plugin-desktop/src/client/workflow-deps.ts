import type { WorkflowSettingsView, WorkflowStepView, WorkflowView } from './desktop-workflow-api.js'

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

function stepNeedsLlmRoute(step: WorkflowStepView): boolean {
  return step.type === 'llm' || step.type === 'task'
}

function providerCoversRole(settings: WorkflowSettingsView, role: string): boolean {
  const want = role.toLowerCase()
  return settings.providers.some((provider) => (
    provider.model.includes('/')
    && provider.bias.some((tag) => {
      const t = tag.toLowerCase()
      return t === want || want.includes(t) || t.includes(want)
    })
  ))
}

function providerCoversDefault(settings: WorkflowSettingsView): boolean {
  const want = settings.defaultBias.trim().toLowerCase() || 'coding'
  return settings.providers.some((provider) => (
    provider.model.includes('/')
    && (
      provider.bias.length === 0
      || provider.bias.some((tag) => tag.toLowerCase() === want)
    )
  ))
}

/**
 * Inspect a workflow against LLM preference settings before start.
 * Incomplete provider/bias coverage yields issues the UI can prompt to fix.
 */
export function checkWorkflowDependencies(
  workflow: Pick<WorkflowView, 'name' | 'steps'>,
  settings: WorkflowSettingsView,
  options: { prompt?: string | undefined; requirePrompt?: boolean | undefined } = {},
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

  const hasAnyProvider = settings.providers.some((p) => p.model.includes('/'))
  if (!hasAnyProvider) {
    const onlyRouted = workflow.steps.every(
      (step) => step.type === 'llm' || step.type === 'task' || step.type === 'approval',
    )
    issues.push({
      id: 'providers-empty',
      kind: 'llm-route',
      detail: onlyRouted
        ? '未配置工作流 LLM provider/model；纯 LLM/task 工作流无法可靠启动'
        : '未配置工作流 LLM provider/model；LLM/task 步骤将回退到会话默认模型（若也没有则会失败）',
      blocking: onlyRouted,
    })
  } else {
    for (const role of roles) {
      if (!providerCoversRole(settings, role)) {
        issues.push({
          id: `role:${role}`,
          kind: 'llm-route',
          detail: `角色 “${role}” 没有匹配的 provider 能力倾向（bias）；将回退默认倾向 “${settings.defaultBias || 'coding'}”`,
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
    .filter((model): model is string => typeof model === 'string' && model.includes('/'))
  for (const model of explicitModels) {
    // Informational only — host still needs the adapter; we cannot probe adapters from the client.
    if (!model.trim()) {
      issues.push({
        id: `model:${model}`,
        kind: 'llm-route',
        detail: `步骤写死了无效 model：${model}`,
        blocking: true,
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
