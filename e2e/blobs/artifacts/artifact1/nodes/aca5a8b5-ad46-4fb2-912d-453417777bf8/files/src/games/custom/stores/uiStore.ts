import { create } from 'zustand'

const STORAGE_KEY = 'galgame-ui-prefs-v1'

interface GalPrefs {
  dialogueCount: number
  typewriterSpeed: number
  autoPlayDelay: number
}

function loadPrefs(): GalPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        dialogueCount: Math.max(20, Math.min(40, parsed.dialogueCount ?? 30)),
        typewriterSpeed: Math.max(20, Math.min(120, parsed.typewriterSpeed ?? 30)),
        autoPlayDelay: Math.max(0.5, Math.min(5, parsed.autoPlayDelay ?? 1.5)),
      }
    }
  } catch { /* ignore */ }
  return { dialogueCount: 30, typewriterSpeed: 30, autoPlayDelay: 1.5 }
}

function savePrefs(p: GalPrefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
  } catch { /* ignore */ }
}

interface UIState {
  // VN 模式状态
  autoPlay: boolean
  autoPlayDelay: number       // 自动推进延迟（秒）
  showLog: boolean            // 历史记录抽屉
  showSettings: boolean       // 设置面板
  showCreaturePanel: boolean  // 角色面板（模态框）
  isWorldOverviewOpen: boolean

  // 持久化偏好
  collapsedSections: Record<string, boolean>
  dialogueCount: number      // 每次生成的对话行数 (8~15)
  typewriterSpeed: number    // 打字机速度 (字符/秒, 20~120)

  // Actions
  setAutoPlay: (on: boolean) => void
  toggleAutoPlay: () => void
  setAutoPlayDelay: (delay: number) => void
  setShowLog: (show: boolean) => void
  toggleLog: () => void
  setShowSettings: (show: boolean) => void
  toggleSettings: () => void
  setShowCreaturePanel: (show: boolean) => void
  toggleCreaturePanel: () => void
  toggleWorldOverview: () => void
  closeWorldOverview: () => void
  toggleSection: (sectionId: string) => void
  isCollapsed: (sectionId: string, autoCollapsed: boolean) => boolean
  setDialogueCount: (count: number) => void
  setTypewriterSpeed: (speed: number) => void
}

const prefs = loadPrefs()

const _saveAll = (s: UIState) => savePrefs({
  dialogueCount: s.dialogueCount,
  typewriterSpeed: s.typewriterSpeed,
  autoPlayDelay: s.autoPlayDelay,
})

export const useUIStore = create<UIState>((set, get) => ({
  // VN 模式状态
  autoPlay: false,
  autoPlayDelay: prefs.autoPlayDelay,
  showLog: false,
  showSettings: false,
  showCreaturePanel: false,
  isWorldOverviewOpen: false,

  // 持久化偏好
  collapsedSections: {},
  dialogueCount: prefs.dialogueCount,
  typewriterSpeed: prefs.typewriterSpeed,

  // VN Actions
  setAutoPlay: (on) => set({ autoPlay: on }),
  toggleAutoPlay: () => set((s) => ({ autoPlay: !s.autoPlay })),
  setAutoPlayDelay: (delay) => {
    const val = Math.max(0.5, Math.min(5, delay))
    set({ autoPlayDelay: val })
    _saveAll(get())
  },
  setShowLog: (show) => set({ showLog: show }),
  toggleLog: () => set((s) => ({ showLog: !s.showLog })),
  setShowSettings: (show) => set({ showSettings: show }),
  toggleSettings: () => set((s) => ({ showSettings: !s.showSettings })),
  setShowCreaturePanel: (show) => set({ showCreaturePanel: show }),
  toggleCreaturePanel: () => set((s) => ({ showCreaturePanel: !s.showCreaturePanel })),

  toggleWorldOverview: () => set((s) => ({ isWorldOverviewOpen: !s.isWorldOverviewOpen })),
  closeWorldOverview: () => set({ isWorldOverviewOpen: false }),

  toggleSection: (sectionId) => set((state) => {
    const currentState = state.collapsedSections[sectionId]
    return {
      collapsedSections: {
        ...state.collapsedSections,
        [sectionId]: currentState === undefined ? false : !currentState
      }
    }
  }),

  isCollapsed: (sectionId, autoCollapsed) => {
    const userChoice = get().collapsedSections[sectionId]
    return userChoice !== undefined ? userChoice : autoCollapsed
  },

  setDialogueCount: (count) => {
    const val = Math.max(20, Math.min(40, count))
    set({ dialogueCount: val })
    _saveAll(get())
  },

  setTypewriterSpeed: (speed) => {
    const val = Math.max(20, Math.min(120, speed))
    set({ typewriterSpeed: val })
    _saveAll(get())
  },
}))
