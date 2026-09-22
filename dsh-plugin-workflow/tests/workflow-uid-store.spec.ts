import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readdir, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkflowStore } from '../src/engine/store.js'
import type { Workflow } from '../src/engine/models.js'

function sample(name: string, uid?: string): Workflow {
  return {
    apiVersion: 'workflow-wise/v1',
    kind: 'Workflow',
    metadata: {
      name,
      ...(uid ? { uid } : {}),
      title: name,
    },
    spec: {
      steps: [{ id: 'echo', type: 'script', run: 'echo hi' }],
    },
  }
}

describe('WorkflowStore uid-keyed persistence', () => {
  let stateDir: string
  let store: WorkflowStore

  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'wf-uid-'))
    store = new WorkflowStore(stateDir)
    await store.init()
  })

  afterEach(async () => {
    await rm(stateDir, { recursive: true, force: true })
  })

  it('allocates a uid on first save and keys the file by uid', async () => {
    const saved = await store.saveWorkflow(sample('demo'))
    expect(saved.workflow.metadata.uid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
    const files = await readdir(join(stateDir, 'workflows'))
    expect(files).toEqual([`${saved.workflow.metadata.uid}.json`])
  })

  it('renaming name keeps the same uid file (no duplicate)', async () => {
    const first = await store.saveWorkflow(sample('alpha'))
    const uid = first.workflow.metadata.uid!
    const second = await store.saveWorkflow({
      ...first.workflow,
      metadata: { ...first.workflow.metadata, name: 'beta', title: 'Beta' },
    })
    expect(second.workflow.metadata.uid).toBe(uid)
    expect(second.workflow.metadata.name).toBe('beta')
    const files = await readdir(join(stateDir, 'workflows'))
    expect(files).toEqual([`${uid}.json`])
    expect(await store.loadWorkflow('beta')).not.toBeNull()
    expect(await store.loadWorkflow(uid)).not.toBeNull()
    expect(await store.loadWorkflow('alpha')).toBeNull()
  })

  it('migrates legacy name-keyed files to uid files', async () => {
    const legacyDir = join(stateDir, 'workflows')
    await mkdir(legacyDir, { recursive: true })
    await writeFile(join(legacyDir, 'legacy.json'), JSON.stringify({
      workflow: sample('legacy'),
      status: 'approved',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }), 'utf8')

    const listed = await store.listWorkflows()
    expect(listed).toHaveLength(1)
    const uid = listed[0]!.workflow.metadata.uid
    expect(uid).toBeTruthy()
    const files = await readdir(legacyDir)
    expect(files).toEqual([`${uid}.json`])
  })

  it('rejects a second document with the same name but different uid', async () => {
    await store.saveWorkflow(sample('taken', '11111111-1111-4111-8111-111111111111'))
    await expect(
      store.saveWorkflow(sample('taken', '22222222-2222-4222-8222-222222222222')),
    ).rejects.toThrow(/already in use/)
  })

  it('reuses uid by name when yaml omits uid', async () => {
    const first = await store.saveWorkflow(sample('keep-me'))
    const uid = first.workflow.metadata.uid!
    const again = await store.saveWorkflow(sample('keep-me'))
    expect(again.workflow.metadata.uid).toBe(uid)
    const files = await readdir(join(stateDir, 'workflows'))
    expect(files).toEqual([`${uid}.json`])
  })
})
