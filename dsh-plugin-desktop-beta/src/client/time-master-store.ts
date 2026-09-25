/** Lightweight view store for the Time Master overlay open state. */

import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

export interface TimeMasterViewState {
  panelOpen: boolean
}

export type TimeMasterViewActions = {
  setPanelOpen: (draft: TimeMasterViewState, open: boolean) => void
}

export function createTimeMasterStore(): EngineStoreHandle<TimeMasterViewState, TimeMasterViewActions> {
  return defineStore({
    init: (): TimeMasterViewState => ({ panelOpen: false }),
    actions: {
      setPanelOpen: (draft, open) => { draft.panelOpen = open },
    },
  })
}
