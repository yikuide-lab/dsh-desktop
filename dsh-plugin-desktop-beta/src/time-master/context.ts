/** Build a read-only context snapshot for AI / heuristic suggestions. */

import type { Context } from '@deepseek-ai/cordis'
import { localDateString } from './dates.js'
import { templatesForSnapshot } from './templates.js'
import type { TimeMasterContextSnapshot } from './types.js'

/** Collect Models + workflow provider hints without exposing secrets. */
export async function buildContextSnapshot(ctx: Context): Promise<TimeMasterContextSnapshot> {
  const providers: TimeMasterContextSnapshot['providers'][number][] = []
  const tokenPlanRoutes: string[] = []
  const workflowProviders: TimeMasterContextSnapshot['workflowProviders'][number][] = []

  try {
    const { listWorkflowModelCatalog } = await import('../desktop-workflow-models.ts')
    const catalog = await listWorkflowModelCatalog(ctx)
    for (const group of catalog.providers) {
      const models = group.models.map(model => model.id)
      providers.push({ id: group.id, name: group.name, models })
      if (group.id.includes('token-plan') || /token[-_]?plan/i.test(group.name)) {
        tokenPlanRoutes.push(group.id)
      }
      for (const model of models) {
        if (/token[-_]?plan/i.test(model) || /token[-_]?plan/i.test(`${group.id}/${model}`)) {
          tokenPlanRoutes.push(`${group.id}/${model}`)
        }
      }
    }
  } catch {
    // Catalog may be unavailable outside a full Host boot.
  }

  try {
    const desktopWorkflow = ctx.get('desktopWorkflow') as
      | { plugin?: { getSettingsSync?: () => { providers?: Array<{ id: string; model: string; baseURL?: string }> } } }
      | undefined
    const settings = desktopWorkflow?.plugin?.getSettingsSync?.()
    for (const entry of settings?.providers ?? []) {
      let host: string | undefined
      try {
        if (entry.baseURL) host = new URL(entry.baseURL).host
      } catch {
        host = undefined
      }
      workflowProviders.push({
        id: entry.id,
        model: entry.model,
        ...(host ? { host } : {}),
      })
    }
  } catch {
    // Workflow plugin optional.
  }

  return {
    providers,
    tokenPlanRoutes: [...new Set(tokenPlanRoutes)],
    workflowProviders,
    templates: templatesForSnapshot(),
    today: localDateString(),
  }
}
