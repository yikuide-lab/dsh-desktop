/**
 * Browser-safe `process` stub for ModuleLoader client bundles.
 * Prevents Node-only deps (e.g. yaml/dist) from emitting require("process").
 */
const processShim = {
  env: { NODE_ENV: 'production' as string },
  browser: true,
  version: '',
  versions: {} as Record<string, string>,
  platform: 'browser',
  cwd: () => '/',
  nextTick: (callback: (...args: unknown[]) => void, ...args: unknown[]) => {
    queueMicrotask(() => callback(...args))
  },
  emitWarning: (_warning: unknown) => {
    // no-op in renderer
  },
}

export default processShim
