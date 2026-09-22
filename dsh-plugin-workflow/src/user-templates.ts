/**
 * User-saved workflow templates persisted under stateDir/user-templates.
 */

import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { WorkflowTemplateDefinition } from './templates.js'

export interface UserTemplateRecord extends WorkflowTemplateDefinition {
  readonly builtin: false
  readonly updatedAt: string
  readonly sourceWorkflowName?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function sanitizeTemplateId(raw: string): string {
  const cleaned = raw.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned || `template-${Date.now().toString(36)}`
}

export function userTemplatesDir(stateDir: string): string {
  return join(stateDir, 'user-templates')
}

function templatePath(stateDir: string, id: string): string {
  return join(userTemplatesDir(stateDir), `${id}.json`)
}

export async function loadUserTemplates(stateDir: string): Promise<UserTemplateRecord[]> {
  const dir = userTemplatesDir(stateDir)
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }

  const out: UserTemplateRecord[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    try {
      const raw = JSON.parse(await readFile(join(dir, entry), 'utf8')) as unknown
      const parsed = normalizeUserTemplate(raw)
      if (parsed) out.push(parsed)
    } catch {
      // Skip corrupt files; listTemplates must stay resilient.
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

export function normalizeUserTemplate(raw: unknown): UserTemplateRecord | null {
  if (!isRecord(raw)) return null
  const id = typeof raw.id === 'string' ? sanitizeTemplateId(raw.id) : ''
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  const yaml = typeof raw.yaml === 'string' ? raw.yaml : ''
  if (!id || !name || !yaml.trim()) return null
  const category = raw.category === 'development'
    || raw.category === 'devops'
    || raw.category === 'analysis'
    || raw.category === 'custom'
    ? raw.category
    : 'custom'
  return {
    id,
    name,
    description: typeof raw.description === 'string' ? raw.description : '',
    category,
    yaml,
    builtin: false,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
    ...(typeof raw.sourceWorkflowName === 'string' && raw.sourceWorkflowName.trim()
      ? { sourceWorkflowName: raw.sourceWorkflowName.trim() }
      : {}),
  }
}

export async function writeUserTemplate(
  stateDir: string,
  template: UserTemplateRecord,
): Promise<UserTemplateRecord> {
  const dir = userTemplatesDir(stateDir)
  await mkdir(dir, { recursive: true })
  const path = templatePath(stateDir, template.id)
  const tmp = `${path}.${process.pid}.tmp`
  const payload = `${JSON.stringify(template, null, 2)}\n`
  await writeFile(tmp, payload, 'utf8')
  await rename(tmp, path)
  return template
}

export async function removeUserTemplate(stateDir: string, id: string): Promise<boolean> {
  const safeId = sanitizeTemplateId(id)
  if (!safeId || safeId.includes('/') || safeId.includes('\\') || safeId.includes('..')) {
    throw new Error(`Invalid template id: ${id}`)
  }
  try {
    await rm(templatePath(stateDir, safeId))
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export function allocateUserTemplateId(
  preferred: string,
  existingIds: readonly string[],
): string {
  const base = sanitizeTemplateId(preferred)
  const taken = new Set(existingIds)
  if (!taken.has(base)) return base
  let index = 2
  let candidate = `${base}-${index}`
  while (taken.has(candidate)) {
    index += 1
    candidate = `${base}-${index}`
  }
  return candidate
}

export type { WorkflowTemplateDefinition }
