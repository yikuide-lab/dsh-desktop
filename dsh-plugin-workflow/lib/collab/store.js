/** Collab Loop JSON persistence under $DSH_HOME/collab */
import { mkdir, readFile, writeFile, chmod, open, rename, } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { resolveCollabRoot, resolveGlobalSecretPath, resolveLoopDir, resolveLoopFile, } from './paths.js';
const PRIVATE_MODE = 0o600;
const DIR_MODE = 0o700;
async function writeJsonAtomic(path, value) {
    await mkdir(dirname(path), { recursive: true, mode: DIR_MODE });
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, {
        encoding: 'utf-8',
        mode: PRIVATE_MODE,
    });
    await rename(tmp, path);
    try {
        await chmod(path, PRIVATE_MODE);
    }
    catch {
        // best-effort on platforms that ignore mode
    }
}
async function readJsonFile(path) {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw);
}
export async function ensureCollabRoot() {
    const root = resolveCollabRoot();
    await mkdir(root, { recursive: true, mode: DIR_MODE });
    return root;
}
export async function ensureSecret() {
    await ensureCollabRoot();
    const secretPath = resolveGlobalSecretPath();
    try {
        const existing = await readFile(secretPath);
        return existing;
    }
    catch (err) {
        if (err.code !== 'ENOENT')
            throw err;
    }
    const secret = randomBytes(32);
    await mkdir(dirname(secretPath), { recursive: true, mode: DIR_MODE });
    const handle = await open(secretPath, 'wx', PRIVATE_MODE);
    try {
        await handle.writeFile(secret);
    }
    finally {
        await handle.close();
    }
    return secret;
}
export async function createLoopDir(loopId) {
    const loopDir = resolveLoopDir(loopId);
    await mkdir(loopDir, { recursive: true, mode: DIR_MODE });
    await mkdir(resolveLoopFile(loopId, 'branches'), { recursive: true, mode: DIR_MODE });
    await mkdir(resolveLoopFile(loopId, 'heal'), { recursive: true, mode: DIR_MODE });
    await mkdir(resolveLoopFile(loopId, 'plan'), { recursive: true, mode: DIR_MODE });
    return loopDir;
}
export async function writeLoopJson(loopId, loop) {
    await writeJsonAtomic(resolveLoopFile(loopId, 'loop.json'), loop);
}
export async function readLoopJson(loopId) {
    return readJsonFile(resolveLoopFile(loopId, 'loop.json'));
}
export async function writeAdminJson(loopId, admin) {
    await writeJsonAtomic(resolveLoopFile(loopId, 'admin.json'), admin);
}
export async function readAdminJson(loopId) {
    return readJsonFile(resolveLoopFile(loopId, 'admin.json'));
}
export async function writeRosterJson(loopId, roster) {
    await writeJsonAtomic(resolveLoopFile(loopId, 'roster.json'), roster);
}
export async function readRosterJson(loopId) {
    return readJsonFile(resolveLoopFile(loopId, 'roster.json'));
}
export async function writeVisionJson(loopId, vision) {
    await writeJsonAtomic(resolveLoopFile(loopId, 'vision.json'), vision);
}
export async function readVisionJson(loopId) {
    return readJsonFile(resolveLoopFile(loopId, 'vision.json'));
}
export async function writeBranchesIndex(loopId, branches) {
    await writeJsonAtomic(resolveLoopFile(loopId, 'branches', 'index.json'), branches);
}
export async function readBranchesIndex(loopId) {
    return readJsonFile(resolveLoopFile(loopId, 'branches', 'index.json'));
}
export async function writeBranchYaml(loopId, branchId, yaml) {
    const path = resolveLoopFile(loopId, 'branches', `${branchId}.yaml`);
    await mkdir(dirname(path), { recursive: true, mode: DIR_MODE });
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, yaml.endsWith('\n') ? yaml : `${yaml}\n`, {
        encoding: 'utf-8',
        mode: PRIVATE_MODE,
    });
    await rename(tmp, path);
    try {
        await chmod(path, PRIVATE_MODE);
    }
    catch {
        // best-effort on platforms that ignore mode
    }
    return path;
}
export async function writeHealPending(loopId, plan) {
    await writeJsonAtomic(resolveLoopFile(loopId, 'heal', 'pending.json'), plan);
}
export async function readHealPending(loopId) {
    return readJsonFile(resolveLoopFile(loopId, 'heal', 'pending.json'));
}
export async function writePlanLatest(loopId, plan) {
    await writeJsonAtomic(resolveLoopFile(loopId, 'plan', 'latest.json'), plan);
}
export async function readPlanLatest(loopId) {
    return readJsonFile(resolveLoopFile(loopId, 'plan', 'latest.json'));
}
//# sourceMappingURL=store.js.map