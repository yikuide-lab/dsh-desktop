/**
 * DID helpers + CapToken DID fields + TcpFramedAspBridge smoke.
 */

import { createServer, type AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import {
  CollabBus,
  TcpFramedAspBridge,
  createTcpFramedAspBridge,
  didBindsJid,
  didFromLocalJid,
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

describe('TcpFramedAspBridge', () => {
  it('parses host:port endpoints', () => {
    expect(parseAspTcpEndpoint('127.0.0.1:9700')).toEqual({ host: '127.0.0.1', port: 9700 })
    expect(parseAspTcpEndpoint('tcp://localhost:9700')).toEqual({ host: 'localhost', port: 9700 })
    expect(() => parseAspTcpEndpoint('no-port')).toThrow(/Invalid ASP TCP/)
  })

  it('sends length-prefixed JSON frames', async () => {
    const received: Buffer[] = []
    const server = createServer((socket) => {
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
    const json = JSON.parse(buf.subarray(4, 4 + len).toString('utf8')) as {
      payload: { body: string }
      sender_did?: string
    }
    expect(json.payload.body).toBe('hi')
    expect(json.sender_did).toBeTruthy()
    expect(bridge).toBeInstanceOf(TcpFramedAspBridge)
  })
})
