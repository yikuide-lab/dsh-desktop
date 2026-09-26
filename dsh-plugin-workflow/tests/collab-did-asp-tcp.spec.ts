/**
 * DID helpers + ASP protobuf/TLS TcpFramedAspBridge.
 */

import { generateKeyPairSync } from 'node:crypto'
import { createServer as createNetServer, type AddressInfo } from 'node:net'
import { createServer as createTlsServer } from 'node:tls'
import { describe, expect, it } from 'vitest'
import {
  CollabBus,
  TcpFramedAspBridge,
  createTcpFramedAspBridge,
  decodeAgentStreamMessage,
  didBindsJid,
  didFromLocalJid,
  encodeAgentStreamMessage,
  encodeAuthResponseMessage,
  frameAspPayload,
  generateCollabSecret,
  isValidDid,
  issueCapToken,
  joinMember,
  normalizeDid,
  parseAspTcpEndpoint,
  verifyCapToken,
  type LoopRoster,
} from '../src/collab/index.js'

describe('DID helpers', () => {
  it('validates did:method:id', () => {
    expect(isValidDid('did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2do4')).toBe(true)
    expect(isValidDid('did:dsh:session%40desktop.local%2Fa')).toBe(true)
    expect(isValidDid('not-a-did')).toBe(false)
    expect(isValidDid('did:')).toBe(false)
  })

  it('binds did:dsh: to JID', () => {
    const jid = 'session@desktop.local/a'
    const did = didFromLocalJid(jid)
    expect(normalizeDid(did)).toBe(did)
    expect(didBindsJid(did, jid)).toBe(true)
    expect(didBindsJid(did, 'session@desktop.local/b')).toBe(false)
    expect(didBindsJid('did:web:example.com', jid)).toBe(true)
  })

  it('stores DID on join when provided', () => {
    const roster: LoopRoster = {
      loopId: 'loop-1',
      updatedAt: new Date().toISOString(),
      members: [{
        kind: 'session',
        slot: 's1',
        lifecycle: 'vacant',
        epoch: 0,
      }],
    }
    const jid = 'session@desktop.local/a'
    const did = didFromLocalJid(jid)
    const result = joinMember({ roster, jid, slot: 's1', did })
    expect(result.roster.members[0]?.did).toBe(did)
  })

  it('rejects did:dsh that does not bind JID', () => {
    const roster: LoopRoster = {
      loopId: 'loop-1',
      updatedAt: new Date().toISOString(),
      members: [{
        kind: 'session',
        slot: 's1',
        lifecycle: 'vacant',
        epoch: 0,
      }],
    }
    expect(() => joinMember({
      roster,
      jid: 'session@desktop.local/a',
      slot: 's1',
      did: didFromLocalJid('session@desktop.local/other'),
    })).toThrow(/does not bind/)
  })
})

describe('CapToken DID fields', () => {
  it('includes issuer/subject DID in signature', () => {
    const secret = generateCollabSecret()
    const token = issueCapToken({
      loopId: 'loop-1',
      subject_jid: 'session@desktop.local/a',
      permissions: ['read'],
      epoch: 1,
      secret,
      issuer_did: 'did:dsh:admin%40desktop.local%2Fcontrol',
      subject_did: didFromLocalJid('session@desktop.local/a'),
    })
    expect(token.issuer_did).toBeTruthy()
    expect(token.subject_did).toBeTruthy()
    expect(verifyCapToken({
      token,
      secret,
      loopId: 'loop-1',
      subject_jid: 'session@desktop.local/a',
      expectedEpoch: 1,
      subject_did: token.subject_did,
    })).toBe(true)
    expect(verifyCapToken({
      token,
      secret,
      loopId: 'loop-1',
      subject_jid: 'session@desktop.local/a',
      expectedEpoch: 1,
      subject_did: 'did:web:other',
    })).toBe(false)
  })
})

describe('ASP protobuf codec', () => {
  it('round-trips message / presence / iq envelopes', () => {
    const cases = [
      {
        id: '1',
        from_jid: 'a@desktop.local',
        to_jid: 'b@desktop.local',
        timestamp: new Date(1_700_000_000_000).toISOString(),
        payload: { kind: 'message' as const, body: 'hello', thread_id: 't1' },
      },
      {
        id: '2',
        from_jid: 'a@desktop.local',
        to_jid: '',
        timestamp: new Date(1_700_000_000_100).toISOString(),
        payload: { kind: 'presence' as const, show: 'AWAY' as const, status: 'busy' },
      },
      {
        id: '3',
        from_jid: 'a@desktop.local',
        to_jid: 'b@desktop.local',
        timestamp: new Date(1_700_000_000_200).toISOString(),
        payload: { kind: 'iq' as const, name: 'vision.get', data: { loopId: 'L1' } },
      },
    ]
    for (const envelope of cases) {
      const decoded = decodeAgentStreamMessage(encodeAgentStreamMessage(envelope))
      expect(decoded).toMatchObject({
        id: envelope.id,
        from_jid: envelope.from_jid,
        to_jid: envelope.to_jid,
        payload: envelope.payload,
      })
    }
  })
})

describe('TcpFramedAspBridge', () => {
  it('parses host:port and tls:// endpoints', () => {
    expect(parseAspTcpEndpoint('127.0.0.1:9700')).toEqual({
      host: '127.0.0.1',
      port: 9700,
      tls: false,
    })
    expect(parseAspTcpEndpoint('tcp://localhost:9700')).toEqual({
      host: 'localhost',
      port: 9700,
      tls: false,
    })
    expect(parseAspTcpEndpoint('tls://asp.example:5223')).toEqual({
      host: 'asp.example',
      port: 5223,
      tls: true,
    })
    expect(() => parseAspTcpEndpoint('no-port')).toThrow(/Invalid ASP TCP/)
  })

  it('sends length-prefixed ASP protobuf frames', async () => {
    const received: Buffer[] = []
    const server = createNetServer((socket) => {
      socket.on('data', (chunk) => received.push(chunk))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const { port } = server.address() as AddressInfo
    const bridge = createTcpFramedAspBridge(`127.0.0.1:${port}`)
    const bus = new CollabBus(bridge)
    bus.send({
      from_jid: 'a@desktop.local',
      to_jid: 'b@desktop.local',
      payload: { kind: 'message', body: 'hi' },
      sender_did: didFromLocalJid('a@desktop.local'),
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    await bridge.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))

    const buf = Buffer.concat(received)
    expect(buf.length).toBeGreaterThan(4)
    const len = buf.readUInt32BE(0)
    const payload = buf.subarray(4, 4 + len)
    const decoded = decodeAgentStreamMessage(payload)
    expect(decoded?.payload).toEqual({ kind: 'message', body: 'hi' })
    expect(bridge).toBeInstanceOf(TcpFramedAspBridge)
    expect(bridge.codec).toBe('protobuf')
  })

  it('completes PLAIN auth then sends over TLS', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    // Minimal self-signed-like PEM pair via Node generateKeyPair — tls needs cert.
    // Use openssl-free approach: createTlsServer with key+cert from forge-less path.
    // Vitest env may not have openssl; use node crypto X509Certificate if available.
    const { X509Certificate, createPrivateKey } = await import('node:crypto')
    void X509Certificate
    void createPrivateKey
    void publicKey

    // Generate a self-signed cert with openssl if available; otherwise skip TLS auth path
    // and use a plaintext auth mock (TLS covered separately when certs exist).
    const { execFileSync } = await import('node:child_process')
    const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const dir = mkdtempSync(join(tmpdir(), 'asp-tls-'))
    try {
      const keyPath = join(dir, 'key.pem')
      const certPath = join(dir, 'cert.pem')
      writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }))
      try {
        execFileSync('openssl', [
          'req', '-x509', '-new', '-nodes',
          '-key', keyPath,
          '-out', certPath,
          '-days', '1',
          '-subj', '/CN=localhost',
        ], { stdio: 'ignore' })
      } catch {
        // No openssl — fall back to plaintext auth handshake coverage only.
        rmSync(dir, { recursive: true, force: true })
        await plaintextAuthRoundTrip()
        return
      }
      const key = readFileSync(keyPath)
      const cert = readFileSync(certPath)
      const inbound: unknown[] = []
      const server = createTlsServer({ key, cert }, (socket) => {
        let buffer = Buffer.alloc(0)
        let authed = false
        socket.on('data', (chunk) => {
          buffer = Buffer.concat([buffer, chunk])
          while (buffer.length >= 4) {
            const len = buffer.readUInt32BE(0)
            if (buffer.length < 4 + len) break
            const payload = buffer.subarray(4, 4 + len)
            buffer = buffer.subarray(4 + len)
            if (!authed) {
              authed = true
              const resp = encodeAuthResponseMessage({
                id: 'auth-ok',
                to_jid: 'agent@desktop.local',
                success: true,
                bound_resource: 'r1',
              })
              socket.write(frameAspPayload(resp))
              continue
            }
            inbound.push(decodeAgentStreamMessage(payload))
          }
        })
      })
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
      const { port } = server.address() as AddressInfo
      const bridge = createTcpFramedAspBridge(`tls://127.0.0.1:${port}`, {
        tls: { rejectUnauthorized: false, ca: cert },
        auth: { jid: 'agent@desktop.local', password: 'secret' },
      })
      await bridge.connect()
      expect(bridge.authenticated).toBe(true)
      await bridge.send({
        id: 'm1',
        from_jid: 'agent@desktop.local/r1',
        to_jid: 'peer@desktop.local',
        timestamp: new Date().toISOString(),
        payload: { kind: 'message', body: 'tls-hi' },
      })
      await new Promise((resolve) => setTimeout(resolve, 50))
      await bridge.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      expect(inbound[0]).toMatchObject({
        payload: { kind: 'message', body: 'tls-hi' },
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

async function plaintextAuthRoundTrip(): Promise<void> {
  const inbound: unknown[] = []
  const server = createNetServer((socket) => {
    let buffer = Buffer.alloc(0)
    let authed = false
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      while (buffer.length >= 4) {
        const len = buffer.readUInt32BE(0)
        if (buffer.length < 4 + len) break
        const payload = buffer.subarray(4, 4 + len)
        buffer = buffer.subarray(4 + len)
        if (!authed) {
          authed = true
          socket.write(frameAspPayload(encodeAuthResponseMessage({
            id: 'auth-ok',
            to_jid: 'agent@desktop.local',
            success: true,
            bound_resource: 'r1',
          })))
          continue
        }
        inbound.push(decodeAgentStreamMessage(payload))
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const { port } = server.address() as AddressInfo
  const bridge = createTcpFramedAspBridge(`127.0.0.1:${port}`, {
    auth: { jid: 'agent@desktop.local', password: 'secret' },
  })
  await bridge.connect()
  expect(bridge.authenticated).toBe(true)
  await bridge.send({
    id: 'm1',
    from_jid: 'agent@desktop.local/r1',
    to_jid: 'peer@desktop.local',
    timestamp: new Date().toISOString(),
    payload: { kind: 'message', body: 'auth-hi' },
  })
  await new Promise((resolve) => setTimeout(resolve, 50))
  await bridge.close()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  expect(inbound[0]).toMatchObject({ payload: { kind: 'message', body: 'auth-hi' } })
}
