/**
 * Persisted settings for the optional AWF platform connector.
 *
 * Canonical pure-Node home of the AWF settings module (shared by the desktop
 * plugins and the headless awf-node runner). 0600 JSON beside the state dir,
 * raw tokens never echoed to callers (fingerprint only). Token resolution
 * prefers the configured environment variable; an explicitly saved token is
 * the fallback. No credential literals live in source, examples, or tests.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
export const AWF_DEFAULT_BASE_URL = 'http://127.0.0.1:8000';
export const AWF_DEFAULT_TOKEN_ENV = 'AWF_API_TOKEN';
export function defaultAwfSettings() {
    return {
        baseUrl: AWF_DEFAULT_BASE_URL,
        apiTokenEnv: AWF_DEFAULT_TOKEN_ENV,
        apiToken: '',
        telemetryEnabled: false,
        executorEnabled: false,
        tunnelEnabled: false,
        tunnelLocalPort: 8787,
    };
}
export function awfSettingsPath(stateDir) {
    return join(stateDir, '..', 'awf.json');
}
export function normalizeAwfBaseUrl(raw) {
    if (typeof raw !== 'string' || !raw.trim())
        return AWF_DEFAULT_BASE_URL;
    let url;
    try {
        url = new URL(raw.trim());
    }
    catch {
        return AWF_DEFAULT_BASE_URL;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
        return AWF_DEFAULT_BASE_URL;
    return raw.trim().replace(/\/+$/, '');
}
export function normalizeAwfSettings(raw) {
    const defaults = defaultAwfSettings();
    if (!raw || typeof raw !== 'object')
        return defaults;
    const apiTokenEnv = typeof raw.apiTokenEnv === 'string' && /^[A-Z_][A-Z0-9_]*$/.test(raw.apiTokenEnv.trim())
        ? raw.apiTokenEnv.trim()
        : defaults.apiTokenEnv;
    return {
        baseUrl: normalizeAwfBaseUrl(raw.baseUrl),
        apiTokenEnv,
        apiToken: typeof raw.apiToken === 'string' ? raw.apiToken : '',
        telemetryEnabled: raw.telemetryEnabled === true,
        executorEnabled: raw.executorEnabled === true,
        tunnelEnabled: raw.tunnelEnabled === true,
        tunnelLocalPort: typeof raw.tunnelLocalPort === 'number' ? raw.tunnelLocalPort : defaults.tunnelLocalPort,
    };
}
export function tokenFingerprint(token) {
    const t = token.trim();
    if (!t)
        return '';
    if (t.length <= 8)
        return `${t.slice(0, 2)}…`;
    return `${t.slice(0, 4)}…${t.slice(-4)}`;
}
/** Env var wins over an explicitly saved token. */
export function resolveAwfToken(settings, env = process.env) {
    const fromEnv = env[settings.apiTokenEnv];
    if (fromEnv && fromEnv.trim())
        return fromEnv.trim();
    return settings.apiToken.trim();
}
export function toPublicAwfSettings(settings, token) {
    return {
        baseUrl: settings.baseUrl,
        apiTokenEnv: settings.apiTokenEnv,
        hasToken: token.length > 0,
        tokenFingerprint: tokenFingerprint(token),
        telemetryEnabled: settings.telemetryEnabled,
        executorEnabled: settings.executorEnabled,
        tunnelEnabled: settings.tunnelEnabled,
    };
}
export async function readAwfSettings(stateDir) {
    try {
        const raw = await readFile(awfSettingsPath(stateDir), 'utf8');
        return normalizeAwfSettings(JSON.parse(raw));
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return defaultAwfSettings();
        }
        throw error;
    }
}
export async function writeAwfSettings(stateDir, settings) {
    const normalized = normalizeAwfSettings(settings);
    const path = awfSettingsPath(stateDir);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    return normalized;
}
//# sourceMappingURL=settings.js.map