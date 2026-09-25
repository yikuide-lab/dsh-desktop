/** Lightweight view store for the session-import overlay open state. */

import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

export interface SessionImportViewState {
  panelOpen: boolean
}

export type SessionImportViewActions = {
  setPanelOpen: (draft: SessionImportViewState, open: boolean) => void
}

export function createSessionImportStore(): EngineStoreHandle<SessionImportViewState, SessionImportViewActions> {
  return defineStore({
    init: (): SessionImportViewState => ({ panelOpen: false }),
    actions: {
      setPanelOpen: (draft, open) => { draft.panelOpen = open },
    },
  })
}
