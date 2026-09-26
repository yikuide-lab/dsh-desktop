/** Process-wide CollabBus instance for Desktop Host. */

import { CollabBus } from 'dsh-plugin-workflow/collab'

let bus: CollabBus | undefined

export function getCollabBus(): CollabBus {
  if (!bus) bus = new CollabBus()
  return bus
}

export function resetCollabBusForTests(): void {
  bus = undefined
}
