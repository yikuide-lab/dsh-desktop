import type { DesktopWorkflowApi, WorkflowSettingsView, WorkflowView } from './desktop-workflow-api.js'
import {
  checkWorkflowDependencies,
  formatDependencyIssues,
  type WorkflowDependencyReport,
} from './workflow-deps.js'

export type DependencyPromptChoice = 'open-settings' | 'continue' | 'abort'

export interface EnsureWorkflowDepsOptions {
  api: DesktopWorkflowApi
  workflow: Pick<WorkflowView, 'name' | 'steps' | 'title'>
  prompt?: string | undefined
  requirePrompt?: boolean | undefined
  /** Localized confirm body prefix. */
  incompleteTitle: string
  openSettingsLabel: string
  continueLabel: string
  /** Confirm: open settings to fix (OK) vs continue anyway (Cancel). */
  confirm: (message: string) => boolean
}

/**
 * Load settings, check workflow deps, and ask the user what to do when incomplete.
 * Returns whether the caller should proceed to start the run.
 */
export async function ensureWorkflowDependencies(
  options: EnsureWorkflowDepsOptions,
): Promise<{ proceed: boolean; report: WorkflowDependencyReport; settings: WorkflowSettingsView }> {
  const [settings, catalog] = await Promise.all([
    options.api.getSettings(),
    options.api.listModelCatalog().catch(() => ({ protocols: [] as string[], providers: [] })),
  ])
  const report = checkWorkflowDependencies(options.workflow, settings, {
    prompt: options.prompt,
    requirePrompt: options.requirePrompt,
    catalog,
  })

  const blocking = report.issues.filter((issue) => issue.blocking)
  const soft = report.issues.filter((issue) => !issue.blocking)

  if (blocking.length > 0) {
    return { proceed: false, report, settings }
  }
  if (soft.length === 0) {
    return { proceed: true, report, settings }
  }

  const message = [
    options.incompleteTitle,
    formatDependencyIssues(soft),
    '',
    `${options.openSettingsLabel} / ${options.continueLabel}`,
  ].join('\n')

  // confirm(true) → open settings; confirm(false) → continue with current config
  const openSettings = options.confirm(message)
  return {
    proceed: !openSettings,
    report,
    settings,
  }
}

/** Resolve a runnable workflow document for dependency inspection. */
export async function resolveWorkflowForDeps(
  api: DesktopWorkflowApi,
  input: {
    workflowName: string
    templateYaml?: string | undefined
    source: 'enabled' | 'saved' | 'template'
  },
): Promise<WorkflowView> {
  if (input.source === 'template' && input.templateYaml) {
    // Prefer an already-saved document with the same name so recommend/run
    // never silently overwrites user edits of a prior template materialization.
    const existing = await api.getWorkflow(input.workflowName)
    if (existing) return existing

    const saved = await api.saveWorkflow(input.templateYaml)
    if (!saved.validation.ok) {
      throw new Error(saved.validation.errors[0]?.message ?? 'workflow validation failed')
    }
    return saved.workflow
  }
  const existing = await api.getWorkflow(input.workflowName)
  if (!existing) throw new Error(`Workflow not found: ${input.workflowName}`)
  return existing
}
