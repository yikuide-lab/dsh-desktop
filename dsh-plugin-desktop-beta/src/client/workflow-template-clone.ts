/**
 * Clone built-in / imported workflow templates into editable drafts.
 *
 * Client-side YAML uses the `yaml` package for fast preview/clone.
 * Host save/validate always re-parses with the engine's `js-yaml` path —
 * treat Host validation as the source of truth for persistence.
 */

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { mapEngineWorkflow, type WorkflowView } from './desktop-workflow-api.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Parse workflow YAML into the flat UI view used by the visual editor. */
export function parseWorkflowYaml(yaml: string): WorkflowView {
  const doc = parseYaml(yaml)
  return mapEngineWorkflow(doc)
}

/** Allocate a unique workflow name for a template copy. */
export function allocateCloneName(baseName: string, existingNames: readonly string[] = []): string {
  const base = (baseName.trim() || 'workflow').replace(/[^a-z0-9-]/gi, '-').toLowerCase()
  const taken = new Set(existingNames)
  let name = `${base}-copy`
  let index = 2
  while (taken.has(name)) {
    name = `${base}-copy-${index}`
    index += 1
  }
  return name
}

export interface CloneTemplateResult {
  yaml: string
  name: string
  view: WorkflowView
}

/**
 * Copy a template document under a new metadata.name so the user can redesign
 * it in either YAML or the visual editor without overwriting the original.
 */
export function cloneTemplateYaml(
  sourceYaml: string,
  existingNames: readonly string[] = [],
): CloneTemplateResult {
  const doc = parseYaml(sourceYaml)
  if (!isRecord(doc)) {
    throw new Error('Workflow YAML must be a mapping')
  }
  const metadata = isRecord(doc.metadata) ? { ...doc.metadata } : {}
  const baseName = typeof metadata.name === 'string' ? metadata.name : 'workflow'
  const name = allocateCloneName(baseName, existingNames)
  metadata.name = name
  if (typeof metadata.title === 'string' && metadata.title.trim()) {
    metadata.title = `${metadata.title} (copy)`
  } else {
    metadata.title = name
  }
  doc.metadata = metadata
  const yaml = stringifyYaml(doc)
  return {
    yaml,
    name,
    view: mapEngineWorkflow(doc),
  }
}
