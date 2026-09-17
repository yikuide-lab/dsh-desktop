/**
 * TLS material for the Workflow OpenAI API when binding beyond loopback.
 */

import { generate } from 'selfsigned'
import { networkInterfaces } from 'node:os'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isLoopbackHost } from './desktop-workflow-openai-settings.ts'

export interface WorkflowOpenAiTlsMaterial {
  readonly key: string
  readonly cert: string
}

/** Collect canonical IPv4 addresses for certificate SANs. */
export function listLanIpv4Addresses(): string[] {
  const out = new Set<string>(['127.0.0.1'])
  const nets = networkInterfaces()
  for (const entries of Object.values(nets)) {
    if (!entries) continue
    for (const entry of entries) {
      if (entry.family !== 'IPv4' || entry.internal) continue
      out.add(entry.address)
    }
  }
  return [...out]
}

function tlsDir(stateDir: string): string {
  return join(stateDir, 'openai-api-tls')
}

/**
 * Load or create a persisted self-signed certificate covering LAN IPv4 + localhost.
 * Used when bind host is not loopback (LAN mode).
 */
export async function ensureWorkflowOpenAiTls(
  stateDir: string,
  addresses: readonly string[] = listLanIpv4Addresses(),
): Promise<WorkflowOpenAiTlsMaterial> {
  const dir = tlsDir(stateDir)
  const keyPath = join(dir, 'key.pem')
  const certPath = join(dir, 'cert.pem')
  try {
    const [key, cert] = await Promise.all([
      readFile(keyPath, 'utf8'),
      readFile(certPath, 'utf8'),
    ])
    if (key && cert) return { key, cert }
  } catch {
    // regenerate
  }

  const sans = [...new Set(['localhost', '127.0.0.1', ...addresses])]
  const attrs = [{ name: 'commonName', value: 'DSH Workflow OpenAI API' }]
  const notBeforeDate = new Date(Date.now() - 5 * 60 * 1000)
  const notAfterDate = new Date(notBeforeDate.getTime() + 825 * 24 * 60 * 60 * 1000)
  const pems = await generate(attrs, {
    keySize: 2048,
    keyType: 'rsa',
    algorithm: 'sha256',
    notBeforeDate,
    notAfterDate,
    extensions: [
      { name: 'basicConstraints', cA: false },
      {
        name: 'subjectAltName',
        altNames: sans.map((value) => (
          /^\d+\.\d+\.\d+\.\d+$/u.test(value)
            ? { type: 7 as const, ip: value }
            : { type: 2 as const, value }
        )),
      },
    ],
  })

  await mkdir(dir, { recursive: true })
  await writeFile(keyPath, pems.private, { encoding: 'utf8', mode: 0o600 })
  await writeFile(certPath, pems.cert, { encoding: 'utf8', mode: 0o600 })
  return { key: pems.private, cert: pems.cert }
}

export function requiresTls(bindHost: string): boolean {
  return !isLoopbackHost(bindHost)
}
