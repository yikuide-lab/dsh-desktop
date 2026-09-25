/** Public Time Master pure-Node surface. */

export type {
  TokenPlan,
  TokenPlanCycle,
  TokenPlanDraft,
  TimeMasterStoreFile,
  TimeMasterContextSnapshot,
} from './types.js'
export { DEFAULT_REMIND_DAYS, isTokenPlanCycle } from './types.js'
export {
  resolveTimeMasterDir,
  resolveTimeMasterStorePath,
  emptyStore,
  readTimeMasterStore,
  writeTimeMasterStore,
  upsertPlan,
  deletePlan,
  markRemindersSent,
} from './store.js'
export {
  localDateString,
  parseLocalDate,
  addDays,
  daysBetween,
  isPastReminderHour,
} from './dates.js'
export {
  reminderKey,
  collectDueReminders,
  planUrgency,
  type DueReminder,
} from './reminders.js'
export { PLAN_TEMPLATES, heuristicSuggest, templatesForSnapshot } from './templates.js'
export { buildContextSnapshot } from './context.js'
export { suggestTokenPlan } from './suggest.js'
