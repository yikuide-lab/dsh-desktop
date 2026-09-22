/**
 * Default and script-capable workflow executors.
 */
import { spawn } from 'node:child_process';
import { DispatchStatus, StepType } from './models.js';
import { resolveScriptCwd } from './script-policy.js';
/** Create an executor that runs script steps in a shell and optional Host hooks. */
export function createDesktopExecutor(options = {}) {
    const jobs = new Map();
    const shell = options.shell ?? (process.platform === 'win32' ? 'cmd.exe' : '/bin/bash');
    const useShellFlag = process.platform === 'win32' ? '/c' : '-c';
    const hooks = options.hooks ?? {};
    const scriptPolicy = options.scriptPolicy ?? 'allow';
    return {
        async submit(dispatchId, step, context) {
            const startedAt = new Date().toISOString();
            const controller = new AbortController();
            jobs.set(dispatchId, {
                stepId: step.id,
                status: DispatchStatus.Running,
                startedAt,
                controller,
            });
            const requestedCwd = (context.env?.WORKSPACE_ROOT)
                ?? (typeof context.env?.cwd === 'string' ? context.env.cwd : undefined)
                ?? options.cwd
                ?? process.cwd();
            const workspaceRoot = typeof context.env?.WORKSPACE_ROOT === 'string'
                ? context.env.WORKSPACE_ROOT
                : undefined;
            void Promise.resolve()
                .then(() => {
                const cwd = step.type === StepType.Script
                    ? resolveScriptCwd(scriptPolicy, requestedCwd, workspaceRoot)
                    : requestedCwd;
                return runStep(step, context, cwd, shell, useShellFlag, hooks, controller.signal);
            })
                .then((outcome) => {
                const job = jobs.get(dispatchId);
                if (!job || job.status !== DispatchStatus.Running)
                    return;
                jobs.set(dispatchId, {
                    ...job,
                    status: outcome.ok ? DispatchStatus.Succeeded : DispatchStatus.Failed,
                    result: outcome.output,
                    error: outcome.error,
                    completedAt: new Date().toISOString(),
                });
            })
                .catch((error) => {
                const job = jobs.get(dispatchId);
                if (!job || job.status !== DispatchStatus.Running)
                    return;
                jobs.set(dispatchId, {
                    ...job,
                    status: DispatchStatus.Failed,
                    error: error instanceof Error ? error.message : String(error),
                    completedAt: new Date().toISOString(),
                });
            });
        },
        async poll(dispatchId) {
            const job = jobs.get(dispatchId);
            if (!job) {
                return {
                    id: dispatchId,
                    stepId: '',
                    status: DispatchStatus.Failed,
                    attempt: 1,
                    error: `Unknown dispatch: ${dispatchId}`,
                };
            }
            return {
                id: dispatchId,
                stepId: job.stepId,
                status: job.status,
                attempt: 1,
                startedAt: job.startedAt,
                completedAt: job.completedAt,
                result: job.result,
                error: job.error,
            };
        },
        async abort(dispatchId) {
            const job = jobs.get(dispatchId);
            if (!job || job.status !== DispatchStatus.Running)
                return;
            job.controller.abort();
            jobs.set(dispatchId, {
                ...job,
                status: DispatchStatus.Failed,
                error: 'aborted',
                completedAt: new Date().toISOString(),
            });
        },
    };
}
async function runStep(step, context, cwd, shell, useShellFlag, hooks, signal) {
    if (signal.aborted)
        return { ok: false, error: 'aborted' };
    switch (step.type) {
        case StepType.Script: {
            if (!step.run)
                return { ok: false, error: 'Script step missing run' };
            return runShellCommand(step.run, {
                cwd,
                env: { ...process.env, ...context.env, ...step.env },
                timeoutMs: (step.timeout ?? 600) * 1000,
                shell,
                useShellFlag,
                signal,
            });
        }
        case StepType.Task: {
            if (hooks.runTask)
                return hooks.runTask(step, context, cwd, signal);
            return {
                ok: false,
                error: 'Task steps require a Host-bound agent executor (llm/agents services).',
            };
        }
        case StepType.LLM: {
            if (hooks.runLlm)
                return hooks.runLlm(step, context, cwd, signal);
            return {
                ok: false,
                error: 'LLM steps require a Host-bound model executor (llm service).',
            };
        }
        case StepType.SubWorkflow:
            if (hooks.runSubWorkflow)
                return hooks.runSubWorkflow(step, context, signal);
            return {
                ok: false,
                error: `Sub-workflow "${step.ref ?? ''}" requires a nested-run executor hook.`,
            };
        case StepType.Approval:
            return { ok: true, output: { skipped: true } };
        default:
            return { ok: false, error: `Unsupported step type: ${String(step.type)}` };
    }
}
function runShellCommand(command, opts) {
    return new Promise((resolve) => {
        if (opts.signal.aborted) {
            resolve({ ok: false, error: 'aborted' });
            return;
        }
        const child = spawn(opts.shell, [opts.useShellFlag, command], {
            cwd: opts.cwd,
            env: opts.env,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        let settled = false;
        const settle = (outcome) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            opts.signal.removeEventListener('abort', onAbort);
            resolve(outcome);
        };
        const onAbort = () => {
            child.kill('SIGTERM');
            settle({ ok: false, error: 'aborted', output: { stdout, stderr } });
        };
        opts.signal.addEventListener('abort', onAbort, { once: true });
        const timer = setTimeout(() => {
            child.kill('SIGTERM');
            settle({ ok: false, error: `Timed out after ${opts.timeoutMs}ms`, output: { stdout, stderr } });
        }, opts.timeoutMs);
        child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
        child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
        child.on('error', (error) => {
            settle({ ok: false, error: error.message, output: { stdout, stderr } });
        });
        child.on('close', (code) => {
            const output = { stdout: stdout.slice(0, 32_000), stderr: stderr.slice(0, 32_000), exitCode: code };
            if (code === 0)
                settle({ ok: true, output });
            else
                settle({ ok: false, error: `Exit code ${code}`, output });
        });
    });
}
//# sourceMappingURL=executor.js.map