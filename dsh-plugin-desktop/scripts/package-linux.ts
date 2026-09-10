/** Build Linux packages (deb, rpm, AppImage) on a native Linux host. */

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareFsExtForElectron } from './prepare-fs-ext.ts'
import { electronBuilderEnvironment } from './electron-builder-environment.ts'

/** Injectable native Linux packaging boundary used by focused tests. */
export interface LinuxPackageOptions {
  /** Environment inherited by the packaging command. */
  readonly env: NodeJS.ProcessEnv
  /** Platform executing the package build. */
  readonly platform: NodeJS.Platform
  /** Node architecture executing the package build. */
  readonly arch: string
  /** Node version executing the package build. */
  readonly nodeVersion: string
  /** Repository root containing the Yarn workspace. */
  readonly workspaceRoot: string
  /** Desktop package root containing electron-builder configuration. */
  readonly desktopRoot: string
  /** Absolute electron-builder CLI module. */
  readonly builderCli: string
  /** Prepare platform-specific native runtime dependencies before packaging. */
  readonly prepareRuntime: () => void
  /** Absolute packaged-installer verification script. */
  readonly verifier: string
  /** Node executable used to run package-local scripts. */
  readonly nodeExecutable: string
  /** Execute one packaging command. */
  readonly run: (
    command: string,
    args: readonly string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
  ) => void
  /** Report non-secret packaging progress. */
  readonly log: (message: string) => void
}

function run(
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): void {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status)}`)
  }
}

/** Create the native packaging options for a verifier entry point. */
export function createLinuxPackageOptions(): LinuxPackageOptions {
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const workspaceRoot = resolve(desktopRoot, '..')
  const require = createRequire(import.meta.url)
  return {
    env: process.env,
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.versions.node,
    workspaceRoot,
    desktopRoot,
    builderCli: require.resolve('electron-builder/cli.js'),
    prepareRuntime: () => {
      prepareFsExtForElectron({ platform: 'linux', arch: process.arch, desktopRoot })
    },
    verifier: fileURLToPath(new URL('./verify-linux-package.ts', import.meta.url)),
    nodeExecutable: process.execPath,
    run,
    log: message => console.log(message),
  }
}

/** Run the shared host and Node release gates before packaging. */
function assertLinuxPackageHost(options: LinuxPackageOptions, artifact: string): void {
  if (options.platform !== 'linux') {
    throw new Error(`Linux ${artifact} must be built on a native Linux host`)
  }
  const versionMatch = /^(\d+)\.(\d+)\./u.exec(options.nodeVersion)
  const major = Number(versionMatch?.[1])
  const minor = Number(versionMatch?.[2])
  if (!((major === 22 && minor >= 19) || major === 24)) {
    throw new Error(
      `Linux ${artifact} requires Node 22.19+ or Node 24.x with bundled Corepack; received ${options.nodeVersion}`,
    )
  }
}

/** Run the gates and package one Linux artifact. */
export function packageLinuxArtifact(
  options: LinuxPackageOptions,
  target: 'deb' | 'rpm' | 'AppImage',
): void {
  assertLinuxPackageHost(options, target)

  options.log(`Building a Linux ${target} package; code signing is a separate release step.`)
  if (options.env.DSH_PACKAGE_CHECK_ALREADY_RAN !== '1') {
    options.run(
      'corepack',
      ['yarn', 'workspace', 'dsh-plugin-desktop', 'check:linux-package'],
      options.workspaceRoot,
      options.env,
    )
  } else {
    options.log('Skipping the Linux package preflight; the package gate already passed.')
  }
  options.prepareRuntime()
  options.run(
    options.nodeExecutable,
    [
      options.builderCli,
      '--linux',
      target,
      '--publish',
      'never',
      '--config.npmRebuild=false',
    ],
    options.desktopRoot,
    electronBuilderEnvironment(options.env),
  )
  options.run(
    options.nodeExecutable,
    [options.verifier],
    options.desktopRoot,
    options.env,
  )
}

/** Parse command-line arguments for target selection. */
function parseTargetArgument(): 'deb' | 'rpm' | 'AppImage' {
  const targetIndex = process.argv.indexOf('--target')
  if (targetIndex !== -1 && targetIndex + 1 < process.argv.length) {
    const target = process.argv[targetIndex + 1]
    if (target === 'deb' || target === 'rpm' || target === 'AppImage') {
      return target
    }
    throw new Error(`Invalid target: ${target}. Must be deb, rpm, or AppImage`)
  }
  return 'AppImage'
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    const target = parseTargetArgument()
    packageLinuxArtifact(createLinuxPackageOptions(), target)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
