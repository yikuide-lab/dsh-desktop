#!/usr/bin/env node
/**
 * awf-node — headless AWF platform node runner.
 *
 *   awf-node serve --platform <baseUrl> [--token-env NAME] [--concurrency N]
 *                  [--labels k=v,...] [--state-dir DIR] [--claim-wait-sec N]
 *   awf-node login    --platform <baseUrl> --email <email> [--password <pw>]
 *   awf-node register --platform <baseUrl> --email <email> [--password <pw>] [--display-name <name>]
 *   awf-node status [--state-dir DIR]
 *
 * Env fallbacks: AWF_PLATFORM_URL (--platform), AWF_NODE_STATE_DIR
 * (--state-dir), AWF_NODE_PASSWORD (--password), AWF_API_TOKEN (default
 * --token-env), AWF_NODE_LLM_BASE_URL / AWF_NODE_LLM_API_KEY /
 * AWF_NODE_LLM_MODEL (llm/task step endpoint).
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { serve, workflowStateDir } from './serve.js';
import { awfAuthLogin, awfAuthRegister, awfAuthStatus } from './awf/auth.js';
import { readAwfSettings, writeAwfSettings, normalizeAwfBaseUrl } from './awf/settings.js';
import { awfExecutorCredentialsPath } from './awf/executor.js';
import { readFile } from 'node:fs/promises';
export class CliUsageError extends Error {
}
const PASSWORD_ENV = 'AWF_NODE_PASSWORD';
export function parseLabels(raw) {
    const labels = {};
    for (const entry of raw.split(',')) {
        const trimmed = entry.trim();
        if (!trimmed)
            continue;
        const eq = trimmed.indexOf('=');
        if (eq <= 0)
            throw new CliUsageError(`invalid --labels entry "${trimmed}" (want k=v)`);
        labels[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
    return labels;
}
export function parseConcurrency(raw) {
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1 || value > 32) {
        throw new CliUsageError(`invalid --concurrency "${raw}" (want integer 1..32)`);
    }
    return value;
}
export function parseClaimWaitSec(raw) {
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0 || value > 30) {
        throw new CliUsageError(`invalid --claim-wait-sec "${raw}" (want integer 0..30)`);
    }
    return value;
}
function defaultStateDir(env) {
    const fromEnv = env.AWF_NODE_STATE_DIR?.trim();
    return fromEnv || join(homedir(), '.awf-node');
}
/** Parse argv (already stripped of node/script). Throws CliUsageError. */
export function parseCliArgs(argv, env = process.env) {
    const [command, ...rest] = argv;
    if (!command || command === 'help' || command === '--help' || command === '-h') {
        return { command: 'help' };
    }
    if (command !== 'serve' && command !== 'login' && command !== 'register' && command !== 'status' && command !== 'tunnel') {
        throw new CliUsageError(`unknown command "${command}"`);
    }
    const flags = new Map();
    for (let i = 0; i < rest.length; i += 1) {
        const arg = rest[i];
        if (!arg.startsWith('--'))
            throw new CliUsageError(`unexpected argument "${arg}"`);
        const eq = arg.indexOf('=');
        if (eq >= 0) {
            flags.set(arg.slice(2, eq), arg.slice(eq + 1));
        }
        else {
            const next = rest[i + 1];
            if (next === undefined || next.startsWith('--')) {
                throw new CliUsageError(`flag "${arg}" needs a value`);
            }
            flags.set(arg.slice(2), next);
            i += 1;
        }
    }
    const stateDir = flags.get('state-dir') ?? defaultStateDir(env);
    const platform = (flags.get('platform') ?? env.AWF_PLATFORM_URL?.trim()) || undefined;
    if (platform !== undefined) {
        let valid = false;
        try {
            const url = new URL(platform);
            valid = url.protocol === 'http:' || url.protocol === 'https:';
        }
        catch {
            valid = false;
        }
        if (!valid)
            throw new CliUsageError(`invalid --platform "${platform}" (want http(s) URL)`);
    }
    if (command === 'status')
        return { command, stateDir };
    if (command === 'serve') {
        const labels = flags.get('labels');
        return {
            command,
            stateDir,
            ...(platform !== undefined ? { platform } : {}),
            ...(flags.has('token-env') ? { tokenEnv: flags.get('token-env') } : {}),
            ...(flags.has('concurrency') ? { concurrency: parseConcurrency(flags.get('concurrency')) } : {}),
            ...(labels !== undefined ? { labels: parseLabels(labels) } : {}),
            ...(flags.has('claim-wait-sec') ? { claimWaitSec: parseClaimWaitSec(flags.get('claim-wait-sec')) } : {}),
        };
    }
    if (command === 'tunnel') {
        return {
            command,
            stateDir,
            ...(platform !== undefined ? { platform } : {}),
            ...(flags.has('port') ? { port: Number(flags.get('port')) } : {}),
            ...(flags.has('target') ? { target: flags.get('target') } : {}),
        };
    }
    // login / register
    const email = flags.get('email')?.trim() ?? '';
    if (!email)
        throw new CliUsageError(`awf-node ${command} needs --email`);
    const password = flags.get('password') ?? env[PASSWORD_ENV] ?? '';
    if (!password) {
        throw new CliUsageError(`awf-node ${command} needs --password or env ${PASSWORD_ENV}`);
    }
    const displayName = flags.get('display-name')?.trim();
    return {
        command,
        stateDir,
        ...(platform !== undefined ? { platform } : {}),
        email,
        password,
        ...(command === 'register' && displayName ? { displayName } : {}),
    };
}
export const CLI_USAGE = `awf-node — headless AWF platform node runner

Usage:
  awf-node serve --platform <baseUrl> [--token-env NAME] [--concurrency N]
                 [--labels k=v,...] [--state-dir DIR] [--claim-wait-sec N]
  awf-node tunnel --platform <baseUrl> [--port N] [--target URL] [--state-dir DIR]
  awf-node login    --platform <baseUrl> --email <email> [--password <pw>]
  awf-node register --platform <baseUrl> --email <email> [--password <pw>] [--display-name <name>]
  awf-node status [--state-dir DIR]

Environment:
  AWF_PLATFORM_URL        default for --platform
  AWF_NODE_STATE_DIR      default for --state-dir (fallback: ~/.awf-node)
  AWF_API_TOKEN           platform user token (or the env var named by --token-env)
  AWF_NODE_PASSWORD       default for --password
  AWF_NODE_LLM_BASE_URL   OpenAI-compatible endpoint for llm/task steps
  AWF_NODE_LLM_API_KEY    Bearer key for that endpoint (optional)
  AWF_NODE_LLM_MODEL      default model for llm/task steps
  AWF_NODE_TUNNEL_TARGET  default local target for tunnel (default: http://127.0.0.1:8788)
`;
async function runAuth(command) {
    const wfStateDir = workflowStateDir(command.stateDir);
    if (command.platform) {
        const settings = await readAwfSettings(wfStateDir);
        await writeAwfSettings(wfStateDir, { ...settings, baseUrl: normalizeAwfBaseUrl(command.platform) });
    }
    const authOptions = { stateDir: wfStateDir };
    const status = command.command === 'register'
        ? await awfAuthRegister(authOptions, {
            email: command.email,
            password: command.password,
            ...(command.displayName ? { displayName: command.displayName } : {}),
        })
        : await awfAuthLogin(authOptions, { email: command.email, password: command.password });
    console.log(`awf-node ${command.command}: signed in as ${status.email ?? '?'} (session ${status.tokenFingerprint ?? ''})`);
}
async function runStatus(command) {
    const wfStateDir = workflowStateDir(command.stateDir);
    const settings = await readAwfSettings(wfStateDir);
    const session = await awfAuthStatus({ stateDir: wfStateDir });
    let executor = null;
    try {
        executor = JSON.parse(await readFile(awfExecutorCredentialsPath(wfStateDir), 'utf8'));
    }
    catch {
        executor = null;
    }
    console.log(`platform:  ${settings.baseUrl}`);
    console.log(`token env: ${settings.apiTokenEnv} (${process.env[settings.apiTokenEnv] ? 'set' : 'unset'})`);
    console.log(`session:   ${session.hasSession ? `${session.email ?? '?'} (${session.tokenFingerprint ?? ''})` : 'none'}`);
    console.log(`executor:  ${typeof executor?.executorId === 'number' ? `#${executor.executorId}` : 'not registered'}`);
}
async function runTunnel(command) {
    const { createTunnelClient } = await import('./tunnel.js');
    const wfStateDir = workflowStateDir(command.stateDir);
    if (command.platform) {
        const settings = await readAwfSettings(wfStateDir);
        await writeAwfSettings(wfStateDir, { ...settings, baseUrl: normalizeAwfBaseUrl(command.platform) });
    }
    if (command.target) {
        process.env.AWF_NODE_TUNNEL_TARGET = command.target;
    }
    const tunnel = createTunnelClient({
        stateDir: wfStateDir,
        localPort: command.port,
        log: (msg) => console.log(`[tunnel] ${msg}`),
    });
    console.log(`[awf-node] starting tunnel on :${command.port ?? 8787}`);
    await tunnel.start();
    // Wait for shutdown signals
    let stopping = false;
    const shutdown = (signal) => {
        if (stopping)
            return;
        stopping = true;
        console.log(`[awf-node] ${signal} received; shutting down tunnel`);
        void tunnel.stop().then(() => {
            process.exitCode = 0;
        });
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}
export async function main() {
    let command;
    try {
        command = parseCliArgs(process.argv.slice(2));
    }
    catch (error) {
        if (error instanceof CliUsageError) {
            console.error(`awf-node: ${error.message}\n\n${CLI_USAGE}`);
            process.exitCode = 2;
            return;
        }
        throw error;
    }
    switch (command.command) {
        case 'help':
            process.stdout.write(CLI_USAGE);
            return;
        case 'serve': {
            const handle = await serve({
                stateDir: command.stateDir,
                ...(command.platform !== undefined ? { platform: command.platform } : {}),
                ...(command.tokenEnv !== undefined ? { tokenEnv: command.tokenEnv } : {}),
                ...(command.concurrency !== undefined ? { concurrency: command.concurrency } : {}),
                ...(command.labels !== undefined ? { labels: command.labels } : {}),
                ...(command.claimWaitSec !== undefined ? { claimWaitSec: command.claimWaitSec } : {}),
            });
            let stopping = false;
            const shutdown = (signal) => {
                if (stopping)
                    return;
                stopping = true;
                console.log(`[awf-node] ${signal} received; shutting down`);
                void handle.stop().then(() => {
                    process.exitCode = 0;
                });
            };
            process.on('SIGTERM', () => shutdown('SIGTERM'));
            process.on('SIGINT', () => shutdown('SIGINT'));
            return;
        }
        case 'tunnel':
            await runTunnel(command);
            return;
        case 'login':
        case 'register':
            await runAuth(command);
            return;
        case 'status':
            await runStatus(command);
            return;
    }
}
//# sourceMappingURL=cli.js.map