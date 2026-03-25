import type { UpdateGameStateAndDocsOutput, GameStateChanges } from '../../api/types'

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

// ==================== 视觉小说特有类型 ====================

// 角色表情（九种）
export type GalExpression = 'normal' | 'happy' | 'angry' | 'sad' | 'surprised' | 'shy' | 'confused' | 'thinking' | 'smirk'

// 故事段落（一幕中的每个段落）
export interface StorySegment {
  idx: number                          // 从0开始的段落索引
  type: 'narrative' | 'dialogue'       // 叙事 or 对白
  speaker_creature_id?: string | null  // 对白时的说话者 creature_id（玩家也会说话）
  content: string[]                    // 具体内容（多段文本）
  emotion?: GalExpression              // 情绪/表情
}

// CG 插画信息
export interface CGInfo {
  creature_ids: string[]  // 插画涉及的角色
  prompt: string          // 生成提示词（使用 creature_id 而非角色名）
}

// 保留旧的 GalDialogue 别名用于兼容历史数据
export interface GalDialogue {
  speaker_creature_id: string
  speaker_display_name: string
  dialogue: string
  depiction?: string
  expression?: GalExpression
}

// 视觉小说故事回合
export interface GalStoryTurn extends BaseTurn {
  type: 'story'
  story: StorySegment[]             // 段落数组
  cg?: CGInfo                       // 可选 CG 插画
  cgImageUrl?: string               // CG 生成后的图片 data URL
  chapterTitle?: string             // 章节标题
  reasoning?: string                // 大模型推理输出
  thinking?: string
  collectorResults?: CollectorResult[]
  collectorOutline?: string          // Collector 全局分析摘要
  settingChanges?: any[]
  stateChanges?: GameStateChanges
  updateGameStateResult?: UpdateGameStateAndDocsOutput
  playerChoices?: PlayerChoice[]
  allowCustomInput?: boolean
  nextDirection?: string            // 导演建议
  generationPhase?: 'collecting' | 'reasoning' | 'thinking' | 'writing' | 'done'
  typewriterEnabled?: boolean       // 运行时标记，仅新生成的回合为 true
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
    segments: StorySegment[]
    cg?: CGInfo
    cgImageUrl?: string
    chapterTitle?: string
    reasoning?: string
    thinking?: string
    collectorResults?: CollectorResult[]
    collectorOutline?: string
    settingChanges?: any[]
    stateChanges?: GameStateChanges
    playerChoices?: PlayerChoice[]
    allowCustomInput?: boolean
    nextDirection?: string
    checkpointId?: string
    updateGameStateResult?: UpdateGameStateAndDocsOutput
    // 兼容旧格式
    dialogues?: GalDialogue[]
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
