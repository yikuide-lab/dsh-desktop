/** Collab Loop JSON persistence under $DSH_HOME/collab */

import {
  mkdir,
  readFile,
  writeFile,
  chmod,
  open,
  rename,
} from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomBytes } from 'node:crypto'
import type {
  BranchRecord,
  CollabLoop,
  CollabVision,
  HealPlan,
  LoopAdmin,
  LoopRoster,
  TaskPlan,
} from './types.js'
import {
  resolveCollabRoot,
  resolveGlobalSecretPath,
  resolveLoopDir,
  resolveLoopFile,
} from './paths.js'

const PRIVATE_MODE = 0o600
const DIR_MODE = 0o700

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: DIR_MODE })
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf-8',
    mode: PRIVATE_MODE,
  })
  await rename(tmp, path)
  try {
    await chmod(path, PRIVATE_MODE)
  } catch {
    // best-effort on platforms that ignore mode
  }
}

async function readJsonFile<T>(path: string): Promise<T> {
  const raw = await readFile(path, 'utf-8')
  return JSON.parse(raw) as T
}

export async function ensureCollabRoot(): Promise<string> {
  const root = resolveCollabRoot()
  await mkdir(root, { recursive: true, mode: DIR_MODE })
  return root
}

export async function ensureSecret(): Promise<Buffer> {
  await ensureCollabRoot()
  const secretPath = resolveGlobalSecretPath()
  try {
    const existing = await readFile(secretPath)
    return existing
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  const secret = randomBytes(32)
  await mkdir(dirname(secretPath), { recursive: true, mode: DIR_MODE })
  const handle = await open(secretPath, 'wx', PRIVATE_MODE)
  try {
    await handle.writeFile(secret)
  } finally {
    await handle.close()
  }
  return secret
}

export async function createLoopDir(loopId: string): Promise<string> {
  const loopDir = resolveLoopDir(loopId)
  await mkdir(loopDir, { recursive: true, mode: DIR_MODE })
  await mkdir(resolveLoopFile(loopId, 'branches'), { recursive: true, mode: DIR_MODE })
  await mkdir(resolveLoopFile(loopId, 'heal'), { recursive: true, mode: DIR_MODE })
  await mkdir(resolveLoopFile(loopId, 'plan'), { recursive: true, mode: DIR_MODE })
  return loopDir
}

export async function writeLoopJson(loopId: string, loop: CollabLoop): Promise<void> {
  await writeJsonAtomic(resolveLoopFile(loopId, 'loop.json'), loop)
}

export async function readLoopJson(loopId: string): Promise<CollabLoop> {
  return readJsonFile<CollabLoop>(resolveLoopFile(loopId, 'loop.json'))
}

export async function writeAdminJson(loopId: string, admin: LoopAdmin): Promise<void> {
  await writeJsonAtomic(resolveLoopFile(loopId, 'admin.json'), admin)
}

export async function readAdminJson(loopId: string): Promise<LoopAdmin> {
  return readJsonFile<LoopAdmin>(resolveLoopFile(loopId, 'admin.json'))
}

export async function writeRosterJson(loopId: string, roster: LoopRoster): Promise<void> {
  await writeJsonAtomic(resolveLoopFile(loopId, 'roster.json'), roster)
}

export async function readRosterJson(loopId: string): Promise<LoopRoster> {
  return readJsonFile<LoopRoster>(resolveLoopFile(loopId, 'roster.json'))
}

export async function writeVisionJson(loopId: string, vision: CollabVision): Promise<void> {
  await writeJsonAtomic(resolveLoopFile(loopId, 'vision.json'), vision)
}

export async function readVisionJson(loopId: string): Promise<CollabVision> {
  return readJsonFile<CollabVision>(resolveLoopFile(loopId, 'vision.json'))
}

export async function writeBranchesIndex(loopId: string, branches: BranchRecord[]): Promise<void> {
  await writeJsonAtomic(resolveLoopFile(loopId, 'branches', 'index.json'), branches)
}

export async function readBranchesIndex(loopId: string): Promise<BranchRecord[]> {
  return readJsonFile<BranchRecord[]>(resolveLoopFile(loopId, 'branches', 'index.json'))
}

export async function writeBranchYaml(
  loopId: string,
  branchId: string,
  yaml: string,
): Promise<string> {
  const path = resolveLoopFile(loopId, 'branches', `${branchId}.yaml`)
  await mkdir(dirname(path), { recursive: true, mode: DIR_MODE })
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, yaml.endsWith('\n') ? yaml : `${yaml}\n`, {
    encoding: 'utf-8',
    mode: PRIVATE_MODE,
  })
  await rename(tmp, path)
  try {
    await chmod(path, PRIVATE_MODE)
  } catch {
    // best-effort on platforms that ignore mode
  }
  return path
}

export async function writeHealPending(loopId: string, plan: HealPlan | null): Promise<void> {
  await writeJsonAtomic(resolveLoopFile(loopId, 'heal', 'pending.json'), plan)
}

export async function readHealPending(loopId: string): Promise<HealPlan | null> {
  return readJsonFile<HealPlan | null>(resolveLoopFile(loopId, 'heal', 'pending.json'))
}

export async function writePlanLatest(loopId: string, plan: TaskPlan): Promise<void> {
  await writeJsonAtomic(resolveLoopFile(loopId, 'plan', 'latest.json'), plan)
}

export async function readPlanLatest(loopId: string): Promise<TaskPlan> {
  return readJsonFile<TaskPlan>(resolveLoopFile(loopId, 'plan', 'latest.json'))
}
