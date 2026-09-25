/** Date helpers for Time Master (local calendar days, ISO YYYY-MM-DD). */

/** Local calendar date as YYYY-MM-DD. */
export function localDateString(date: Date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Parse YYYY-MM-DD as a local Date at noon (avoids DST edge flips). */
export function parseLocalDate(isoDate: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim())
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day, 12, 0, 0, 0)
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) return null
  return date
}

/** Add whole days to an ISO local date string. */
export function addDays(isoDate: string, days: number): string | null {
  const date = parseLocalDate(isoDate)
  if (!date) return null
  date.setDate(date.getDate() + days)
  return localDateString(date)
}

/** Whole days from `from` to `to` (positive if to is later). */
export function daysBetween(fromIso: string, toIso: string): number | null {
  const from = parseLocalDate(fromIso)
  const to = parseLocalDate(toIso)
  if (!from || !to) return null
  const ms = to.getTime() - from.getTime()
  return Math.round(ms / (24 * 60 * 60 * 1000))
}

/** True when local clock hour is at or past the reminder hour (default 10). */
export function isPastReminderHour(now: Date = new Date(), hour = 10): boolean {
  return now.getHours() > hour || (now.getHours() === hour && now.getMinutes() >= 0)
}
