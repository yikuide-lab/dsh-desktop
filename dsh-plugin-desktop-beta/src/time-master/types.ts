/** Shared types for Time Master token-plan registry. */

export type TokenPlanCycle = 'monthly' | 'yearly' | 'custom'

export interface TokenPlan {
  readonly id: string
  readonly name: string
  readonly providerHint?: string
  readonly cycle: TokenPlanCycle
  readonly startsAt?: string
  readonly expiresAt: string
  readonly remindDays: readonly number[]
  readonly notes?: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface TokenPlanDraft {
  readonly name?: string
  readonly providerHint?: string
  readonly cycle?: TokenPlanCycle
  readonly startsAt?: string
  readonly expiresAt?: string
  readonly remindDays?: readonly number[]
  readonly notes?: string
}

export interface TimeMasterStoreFile {
  readonly version: 1
  readonly plans: TokenPlan[]
  /** planId → reminder keys already fired (`${expiresAt}|d${day}`). */
  readonly remindersSent: Record<string, string[]>
}

export interface TimeMasterContextSnapshot {
  readonly providers: readonly { id: string; name: string; models: readonly string[] }[]
  readonly tokenPlanRoutes: readonly string[]
  readonly workflowProviders: readonly { id: string; model: string; host?: string }[]
  readonly templates: readonly { name: string; cycle: TokenPlanCycle; providerHint: string; notes: string }[]
  readonly today: string
}

export const DEFAULT_REMIND_DAYS: readonly number[] = [7, 3, 1, 0]

export function isTokenPlanCycle(value: unknown): value is TokenPlanCycle {
  return value === 'monthly' || value === 'yearly' || value === 'custom'
}
