/** Contract for the private Desktop Time Master HTTP bridge. */

export const DESKTOP_TIME_MASTER_PATH = '/api/desktop/time-master'

export type DesktopTimeMasterOp =
  | 'list'
  | 'upsert'
  | 'delete'
  | 'contextSnapshot'
  | 'aiSuggest'

export interface DesktopTimeMasterRequest {
  readonly op: DesktopTimeMasterOp
  readonly id?: string
  readonly draft?: {
    id?: string
    name?: string
    providerHint?: string
    cycle?: 'monthly' | 'yearly' | 'custom'
    startsAt?: string
    expiresAt?: string
    remindDays?: number[]
    notes?: string
  }
  readonly hint?: string
}

export interface DesktopTimeMasterErrorResponse {
  readonly ok: false
  readonly error: string
}
