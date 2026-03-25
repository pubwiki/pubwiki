import type { UpdateGameStateAndDocsOutput } from '../../api/types'

// ==================== 复用 ink 的通用类型 ====================

// 玩家选项类型（与 ink 相同）
export interface PlayerChoice {
  name: string
  description: string
  is_special: boolean
}

// RAG 收集器结果类型（与 ink 相同）
export interface CollectorResult {
  entity_id: string
  selected: boolean
  thinking: string
  documents?: Array<{
    path: string
    selected: boolean
    thinking: string
  }>
}

// 基础回合类型
export interface BaseTurn {
  id: number
}

// 玩家行动回合类型（与 ink 相同，无骰子）
export interface PlayerActionTurn extends BaseTurn {
  type: 'action'
  playerAction: string
  selectedChoice?: PlayerChoice
  isCustomInput?: boolean
}

// 系统回合类型（与 ink 相同）
export interface SystemTurn extends BaseTurn {
  type: 'system'
  logs?: string[]
  luaCode?: string
  summary?: string
}

// 错误回合类型（与 ink 相同）
export interface ErrorTurn extends BaseTurn {
  type: 'error'
  errorMessage: string
  relatedActionId?: number
  retryAction?: () => void
}

// ==================== Galgame 特有类型 ====================

// 角色表情
export type GalExpression = 'normal' | 'happy' | 'angry' | 'sad' | 'surprised' | 'shy' | 'disgusted' | 'dazed'

// 单条对话
export interface GalDialogue {
  speaker_creature_id: string     // ECS 实体 ID，空字符串表示旁白
  speaker_display_name: string    // 说话者显示名称
  dialogue: string                // 对话/旁白文本
  depiction?: string              // 第一人称场景描写
  expression?: GalExpression      // 角色表情
}

// Galgame 故事回合
export interface GalStoryTurn extends BaseTurn {
  type: 'story'
  story: GalDialogue[]            // 对话数组（替代 ink 的 content/contentPart2）
  chapterTitle?: string           // 章节标题
  reasoning?: string              // 大模型推理输出
  thinking?: string
  collectorResults?: CollectorResult[]
  settingChanges?: string[]
  stateChanges?: string[]
  updateGameStateResult?: UpdateGameStateAndDocsOutput
  playerChoices?: PlayerChoice[]
  allowCustomInput?: boolean
  nextDirection?: string          // 导演建议
  generationPhase?: 'collecting' | 'reasoning' | 'thinking' | 'writing' | 'done'
  typewriterEnabled?: boolean     // 运行时标记，仅新生成的回合为 true
  relatedActionId?: number
  checkpointId?: string
}

// 联合类型
export type GalTurn = GalStoryTurn | PlayerActionTurn | SystemTurn | ErrorTurn

// 类型守卫函数
export function isGalStoryTurn(turn: GalTurn): turn is GalStoryTurn {
  return turn.type === 'story'
}

export function isPlayerActionTurn(turn: GalTurn): turn is PlayerActionTurn {
  return turn.type === 'action'
}

export function isErrorTurn(turn: GalTurn): turn is ErrorTurn {
  return turn.type === 'error'
}

// 存储到剧情历史的数据结构
export interface GalStoryHistoryData {
  player?: {
    id: number
    playerAction: string
    selectedChoice?: PlayerChoice
    isCustomInput?: boolean
  }
  story: {
    id: number
    dialogues: GalDialogue[]
    chapterTitle?: string
    reasoning?: string
    thinking?: string
    collectorResults?: CollectorResult[]
    settingChanges?: string[]
    stateChanges?: string[]
    playerChoices?: PlayerChoice[]
    allowCustomInput?: boolean
    nextDirection?: string
    checkpointId?: string
    updateGameStateResult?: UpdateGameStateAndDocsOutput
  }
}

// 游戏时间类型（与 ink 相同）
export interface GameTime {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

// 注册表类型（与 ink 相同）
export interface SkillInfo {
  name: string
  description?: string
  details?: string[]
}

export interface ItemInfo {
  name: string
  description?: string
  detail?: string[]
}

export interface MoveInfo {
  name: string
  desc: string
  details: string[]
}

export interface CustomComponentDefInfo {
  component_key: string
  component_name: string
  is_array: boolean
  type_schema?: any
}

// 信息模态框内容类型
export interface InfoModalContent {
  title: string
  content: string | React.ReactNode
}
