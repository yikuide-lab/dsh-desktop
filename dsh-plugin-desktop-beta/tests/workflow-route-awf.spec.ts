import { describe, expect, it } from 'vitest'
import {
  DESKTOP_WORKFLOW_OPS,
  parseRequest,
} from '../src/desktop-workflow-route.ts'

/**
 * Regression guard for the route gate: an op the contract and controller both
 * support is useless if `parseRequest`'s allowlist drops it (the request then
 * dies as "invalid workflow request" before dispatch). That is exactly how the
 * whole AWF connector — settings, auth, sync, remote run, executor, tunnel —
 * arrived dead on arrival.
 */
const AWF_OPS = [
  'awfGetSettings',
  'awfSetSettings',
  'awfCheckConnection',
  'awfSync',
  'awfRemoteRun',
  'awfSetTelemetrySettings',
  'awfGetExecutorStatus',
  'awfSetExecutorSettings',
  'awfGetTunnelStatus',
  'awfSetTunnelSettings',
  'awfAuthStatus',
  'awfAuthMethods',
  'awfAuthRegister',
  'awfAuthLogin',
  'awfAuthSendPhoneCode',
  'awfAuthPhoneLogin',
  'awfAuthLogout',
] as const

/**
 * Same gate, same failure mode as the AWF block above: an op the contract and
 * controller support is dead on arrival if the route allowlist drops it.
 */
const RSI_OPS = [
  'rsiListProblems',
  'rsiCreateProblem',
  'rsiRunIteration',
  'rsiGetIterations',
  'rsiDeleteProblem',
] as const

describe('desktop workflow route accepts the AWF connector ops', () => {
  it('puts every AWF op on the request allowlist', () => {
    for (const op of AWF_OPS) {
      expect(DESKTOP_WORKFLOW_OPS.has(op), `op missing from the allowlist: ${op}`).toBe(true)
    }
  })

  it('parses a sign-in request instead of rejecting it as invalid', () => {
    // The reported failure: awfAuthLogin returned 400 "invalid workflow request".
    const request = parseRequest({
      op: 'awfAuthLogin',
      awfAuthCredentials: { email: 'u@test.local', password: 'secret' },
    })
    expect(request?.op).toBe('awfAuthLogin')
    expect(request?.awfAuthCredentials).toEqual({ email: 'u@test.local', password: 'secret' })
  })

  it('carries the remaining AWF payloads the controller reads', () => {
    expect(parseRequest({
      op: 'awfAuthRegister',
      awfAuthCredentials: { email: 'a@b.c', password: 'p', displayName: 'A' },
    })?.awfAuthCredentials?.displayName).toBe('A')

    expect(parseRequest({
      op: 'awfAuthSendPhoneCode',
      awfAuthCredentials: { phone: '+8613800000000' },
    })?.awfAuthCredentials?.phone).toBe('+8613800000000')

    expect(parseRequest({
      op: 'awfSetTunnelSettings',
      awfTunnelSettings: { tunnelEnabled: true, localPort: 8787 },
    })?.awfTunnelSettings).toEqual({ tunnelEnabled: true, localPort: 8787 })

    expect(parseRequest({
      op: 'awfSetTelemetrySettings',
      awfTelemetrySettings: { telemetryEnabled: true },
    })?.awfTelemetrySettings).toEqual({ telemetryEnabled: true })

    expect(parseRequest({
      op: 'awfSetExecutorSettings',
      awfExecutorSettings: { executorEnabled: false },
    })?.awfExecutorSettings).toEqual({ executorEnabled: false })

    expect(parseRequest({ op: 'awfSync', name: 'demo', awfPublish: true, awfWorkflowId: 7 }))
      .toMatchObject({ op: 'awfSync', name: 'demo', awfPublish: true, awfWorkflowId: 7 })
  })

  it('whitelists credential keys so stray fields never reach the bridge', () => {
    const request = parseRequest({
      op: 'awfAuthLogin',
      awfAuthCredentials: { email: 'u@test.local', password: 'p', isAdmin: true, __proto__: { x: 1 } },
    })
    expect(Object.keys(request?.awfAuthCredentials ?? {}).sort())
      .toEqual(['email', 'password'])
  })

  it('still rejects unknown ops and non-object bodies', () => {
    expect(parseRequest(undefined)).toBeUndefined()
    expect(parseRequest(null)).toBeUndefined()
    expect(parseRequest([])).toBeUndefined()
    expect(parseRequest({})).toBeUndefined()
    expect(parseRequest({ op: 'notAnOp' })).toBeUndefined()
  })

  it('puts every RSI op on the request allowlist', () => {
    for (const op of RSI_OPS) {
      expect(DESKTOP_WORKFLOW_OPS.has(op), `op missing from the allowlist: ${op}`).toBe(true)
    }
  })

  it('carries the RSI payloads the controller reads', () => {
    expect(parseRequest({
      op: 'rsiCreateProblem',
      rsiConfig: {
        title: 'improve summary',
        domain: 'summarization',
        maxIterations: 5,
        reviewProviderId: 2,
        improvementCriteria: 'shorter',
        baseYaml: 'apiVersion: workflow-wise/v1',
      },
    })?.rsiConfig).toEqual({
      title: 'improve summary',
      domain: 'summarization',
      maxIterations: 5,
      reviewProviderId: 2,
      improvementCriteria: 'shorter',
      baseYaml: 'apiVersion: workflow-wise/v1',
    })

    expect(parseRequest({ op: 'rsiRunIteration', rsiProblemId: 3 })?.rsiProblemId).toBe(3)
    expect(parseRequest({ op: 'rsiDeleteProblem', rsiProblemId: 0 })?.rsiProblemId).toBe(0)
    expect(parseRequest({ op: 'rsiRunIteration', rsiProblemId: 'x' })?.rsiProblemId).toBeUndefined()
  })
})
