import { create } from 'zustand'
import type { LorebookData } from '../api/worldBuilderNextTypes'
import {
  initCopilotDB,
  loadLorebooks,
  addLorebook as svcAddLorebook,
  removeLorebook as svcRemoveLorebook,
  clearLorebooks as svcClearLorebooks,
} from '../api/copilotService'

interface LorebookState {
  lorebooks: LorebookData[]
  initialized: boolean
  initLorebooks: () => Promise<void>
  addLorebook: (lb: LorebookData) => void
  removeLorebook: (filename: string) => void
  clearLorebooks: () => void
}

export const useLorebookStore = create<LorebookState>()((set) => ({
  lorebooks: [],
  initialized: false,

  initLorebooks: async () => {
    await initCopilotDB()
    set({ lorebooks: [...loadLorebooks()], initialized: true })
  },

  addLorebook: (lb) => {
    svcAddLorebook(lb)
    set({ lorebooks: [...loadLorebooks()] })
  },

  removeLorebook: (filename) => {
    svcRemoveLorebook(filename)
    set({ lorebooks: [...loadLorebooks()] })
  },

  clearLorebooks: () => {
    svcClearLorebooks()
    set({ lorebooks: [] })
  },
}))

/** Non-hook version for use in callbacks */
export function getLorebooksSnapshot(): LorebookData[] {
  return useLorebookStore.getState().lorebooks
}
