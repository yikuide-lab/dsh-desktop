/** Verify a packaged Linux artifact meets basic integrity expectations. */

import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DESKTOP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST_DIR = join(DESKTOP_ROOT, 'dist')

function verifyLinuxPackage(): void {
  console.log('Verifying Linux package artifacts...')

  if (!existsSync(DIST_DIR)) {
    throw new Error(`Linux package verification failed: dist directory not found at ${DIST_DIR}`)
  }

  const entries = readdirSync(DIST_DIR)
  const linuxArtifacts = entries.filter(entry =>
    entry.endsWith('.deb') || entry.endsWith('.rpm') || entry.endsWith('.AppImage'),
  )

  if (linuxArtifacts.length === 0) {
    throw new Error('Linux package verification failed: no Linux artifacts found in dist/')
  }

  console.log(`Found ${String(linuxArtifacts.length)} Linux artifact(s):`)
  for (const artifact of linuxArtifacts) {
    const artifactPath = join(DIST_DIR, artifact)
    const stats = statSync(artifactPath)
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2)
    console.log(`  - ${artifact} (${sizeMB} MB)`)

    if (stats.size < 1024 * 1024) {
      throw new Error(`Linux package verification failed: ${artifact} is suspiciously small (${String(stats.size)} bytes)`)
    }
  }

  console.log('Linux package verification passed.')
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    verifyLinuxPackage()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
