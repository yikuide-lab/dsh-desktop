/** Pinned rows of the composer model seat (models or workflows). */

/** Storage key for the seat's pinned row ids (`provider/model`). */
export const SEAT_PINS_STORAGE_KEY = 'dsh-plugin-desktop.workflow.seat-pins'

/**
 * Parse a stored pin list: a JSON string array, deduplicated, order preserved.
 * Anything malformed degrades to no pins rather than breaking the seat.
 */
export function readSeatPins(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const seen = new Set<string>()
    const pins: string[] = []
    for (const entry of parsed) {
      if (typeof entry !== 'string' || entry.length === 0 || seen.has(entry)) continue
      seen.add(entry)
      pins.push(entry)
    }
    return pins
  } catch {
    return []
  }
}

/** Toggle a row's pin; a fresh pin lands at the front (most recent first). */
export function toggleSeatPin(pins: readonly string[], key: string): string[] {
  return pins.includes(key)
    ? pins.filter(entry => entry !== key)
    : [key, ...pins]
}
