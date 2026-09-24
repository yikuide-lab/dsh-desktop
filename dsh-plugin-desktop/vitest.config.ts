import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    globalSetup: process.platform === 'win32' ? ['../scripts/prepare-test-electron.mjs'] : [],
    // This patched host package is exercised with a mocked node:fs/promises.
    // Keep it in Vitest's module graph so the builtin mock reaches its imports.
    // ui-primitives ships CSS-module imports that only a bundler (or Vitest's
    // pipeline) can load, so its barrel must not run through raw Node ESM.
    server: {
      deps: {
        inline: [
          '@deepseek-ai/dsh-host-directory-picker-browse',
          '@deepseek-ai/dsh-client-ui-primitives',
        ],
      },
    },
    // Profile integration tests create a full package-junction closure; higher
    // Windows file concurrency makes their latency depend on NTFS/Defender load.
    maxWorkers: process.platform === 'win32' ? 2 : undefined,
  },
})
