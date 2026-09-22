import { describe, expect, it, afterEach } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDesktopExecutor } from '../src/engine/executor.ts'
import { StepType, type ExecutionContext, type Step, type Workflow } from '../src/engine/models.ts'

const POSIX = process.platform !== 'win32'

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function readPid(path: string, deadlineMs = 5_000): Promise<number> {
  const deadline = Date.now() + deadlineMs
  while (Date.now() < deadline) {
    try {
      const pid = Number((await readFile(path, 'utf8')).trim())
      if (Number.isInteger(pid) && pid > 0) return pid
    } catch {
      // not written yet
    }
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`pid file not written: ${path}`)
}

/** Poll until the pid is gone (avoids fixed sleeps racing the SIGKILL timer). */
async function waitDead(pid: number, deadlineMs = 8_000): Promise<void> {
  const deadline = Date.now() + deadlineMs
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`pid ${pid} still alive after ${deadlineMs}ms`)
}

function workflowWith(step: Step): Workflow {
  return {
    apiVersion: 'workflow-wise/v1',
    kind: 'Workflow',
    metadata: { name: 'abort-escalation' },
    spec: { steps: [step] },
  }
}

describe('executor abort escalation', () => {
  let dir: string | undefined

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
    dir = undefined
  })

  it.skipIf(!POSIX)('SIGKILLs a SIGTERM-ignoring shell after abort', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-wf-abort-'))
    const pidFile = join(dir, 'shell.pid')
    const executor = createDesktopExecutor({ cwd: dir })
    const step: Step = {
      id: 'stubborn',
      type: StepType.Script,
      run: `trap '' TERM; echo $$ > ${pidFile}; while true; do sleep 0.1; done`,
    }
    const context: ExecutionContext = {
      runId: 'run-abort',
      workflow: workflowWith(step),
      stateDir: dir,
    }

    await executor.submit('d-abort', step, context)
    const pid = await readPid(pidFile)
    expect(isAlive(pid)).toBe(true)

    await executor.abort('d-abort')
    // SIGKILL escalation fires 2s after SIGTERM; poll instead of sleeping a
    // fixed amount so slow machines do not race the timer.
    await waitDead(pid)
  }, 15_000)

  it.skipIf(!POSIX)('kills grandchildren via the spawned process group', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-wf-abort-pg-'))
    const grandPidFile = join(dir, 'grand.pid')
    const executor = createDesktopExecutor({ cwd: dir })
    // Backgrounded sleep shares bash's process group; a plain child.kill would orphan it.
    const step: Step = {
      id: 'grandchild',
      type: StepType.Script,
      run: `sleep 30 & echo $! > ${grandPidFile}; wait`,
    }
    const context: ExecutionContext = {
      runId: 'run-grand',
      workflow: workflowWith(step),
      stateDir: dir,
    }

    await executor.submit('d-grand', step, context)
    const grandPid = await readPid(grandPidFile)
    expect(isAlive(grandPid)).toBe(true)

    await executor.abort('d-grand')
    await waitDead(grandPid, 3_000)
  }, 15_000)
})
