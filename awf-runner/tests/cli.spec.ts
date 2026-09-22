/** awf-node CLI argument parsing (pure; no side effects). */

import { describe, expect, it } from 'vitest'
import { CliUsageError, parseCliArgs, parseLabels } from '../src/cli.js'

const ENV: Record<string, string | undefined> = {}

describe('parseCliArgs', () => {
  it('defaults to help', () => {
    expect(parseCliArgs([], ENV)).toEqual({ command: 'help' })
    expect(parseCliArgs(['--help'], ENV)).toEqual({ command: 'help' })
  })

  it('rejects unknown commands and stray args', () => {
    expect(() => parseCliArgs(['fly'], ENV)).toThrow(CliUsageError)
    expect(() => parseCliArgs(['serve', 'bare'], ENV)).toThrow(CliUsageError)
    expect(() => parseCliArgs(['serve', '--platform'], ENV)).toThrow(CliUsageError)
  })

  it('parses serve with all flags', () => {
    const cmd = parseCliArgs([
      'serve',
      '--platform', 'https://awf.example.com/',
      '--token-env', 'MY_TOKEN',
      '--concurrency', '4',
      '--labels', 'region=eu, gpu=a100',
      '--state-dir', '/var/lib/awf-node',
      '--claim-wait-sec', '10',
    ], ENV)
    expect(cmd).toEqual({
      command: 'serve',
      stateDir: '/var/lib/awf-node',
      platform: 'https://awf.example.com/',
      tokenEnv: 'MY_TOKEN',
      concurrency: 4,
      labels: { region: 'eu', gpu: 'a100' },
      claimWaitSec: 10,
    })
  })

  it('supports --flag=value syntax', () => {
    const cmd = parseCliArgs(['serve', '--platform=https://awf.example.com', '--concurrency=2'], ENV)
    expect(cmd).toMatchObject({ command: 'serve', platform: 'https://awf.example.com', concurrency: 2 })
  })

  it('falls back to AWF_PLATFORM_URL and AWF_NODE_STATE_DIR', () => {
    const cmd = parseCliArgs(['serve'], {
      AWF_PLATFORM_URL: 'https://awf.example.com',
      AWF_NODE_STATE_DIR: '/opt/awf',
    })
    expect(cmd).toMatchObject({ platform: 'https://awf.example.com', stateDir: '/opt/awf' })
  })

  it('defaults state dir under the home directory', () => {
    const cmd = parseCliArgs(['serve'], ENV)
    expect(cmd.command).toBe('serve')
    if (cmd.command === 'serve') expect(cmd.stateDir).toMatch(/\.awf-node$/)
  })

  it('clamps nothing but rejects out-of-range concurrency / wait', () => {
    expect(() => parseCliArgs(['serve', '--concurrency', '0'], ENV)).toThrow(CliUsageError)
    expect(() => parseCliArgs(['serve', '--concurrency', '33'], ENV)).toThrow(CliUsageError)
    expect(() => parseCliArgs(['serve', '--concurrency', 'x'], ENV)).toThrow(CliUsageError)
    expect(() => parseCliArgs(['serve', '--claim-wait-sec', '31'], ENV)).toThrow(CliUsageError)
    expect(() => parseCliArgs(['serve', '--claim-wait-sec', '-1'], ENV)).toThrow(CliUsageError)
  })

  it('rejects invalid platform URLs', () => {
    expect(() => parseCliArgs(['serve', '--platform', 'not-a-url'], ENV)).toThrow(CliUsageError)
    expect(() => parseCliArgs(['serve', '--platform', 'ftp://x'], ENV)).toThrow(CliUsageError)
  })

  it('parseLabels validates k=v entries', () => {
    expect(parseLabels('a=1,b=2')).toEqual({ a: '1', b: '2' })
    expect(parseLabels('')).toEqual({})
    expect(() => parseLabels('nope')).toThrow(CliUsageError)
    expect(() => parseLabels('=v')).toThrow(CliUsageError)
  })

  it('login/register require email and password (flag or env)', () => {
    expect(() => parseCliArgs(['login', '--email', 'a@b.c'], ENV)).toThrow(CliUsageError)
    expect(() => parseCliArgs(['login', '--password', 'x'], ENV)).toThrow(CliUsageError)
    expect(parseCliArgs(['login', '--email', 'a@b.c'], { AWF_NODE_PASSWORD: 'secret' }))
      .toMatchObject({ command: 'login', email: 'a@b.c', password: 'secret' })
    expect(parseCliArgs(['register', '--email', 'a@b.c', '--password', 'pw', '--display-name', 'Node'], ENV))
      .toMatchObject({ command: 'register', email: 'a@b.c', password: 'pw', displayName: 'Node' })
  })

  it('status takes only a state dir', () => {
    expect(parseCliArgs(['status', '--state-dir', '/tmp/x'], ENV))
      .toEqual({ command: 'status', stateDir: '/tmp/x' })
  })
})
