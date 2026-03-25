import { create } from 'zustand'

const STORAGE_KEY = 'ink-ui-prefs-v2'

export type NarrativePerson = 'second' | 'third'
export type DiceMode = 'off' | 'visible' | 'hidden'
// off = 无骰子系统
// visible = 有难度判定的选项需要掷骰，自由行动掷暗骰
// hidden = 所有行动（包括选项和自由行动）都掷暗骰，玩家不可见

interface InkPrefs {
  totalParagraphs: number
  typewriterSpeed: number
  narrativePerson: NarrativePerson
  diceMode: DiceMode
  autoScrollEnabled: boolean
}

function loadPrefs(): InkPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      const dm = parsed.diceMode
      return {
        totalParagraphs: Math.max(10, Math.min(24, parsed.totalParagraphs ?? 18)),
        typewriterSpeed: parsed.typewriterSpeed >= 9999 ? 9999 : Math.max(20, Math.min(120, parsed.typewriterSpeed ?? 20)),
        narrativePerson: parsed.narrativePerson === 'third' ? 'third' : 'second',
        diceMode: (dm === 'off' || dm === 'visible' || dm === 'hidden') ? dm : 'visible',
        autoScrollEnabled: parsed.autoScrollEnabled !== false,
      }
    }
  } catch { /* ignore */ }
  return { totalParagraphs: 18, typewriterSpeed: 20, narrativePerson: 'second', diceMode: 'visible', autoScrollEnabled: true }
}

function savePrefs(p: InkPrefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
  } catch { /* ignore */ }
}

interface UIState {
  // 状态
  isLeftPanelOpen: boolean
  isWorldOverviewOpen: boolean
  isTimelinePanelOpen: boolean
  collapsedSections: Record<string, boolean>
  totalParagraphs: number // 每次生成的总段落数 (10~20)
  typewriterSpeed: number // 打字机速度 (字符/秒, 20~120)
  narrativePerson: NarrativePerson // 叙事人称：second=第二人称, third=第三人称
  diceMode: DiceMode // 骰子模式
  autoScrollEnabled: boolean // 自动滚动到最新文字
  isRefreshing: boolean // 正在刷新游戏数据

  // Actions
  setIsLeftPanelOpen: (open: boolean) => void
  toggleLeftPanel: () => void
  toggleWorldOverview: () => void
  closeWorldOverview: () => void
  toggleTimelinePanel: () => void
  closeTimelinePanel: () => void
  toggleSection: (sectionId: string) => void
  isCollapsed: (sectionId: string, autoCollapsed: boolean) => boolean
  setTotalParagraphs: (count: number) => void
  setTypewriterSpeed: (speed: number) => void
  setNarrativePerson: (person: NarrativePerson) => void
  setDiceMode: (mode: DiceMode) => void
  setAutoScrollEnabled: (enabled: boolean) => void
  setIsRefreshing: (refreshing: boolean) => void
}

const prefs = loadPrefs()

const _saveAll = (s: UIState) => savePrefs({
  totalParagraphs: s.totalParagraphs,
  typewriterSpeed: s.typewriterSpeed,
  narrativePerson: s.narrativePerson,
  diceMode: s.diceMode,
  autoScrollEnabled: s.autoScrollEnabled,
})

export const useUIStore = create<UIState>((set, get) => ({
  isLeftPanelOpen: typeof window !== 'undefined' ? window.innerWidth > 768 : true,
  isWorldOverviewOpen: false,
  isTimelinePanelOpen: false,
  collapsedSections: {},
  totalParagraphs: prefs.totalParagraphs,
  typewriterSpeed: prefs.typewriterSpeed,
  narrativePerson: prefs.narrativePerson,
  diceMode: prefs.diceMode,
  autoScrollEnabled: prefs.autoScrollEnabled,
  isRefreshing: false,

  setIsLeftPanelOpen: (open) => set({ isLeftPanelOpen: open }),

  toggleLeftPanel: () => set((state) => ({ isLeftPanelOpen: !state.isLeftPanelOpen })),

  toggleWorldOverview: () => set((state) => ({ isWorldOverviewOpen: !state.isWorldOverviewOpen })),

  closeWorldOverview: () => set({ isWorldOverviewOpen: false }),

  toggleTimelinePanel: () => set((state) => ({ isTimelinePanelOpen: !state.isTimelinePanelOpen })),

  closeTimelinePanel: () => set({ isTimelinePanelOpen: false }),

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

  setTotalParagraphs: (count) => {
    const val = Math.max(10, Math.min(24, count))
    set({ totalParagraphs: val })
    _saveAll(get())
  },

  setTypewriterSpeed: (speed) => {
    const val = speed >= 9999 ? 9999 : Math.max(20, Math.min(120, speed))
    set({ typewriterSpeed: val })
    _saveAll(get())
  },

  setNarrativePerson: (person) => {
    set({ narrativePerson: person })
    _saveAll(get())
  },

  setDiceMode: (mode) => {
    set({ diceMode: mode })
    _saveAll(get())
  },

  setAutoScrollEnabled: (enabled) => {
    set({ autoScrollEnabled: enabled })
    _saveAll(get())
  },

  setIsRefreshing: (refreshing) => set({ isRefreshing: refreshing }),
}))
