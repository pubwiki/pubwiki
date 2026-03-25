import type { CreatureEntity, OrganizationEntity, RegionEntity, UpdateGameStateAndDocsOutput, TypeSchema } from '../../api/types'

// 玩家选项类型
export interface PlayerChoice {
  name: string
  description: string
  is_special: boolean
  difficulty_level?: number   // 0~100 掷骰难度，越高越难；仅需要判定的选项才有
  difficulty_reason?: string  // AI解释为什么需要掷骰判定
}

// 掷骰结果
export interface DiceResult {
  difficulty: number       // 难度等级
  roll: number             // 最终采用的骰子点数 (0~100)
  success: boolean         // 是否成功（roll >= difficulty）
  retried: boolean         // 是否使用了重试
  retryRoll?: number       // 重试的点数（如果重试了）
}

// RAG 收集器结果类型
export interface CollectorResult {
  entity_id: string
  selected: boolean
  thinking: string
  documents?: Array<{
    path: string
    selected: boolean
    thinking: string
    flag_is_thinking_instruction?: boolean
    flag_is_writing_instruction?: boolean
    flag_is_updating_instruction?: boolean
  }>
}

// 基础回合类型
export interface BaseTurn {
  id: number
}

// 故事回合类型
export interface StoryTurn extends BaseTurn {
  type: 'story'
  content: string // 第一节内容
  contentPart2?: string // 第二节内容
  chapterHint?: string
  reasoning?: string // 大模型推理输出
  thinking?: string
  collectorResults?: CollectorResult[]
  settingChanges?: string[]
  stateChanges?: string[]
  updateGameStateResult?: UpdateGameStateAndDocsOutput
  playerChoices?: PlayerChoice[]
  allowCustomInput?: boolean
  directorNotes?: { notes: string[]; flags: Array<{ id: string; value: boolean; remark?: string }>; stage_goal?: string | null }
  generationPhase?: 'collecting' | 'reasoning' | 'thinking' | 'writing' | 'done'
  typewriterEnabled?: boolean // 运行时标记，仅新生成的回合为 true
  relatedActionId?: number
  checkpointId?: string
  preGenerationCheckpointId?: string // 生成前的临时存档，用于重新生成
}

// 玩家行动回合类型
export interface PlayerActionTurn extends BaseTurn {
  type: 'action'
  playerAction: string
  selectedChoice?: PlayerChoice
  isCustomInput?: boolean
  diceResult?: DiceResult
  directorNote?: string // 玩家附加的导演指令（OOC元指令）
}

// 系统回合类型
export interface SystemTurn extends BaseTurn {
  type: 'system'
  logs?: string[]
  luaCode?: string
  summary?: string
}

// 错误回合类型
export interface ErrorTurn extends BaseTurn {
  type: 'error'
  errorMessage: string
  relatedActionId?: number
  retryAction?: () => void
}

// 联合类型
export type InkTurn = StoryTurn | PlayerActionTurn | SystemTurn | ErrorTurn

// 类型守卫函数
export function isStoryTurn(turn: InkTurn): turn is StoryTurn {
  return turn.type === 'story'
}

export function isPlayerActionTurn(turn: InkTurn): turn is PlayerActionTurn {
  return turn.type === 'action'
}

export function isErrorTurn(turn: InkTurn): turn is ErrorTurn {
  return turn.type === 'error'
}

// 存储到剧情历史的数据结构
export interface StoryHistoryData {
  player?: {
    id: number
    playerAction: string
    selectedChoice?: PlayerChoice
    isCustomInput?: boolean
    diceResult?: DiceResult
    directorNote?: string
  }
  story: {
    id: number
    content: string
    contentPart2?: string
    chapterHint?: string
    reasoning?: string
    thinking?: string
    collectorResults?: CollectorResult[]
    settingChanges?: string[]
    stateChanges?: string[]
    playerChoices?: PlayerChoice[]
    allowCustomInput?: boolean
    directorNotes?: { notes: string[]; flags: Array<{ id: string; value: boolean; remark?: string }>; stage_goal?: string | null }
    checkpointId?: string
    // 游戏状态更新结果（用于恢复时显示）
    updateGameStateResult?: UpdateGameStateAndDocsOutput
  }
}

// 游戏时间类型
export interface GameTime {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

// 注册表类型
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
  type_schema?: TypeSchema
}

// 信息模态框内容类型
export interface InfoModalContent {
  title: string
  content: string | React.ReactNode
}

// 时间线节点（存储在存档 description 中的祖先链元素）
export interface TimelineNode {
  id: string  // checkpointId
  t: string   // 章节标题
}

// 重建的时间线树节点（用于 UI 渲染）
export interface TimelineTreeNode {
  checkpointId: string
  title: string
  timestamp?: number
  children: TimelineTreeNode[]
  isCurrent?: boolean
}
