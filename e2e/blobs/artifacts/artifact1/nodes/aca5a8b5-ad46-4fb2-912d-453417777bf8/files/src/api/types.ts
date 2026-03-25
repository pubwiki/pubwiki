// ============================================================================
// 游戏 API 类型定义
// 基于 FRONTEND_API.md
// ============================================================================

// ============================================================================
// 基础类型
// ============================================================================

// 动态属性：key 为属性字段名（由 Registry.creature_attr_fields 定义），value 为整数或字符串
export type Attributes = Record<string, number | string>;

export interface ServiceCallRecord {
  service: string;
  args?: any;
  success?: boolean;
  error?: string;
}

export interface UpdateGameStateAndDocsOutput {
  success: boolean;
  audit?: string;
  outline?: string;
  summary?: string; // 面向用户的状态变更摘要，用剧情语言描述
  calls?: ServiceCallRecord[];
  results?: ServiceCallRecord[];
  error?: string;
  first_attempt?: {
    calls?: ServiceCallRecord[];
    results?: ServiceCallRecord[];
    outline?: string;
    failCount?: number;
  };
  isHistorical?: boolean;
}

// 结构化状态变化（由 Generator Step 3 输出）
export interface GameStateChanges {
  related_creature_ids: string[];
  related_region_ids: string[];
  related_organization_ids: string[];
  service_calls: Array<{ name: string; suggestion: string }>;
}

/** 格式化 GameStateChanges 的 service_calls 为可读字符串数组 */
export function formatStateChanges(changes: GameStateChanges | undefined): string[] {
  if (!changes?.service_calls) return []
  return changes.service_calls.map(c => `${c.name}: ${c.suggestion}`)
}

export interface DirectorNotesOutput {
  notes: string[];
  flags: Array<{ id: string; value: boolean; remark?: string }>;
  stage_goal?: string | null; // 阶段叙事目标，仅在需要更新时由 LLM 设置
}

// 结构化设定变更建议（新格式）
export interface SettingUpdateRecommendation {
  option: 'create' | 'append' | 'update';
  creature_id?: string;
  organization_id?: string;
  region_id?: string;
  doc_name: string;
  suggestion: string;
}

/** 格式化单条设定变更为可读字符串（兼容新旧格式） */
export function formatSettingChange(c: unknown): string {
  if (typeof c === 'string') return c
  if (c && typeof c === 'object' && 'option' in c) {
    const r = c as SettingUpdateRecommendation
    const target = r.creature_id || r.organization_id || r.region_id || 'world'
    return `[${r.option}] ${target}/${r.doc_name}: ${r.suggestion}`
  }
  return String(c)
}

// Writer 输出的新实体定义（STEP3c）
export interface NewEntityDefinition {
  type: 'creature' | 'region' | 'organization';
  name: string;
  description: string;
}

// 结构化事件变更建议
export interface EventUpdateRecommendation {
  option: 'create' | 'append' | 'update';
  event_id: string;
  title?: string;
  summary: string;
  suggestion: string;
  related_entities?: string[];
}

// 事件条目（世界实体 Events 组件）
export interface EventEntry {
  event_id: string;
  title: string;
  summary: string;
  content: string;
  related_entities?: string[];
  created_at?: string;
  updated_at?: string;
}

/** 格式化单条事件变更为可读字符串 */
export function formatEventChange(c: unknown): string {
  if (typeof c === 'string') return c
  if (c && typeof c === 'object' && 'option' in c) {
    const r = c as EventUpdateRecommendation
    return `[${r.option}] event:${r.event_id}: ${r.suggestion}`
  }
  return String(c)
}

export interface UpdateGameStateAndDocsInput {
  new_event: string;
  state_changes?: GameStateChanges; // 可选的状态变化提示（Analyzer 会独立从剧情提取）
  setting_changes?: any[]; // 设定变化列表（SettingUpdateRecommendation[]）
  event_changes?: any[]; // 事件变化列表（EventUpdateRecommendation[]）
  new_entities?: NewEntityDefinition[]; // Writer 提供的新实体定义
  director_notes?: DirectorNotesOutput; // 导演笔记与标记
  collector_built_messages?: Array<{ role: string; content: string }>; // Collector 构建的设定文档 premessages
}

export interface CreativeWritingInput {
  model?: string;
  create_request: string; // 创意写作请求
  thinking_instruction: string; // 思考指令
  thinking_example?: string; // 可选，step_1_thinking_result 的示例文本
  previous_content_overview: string; // 之前内容概览
  output_content_schema: string; // 输出内容的 TypeScript 接口定义，非常不严格，比如 "string"(只有一段文本) "{hint:string // 章节标题, content:string //正文}" (章节标题和正文) 等等
}

export interface CreativeWritingOutput {
  success: boolean;
  content?: any;
  thinking?: string;
  error?: string;
  raw_text?: string;
  collector_results?: Array<{
    entity_id: string;
    selected: boolean;
    thinking: string;
    documents?: Array<{
      path: string;
      selected: boolean;
      thinking: string;
      flag_is_thinking_instruction?: boolean;
      flag_is_writing_instruction?: boolean;
      flag_is_updating_instruction?: boolean;
    }>;
  }>;
  collector_outline?: string; // Collector 的全局分析摘要（替代分散的 per-entity/per-doc thinking）
  selected_events?: string[]; // Collector 选中的事件 ID 列表
  reasoning?: string;
  setting_changes?: any[]; // 设定变化列表（SettingUpdateRecommendation[]）
  event_changes?: any[]; // 事件变化列表（EventUpdateRecommendation[]）
  new_entities?: NewEntityDefinition[]; // 新实体定义（STEP3c）
  director_notes?: DirectorNotesOutput; // 导演笔记与标记（STEP4）
  updater_messages?: Array<{ role: string; content: string }>; // 仅包含 flag_is_updating_instruction 的文档，供 Analyzer 使用
}

export interface CreativeWritingStreamInput {
  model?: string;
  callback: CreativeWritingStreamCallback;
  create_request: string; // 创意写作请求
  thinking_instruction: string; // 思考指令
  thinking_example?: string; // 可选，step_1_thinking_result 的示例文本
  previous_content_overview: string; // 之前内容概览
  output_content_schema: string; // 输出内容的 TypeScript 接口定义，非常不严格，比如 "string"(只有一段文本) "{hint:string // 章节标题, content:string //正文}" (章节标题和正文) 等等,
  output_content_schema_definition?: object; // 可选的输出内容的接口定义说明，如果提供，则会按照schema严格约束
  reuse_last_collect?: boolean; // 重用上次缓存的 RAG 收集结果，跳过 collector 阶段，用于生成失败后的重试
}

export type CreativeWritingStreamCallback = (streamEvent: {
  event_type:
    | "collector_result_update"
    | "error"
    | "result_update"
    | "done"
    | "reasoning_update";
  event_data: Partial<CreativeWritingOutput> | Error;
}) => void;

// 状态效果实例，绑定在角色实体上的自由数据
export interface StatusEffect {
  instance_id: string; // 状态实例唯一标识符
  display_name?: string; // 状态效果显示名称，用于在UI中展示
  remark?: string; // 状态备注，描述来源、效果、持续条件等
  data?: any; // 状态效果的数据，任意类型
  add_at?: string; // 添加时间
  last_update_at?: string; // 最后更新时间
}

export interface TypeSchema {
  type?:
    | "string"
    | "integer"
    | "number"
    | "boolean"
    | "object"
    | "array"
    | "null";
  description?: string;
  properties?: Record<string, TypeSchema>;
  required?: string[];
  items?: TypeSchema;
  additionalProperties?: boolean | TypeSchema;
  oneOf?: TypeSchema[];
}

// 自定义组件定义，存储在世界实体的 CustomComponentRegistry 中
export interface CustomComponentDef {
  component_key: string;
  component_name: string;
  is_array: boolean;
  data_registry?: Array<{
    item_id: string;
    data: any;
  }>;
  type_schema?: TypeSchema; // JSON Schema 格式
}

export interface Item {
  id: string;
  count: number;
  description: string;
  details: string[];
  equipped?: boolean;
  name: string; // 可选的物品名称，用于在UI中展示
}

export interface LocationRef {
  region_id: string;
  location_id: string;
}

export interface Industry {
  region_id: string;
  location_id: string;
  desc: string;
  details: string[];
}

export interface Location {
  id: string;
  name: string;
  description: string;
}

export interface Path {
  src_location: string;
  src_region: string;
  discovered: boolean;
  to_region: string; // region id
  to_location: string; // location id
  description: string;
}

export interface Relationship {
  target_creature_id: string;
  name: string;
  value: number;
}

// ============================================================================
// 游戏初始化
// ============================================================================

// GameTemplate:Initialize 服务不需要参数（数据已通过 SetInitialData 预设）
export interface GameInitializeInput {
  // 无参数
}

export interface GameInitializeOutput {
  success: boolean;
  error?: string;
}

// ============================================================================
// 玩家查询
// ============================================================================

export interface Creature {
  creature_id: string;
  name: string;
  organization_id?: string;
  titles: string[];
  appearance?: {
    body: string; // 身体特征描述
    clothing: string; // 穿着描述
  };
  gender?: string; // 性别描述
  race?: string; // 种族描述
  emotion?: string; // 当前情绪状态（自由文本）
  attrs: Attributes;
  known_infos: string[]; // 角色已知信息列表
  goal?: string; // 角色当前目标或意图
}

// 玩家状态组件， 现在什么都没有，因为这只是表明：玩家角色的组件，里面没有任何数据，有数据应该放在其他组件里
export interface IsPlayer {}

export interface Inventory {
  items: Item[];
}

export interface StatusEffects {
  status_effects: StatusEffect[];
}

export interface CustomComponents {
  custom_components: Array<{
    component_key: string;
    data: any;
  }>;
}

export interface Relationship_Component {
  relationships: Relationship[];
}

export interface BindSetting {
  documents: SettingDocument[]; // 该实体的设定文档列表
}

export interface PlayerEntityOutput {
  success: boolean;
  found: boolean;
  entity_id?: number;
  Creature?: Creature;
  IsPlayer?: IsPlayer;
  LocationRef?: LocationRef;
  Inventory?: Inventory;
  StatusEffects?: StatusEffects;
  CustomComponents?: CustomComponents;
  Relationship?: Relationship_Component;
  error?: string;
  Log: Log;
  BindSetting?: BindSetting;
}

// ============================================================================
// NPC 查询
// ============================================================================

export interface NPCEntity {
  entity_id: number;
  Creature: Creature;
  LocationRef?: LocationRef;
  Inventory?: Inventory;
  StatusEffects?: StatusEffects;
  CustomComponents?: CustomComponents;
  Relationship?: Relationship_Component;
  Log?: Log;
  BindSetting?: BindSetting;
}

export interface NPCEntitiesOutput {
  success: boolean;
  count: number;
  entities?: NPCEntity[];
  error?: string;
}

// ============================================================================
// 通用生物实体（兼容 Player 和 NPC）
// ============================================================================

export interface CreatureEntity {
  entity_id: number;
  is_player?: boolean;
  Creature?: Creature;
  LocationRef?: LocationRef;
  Inventory?: Inventory;
  StatusEffects?: StatusEffects;
  CustomComponents?: CustomComponents;
  Relationship?: Relationship_Component;
  Log?: Log;
  BindSetting?: BindSetting;
}

// ============================================================================
// 世界状态查询
// ============================================================================

export interface GameTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export interface CreatureAttrField {
  field_name: string;
  hint: string;
  field_display_name?: string; // 属性在UI中的显示名称
}

export interface Registry {
  creature_attr_fields?: CreatureAttrField[];
}

export interface CustomComponentRegistry {
  custom_components: CustomComponentDef[];
}

export interface DirectorNotes {
  notes: string[];
  flags: Record<string, { id: string; value: boolean; remark?: string }>;
  stage_goal?: string | null; // 阶段叙事目标，仅在需要更新时由 LLM 设置
}

export interface LogEntry {
  content: string;
  add_at: string; // 格式：YYYY年MM月DD日 HH:MM
}

export interface Log {
  entries: LogEntry[];
}

export interface StoryLine {
  current_story: Array<{
    speaker_creature_id?: string;
    speaker_name?: string;
    dialogue: string;
    narration: string;
  }>;
  choice?: {
    choices: Array<{
      description: string;
      difficulty_d100?: number;
      difficulty_d100_description?: string;
    }>;
  };
}

export interface WorldEntity {
  success: boolean;
  found: boolean;
  entity_id?: number;
  GameTime?: GameTime;
  Registry?: Registry;
  CustomComponentRegistry?: CustomComponentRegistry;
  DirectorNotes?: DirectorNotes;
  Log?: Log;
  //Entrys? : Entrys
  BindSetting?: BindSetting;
  Events?: { events: EventEntry[] };
  error?: string;
}

// ============================================================================
// 地域查询
// ============================================================================

export interface Metadata {
  name: string;
  desc: string;
}

export interface Region {
  region_id: string;
  region_name: string;
  description: string;
  locations?: Location[];
  paths?: Path[];
}

export interface RegionEntity {
  entity_id: number;
  Metadata?: Metadata;
  Region: Region;
  Log?: Log;
  BindSetting?: BindSetting;
}

export interface RegionEntitiesOutput {
  success: boolean;
  count: number;
  regions?: RegionEntity[];
  error?: string;
}

// ============================================================================
// 组织查询
// ============================================================================

export interface Organization {
  organization_id: string;
  name: string;
  territories?: Array<{
    region_id: string;
    location_id: string;
  }>;
  description: string;
}

export interface Secret {
  name: string;
  description: string;
  revealed: boolean;
  visible: boolean;
  auto_check: boolean;
  auto_reveal: boolean;
}

export interface OrganizationEntity {
  entity_id: number;
  Organization: Organization;
  // Inventory?: Inventory;
  Log?: Log;
  StatusEffects?: StatusEffects;
  BindSetting?: BindSetting;
}

export interface OrganizationEntitiesOutput {
  success: boolean;
  count: number;
  organizations?: OrganizationEntity[];
  error?: string;
}

// ============================================================================
// 存档数据类型（StateData）
// ============================================================================

// 世界实体快照
export interface WorldSnapshot {
  entity_id: number;
  GameTime?: GameTime;
  Registry?: Registry;
  DirectorNotes?: DirectorNotes;
  CustomComponentRegistry?: CustomComponentRegistry;
  Log?: Log;
  BindSetting?: BindSetting;
  Events?: { events: EventEntry[] };
}

// 角色实体快照（玩家或NPC）
export interface CreatureSnapshot {
  entity_id: number;
  Creature?: Creature;
  LocationRef?: LocationRef;
  Inventory?: Inventory;
  StatusEffects?: StatusEffects;
  CustomComponents?: CustomComponents;
  Relationship?: Relationship_Component;
  Log?: Log;
  IsPlayer?: IsPlayer;
  BindSetting?: BindSetting;
}

// 地域实体快照
export interface RegionSnapshot {
  entity_id: number;
  Metadata?: Metadata;
  Region?: Region;
  StatusEffects?: StatusEffects;
  Log?: Log;
  BindSetting?: BindSetting;
}

// 组织实体快照
export interface OrganizationSnapshot {
  entity_id: number;
  Organization?: Organization;
  // Inventory?: Inventory;
  StatusEffects?: StatusEffects;
  Log?: Log;
  BindSetting?: BindSetting;
}

// 设定文档
export interface SettingDocument {
  name: string; // 文档名称
  content: string;
  static_priority?: number; // 静态优先级，数值越高越优先
  disable?: boolean; // 是否禁用
  condition?: string; // 给LLM召回器的自然语言条件
}

// 剧情历史记录
export interface StoryHistoryEntry {
  turn_id: string; // 回合唯一标识符
  // 原先是：
  // story: any // 可序列化的剧情数据，格式由具体游戏定义
  story: {
    content: any; // 可序列化的剧情数据，格式由具体游戏定义
    checkpoint_id?: string; // 可选的存档ID，表示该剧情片段对应的存档检查点
  };
}

// 游戏开局故事
export interface GameInitialStory {
  background: string; // 玩家视角，看到的背景故事介绍
  start_story: string; // 整个游戏的开场剧情
}

export type GameWikiEntry =
  | Array<{
      title: string;
      content: string;
    }>
  | undefined;

export type AppInfo = {
  publish_type?: "EDITOR" | "INK" | "TEST" | "CUSTOM_TEMPLATE" | "CUSTOM"; // 默认为 EDITOR
};

// 开局选择项
export interface GameInitChoiceItem {
  id: string;
  name: string;
  description: string;
  player_creature_id: string;
  exclude_creature_ids?: string[];
  exclude_region_ids?: string[];
  exclude_organization_ids?: string[];
  background_story?: string;
  start_story?: string;
}

// 开局选择配置
export interface GameInitChoice {
  enable: boolean;
  choices: GameInitChoiceItem[];
}

// 完整游戏状态数据（用于存档/读档）
export interface StateData {
  World: WorldSnapshot;
  Creatures?: CreatureSnapshot[];
  Regions?: RegionSnapshot[];
  Organizations?: OrganizationSnapshot[];
  // SettingDocuments 已移除，设定文档现在存储在各实体的 BindSetting.documents 中
  StoryHistory?: StoryHistoryEntry[];
  GameInitialStory?: GameInitialStory;
  GameInitChoice?: GameInitChoice; // 开局角色/路线选择配置
  GameWikiEntry?: GameWikiEntry; // 新字段 游戏百科的词条数据
  AppInfo?: AppInfo; // 新字段 应用信息数据
  _save_version?: 'v2'; // 存档版本标记，v2 格式存档才可加载
}

/** 检查 StateData 是否带有 v2 版本标记 */
export function isV2SaveData(data: unknown): boolean {
  return !!data && typeof data === 'object' && '_save_version' in data && (data as any)._save_version === 'v2'
}

// GetGameState 服务输出
export interface GetGameStateOutput {
  success: boolean;
  data?: StateData;
  error?: string;
}

// LoadGameState 服务输入
export interface LoadGameStateInput {
  data: StateData;
}

// LoadGameState 服务输出
export interface LoadGameStateOutput {
  success: boolean;
  error?: string;
}

// ============================================================================
// 修改服务（暂未使用，但可以预定义）
// ============================================================================

export interface ModifyResult {
  success: boolean;
  error?: string;
}

export interface AddItemInput {
  creature_id: string;
  item_id: string;
  count?: number;
  item_description: string;
  item_details?: string[];
  equipped?: boolean;
}

export interface AddItemOutput extends ModifyResult {
  new_count?: number;
}

export interface RemoveItemInput {
  creature_id: string;
  item_id: string;
  count?: number;
}

export interface RemoveItemOutput extends ModifyResult {
  remaining?: number;
}

export interface SetAttributeInput {
  creature_id: string;
  attr_name: string;
  value: number | string;
}

export interface SetRelationshipInput {
  source_creature_id: string;
  target_creature_id: string;
  relationship_name: string;
  value: number;
}

export interface MoveCreatureInput {
  creature_id: string;
  region_id: string;
  location_id: string;
}

// ============================================================================
// 游戏初始化数据管理
// ============================================================================

export interface SettingDoc {
  path: string[];
  content: string;
}

export interface CreativeInnovation {
  name: string;
  description: string;
  usage_guide: string;
}

// ============================================================================
// 游戏概览服务
// ============================================================================

export interface RagConfig {
  enable_overview?: boolean; // 默认为真，如果启用，则会在AI生成时附加概览信息，只有当这个为真时，下列选项才会生效
  enable_auto_collector?: boolean; // 默认为真，启用后会使用 LLM Collector 功能从游戏资源中筛选相关内容进行RAG检索
  with_entity_overview?: boolean; // 默认为真，是否包含游戏ECS实体概览，这里面都是一些数值型状态
  with_component_types?: boolean; // 默认为真，是否包含组件类型列表，用于大模型理解各组件的数据结构
  with_systems_docs?: boolean; // 默认为假，是否包含系统服务文档，帮助大模型理解可调用的服务，一般只有在大模型需要【更新ECS状态时】才需要
  with_setting_docs?: boolean; // 默认为真，是否包含游戏设定集和各人物世界观，帮助大模型理解游戏背景和世界观
}

export interface GetGameOverviewInput {
  rag_config?: RagConfig;
  director_notes?: string[];
}

export interface GetGameOverviewRAGInput {
  prompt: string;
  rag_config?: RagConfig;
  director_notes?: string[];
}

// ============================================================================
// AI 内容生成服务
// ============================================================================

export interface GenerateContentInput {
  rag_config?: RagConfig;
  prompt: string;
  output_schema: any;
  model?: string;
  output_json?: boolean;
  system_prompt_id?: string;
}

/*
        collector_summary = Type.Optional(Type.String):desc("Collector 的决策摘要"),
        collector_decisions = Type.Optional(Type.Array(Type.Object({
            index = Type.Int:desc("资源编号"),
            path = Type.String:desc("资源路径"),
            selected = Type.Bool:desc("是否选中"),
            reason = Type.String:desc("选择或排除的原因")
        }))):desc("Collector 对每个资源的决策详情")
 */

export interface GenerateContentOutput {
  success: boolean;
  text?: string;
  collector_results?: Array<{
    entity_id: string;
    selected: boolean;
    thinking: string;
    documents?: Array<{
      path: string;
      selected: boolean;
      thinking: string;
    }>;
  }>;
  output?: any;
  error?: string;
}

export interface UpdateSettingDocsInput {
  newEvents: string; // 新增的剧情
}

/*
        success = Type.Bool:desc("是否成功"),
        thinking = Type.Optional(Type.String):desc("LLM 的思考过程"),
        patches_applied = Type.Optional(Type.Int):desc("应用的补丁数量"),
        patch = Type.Optional(Type.Array(Type.Object({
            path = Type.String:desc("文档路径"),
            mode = Type.String:desc("更新模式, append 表示追加，replace 表示替换"),
            toReplace = Type.Optional(Type.String):desc("如果是 replace 模式，表示要被替换的内容（支持正则）"),
            content = Type.String:desc("要追加或替换的内容")
        }))):desc("文档更新补丁列表"),
        error = Type.Optional(Type.String):desc("错误信息"),
 */
export interface UpdateSettingDocsOutput {
  success: boolean;
  thinking?: string;
  patches_applied?: number;
  patch?: Array<{
    path: string;
    mode: "append" | "replace";
    toReplace?: string;
    content: string;
  }>;
  error?: string;
}

// ============================================================================
// 故事生成服务
// ============================================================================

export interface StoryEntry {
  role: "player" | "gamemaster";
  content: string;
}

export interface GenerateStoryInput {
  history_storys: StoryEntry[];
  director_notes?: string[];
}

export interface StorySegment {
  speaker_creature_id?: string;
  speaker_name?: string;
  dialogue: string;
  narration: string;
}

export interface StoryChoice {
  description: string;
  difficulty_d100: number;
  difficulty_d100_description: string;
}

export interface GenerateStoryOutput {
  story: StorySegment[];
  choice?: {
    choices: StoryChoice[];
  };
  thinking?: string;
}

// ============================================================================
// 动作评估服务
// ============================================================================

export interface EvaluateActionDifficultyInput {
  history_storys: StoryEntry[];
  player_action: string;
  director_notes?: string[];
}

export interface EvaluateActionDifficultyOutput {
  difficulty_d100: number;
  difficulty_d100_description: string;
  is_feasible: boolean;
  infeasibility_reason?: string;
  thinking?: string;
}

// ============================================================================
// 动作解决服务
// ============================================================================

export interface DiceResult {
  success: boolean;
  roll_value: number;
  difficulty: number;
  description?: string;
}

export interface ResolveActionInput {
  history_storys: StoryEntry[];
  player_action: string;
  dice_result: DiceResult;
  director_notes?: string[];
}

export interface ResolveActionOutput {
  current_story: StorySegment[];
  lua_code: string;
  logs: string[];
  thinking?: string;
}

export interface SetNewStoryHistoryInput {
  turn_id: string;
  data: {
    content: any; // 可序列化的剧情数据，格式由具体游戏定义
    checkpoint_id?: string; // 可选的存档ID，表示该剧情片段对应的存档检查点
  };
}

export interface GetStoryHistoryOutput {
  success: boolean;
  data?: {
    turn_ids?: string[];
    story?: Record<
      string,
      {
        content: any; // 可序列化的剧情数据，格式由具体游戏定义
        checkpoint_id?: string; // 可选的存档ID，表示该剧情片段对应的存档检查点
      }
    >; // key: turn_id, value: data
  };
  error?: string;
}

export interface ClearStoryHistoryOutput {
  success: boolean;
  error?: string;
}

// ============================================================================
// 存档管理服务
// ============================================================================

// CreateGameSave - 创建游戏存档检查点
export interface CreateGameSaveInput {
  title?: string; // 存档标题
  description?: string; // 存档描述
}

export interface CreateGameSaveOutput {
  success: boolean;
  //checkpoint_id: string // 存档ID
  checkpointId: string; // 存档ID
  error?: string;
}

// LoadGameSave - 加载游戏存档检查点
export interface LoadGameSaveInput {
  //checkpoint_id: string // 存档检查点ID
  checkpointId: string; // 存档检查点ID
}

export interface LoadGameSaveOutput {
  success: boolean;
  error?: string;
}

// ListGameSaves - 列出所有游戏存档检查点
export interface ListGameSavesInput {
  // 无参数
}

export interface GameSaveInfo {
  // checkpoint_id: string // 存档ID
  checkpointId: string; // 存档ID
  title: string; // 存档标题
  description: string; // 存档描述
  timestamp: number; // 存档创建时间
}

export interface ListGameSavesOutput {
  saves: GameSaveInfo[]; // 存档列表
}

// =================== 发布服务 =========================

export interface GetAppInfoOutput {
  success: boolean;
  data?: AppInfo;
  error?: string;
}

export interface SetAppInfoInput {
  data: AppInfo;
}

export interface SetAppInfoOutput {
  success: boolean;
  error?: string;
}

export interface PublishAppInput {
  // 目前无参数，自动使用游戏状态中的 AppInfo
}

export interface PublishAppOutput {
  success: boolean;
  error?: string;
  //artifact_id?: string // 发布后的应用ID
  artifactId?: string; // 发布后的应用ID
}

export interface PublishCheckpointInput {
  checkpointId?: string; // 存档ID
  isListed?: boolean; // 存档是否公开
}

export interface PublishCheckpointOutput {
  success: boolean;
  error?: string;
}

export interface PublishArticleInput {
  title?: string; // 文章标题
  content: Array<
    | {
        type: "text";
        id: string; // 如果是文本块，则是文本块的ID
        text: string; // 如果是文本块，则是文本内容,
      }
    | {
        type: "game_ref";
        textId: string; // 如果是游戏存档引用块，则是对应的文本块ID
        //checkpoint_id: string, // 游戏存档引用块对应的存档ID
        checkpointId: string; // 游戏存档引用块对应的存档ID
      }
  >; // 文章内容
  visibility?: "PUBLIC" | "PRIVATE" | "UNLISTED"; // 文章可见性
}

export interface PublishArticleOutput {
  success: boolean;
  error?: string;
  articleId?: string; // 发布后的文章ID
}

// ============================================================================
// LLM API 配置服务
// ============================================================================

export interface LLMConfig {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  apiKey?: string;
  baseUrl?: string;
  organizationId?: string;
  reasoning?: {
    effort?: "none" | "minimal" | "low" | "medium" | "high"; // 推理努力程度
    summary?: "auto" | "concise" | "detailed"; // 推理总结程度
  };
}

export interface SetAPIConfigInput {
  retrievalModel?: LLMConfig; // 召回模型配置
  generationModel?: LLMConfig; // 生成模型配置
  updateModel?: LLMConfig; // 更新世界状态的模型配置
}

export interface SetAPIConfigOutput {
  success?: boolean;
}

// ============================================================================
// AI Copilot 编辑助手类型定义
// ============================================================================

// Copilot API 配置
export interface CopilotModelConfig {
  model: string;
  apiKey: string;
  baseUrl: string;
  temperature?: number;
  maxTokens?: number;
  reasoning?: {
    effort?: "none" | "minimal" | "low" | "medium" | "high";
    summary?: "auto" | "concise" | "detailed";
  };
}

export interface CopilotConfig {
  primaryModel: CopilotModelConfig; // 主模型（用于主对话），映射自 APIConfig 的生成模型
  secondaryModel: CopilotModelConfig; // 次级模型（用于 fileAgent），映射自 APIConfig 的召回模型
  updateModel?: CopilotModelConfig; // 更新模型（用于快速模式），映射自 APIConfig 的更新模型
}

// Copilot 工具定义
export type CopilotToolName =
  | "get_state_overview"
  | "check_state_error"
  | "get_game_creation_checklist"
  // Workspace File 工具
  | "list_workspace_files"
  | "get_workspace_file_content"
  | "use_workspace_file_agent"
  // State 工具
  | "get_state_content"
  | "update_state_with_javascript"
  // Skill 工具（只读知识库）
  | "list_skills"
  | "get_skill_content"
  // WorkingMemory 工具（可变工作记忆）
  | "list_memories"
  | "get_memory_content"
  | "save_memory"
  | "delete_memory"
  // 用户交互
  | "query_user";

// getStateOverview 工具参数（无参数）
export interface GetStateOverviewParams {
  // 无参数
}

// listFiles 工具参数（无参数）
export interface ListFilesParams {
  // 无参数
}

// readFile 工具参数
export interface ReadFileParams {
  filename: string; // 文件名
}

// useFileAgent 工具参数
export interface UseFileAgentParams {
  filename: string; // 上传的文件名
  instruction: string; // 给小模型的指令
}

// 上传的文件
export interface UploadedFile {
  name: string;
  content: string; // 文本文件内容（图片为空字符串）
  type: "md" | "json" | "txt" | "image";
  size: number;
  uploadedAt: number;
  detectedEncoding?: string; // 检测到的编码（如 GBK、UTF-8 等）
  dataUrl?: string; // 图片 base64 data URL (data:image/png;base64,...)
  mimeType?: string; // 图片 MIME 类型 (image/png, image/jpeg, ...)
}

// ============================================================================
// Skill 系统（不可变知识库 - 内置 + 用户自定义）
// ============================================================================

// 存储用 Skill 结构
export interface StoredSkill {
  id: string;
  title: string;
  description?: string; // 简短描述，告诉 AI 何时该使用此 Skill
  content: string; // Markdown 格式内容
  isBuiltIn: boolean; // 内置 Skill 不可被 AI/用户删除
  createdAt: number;
  updatedAt: number;
}

// getSkillContent 工具参数
export interface GetSkillContentParams {
  id: string; // Skill ID
}

// ============================================================================
// WorkingMemory 系统（可变工作记忆 - AI 读写）
// ============================================================================

// 存储用 WorkingMemory 结构
export interface StoredMemory {
  id: string;
  title: string;
  content: string; // Markdown 格式内容
  createdAt: number;
  updatedAt: number;
}

// getMemoryContent 工具参数
export interface GetMemoryContentParams {
  id: string; // Memory ID
}

// saveMemory 工具参数
export interface SaveMemoryParams {
  id?: string; // 不提供则创建新记忆
  title: string; // 标题
  content: string; // 内容
}

// deleteMemory 工具参数
export interface DeleteMemoryParams {
  id: string; // Memory ID
}

// runJavascriptCode 工具参数
export interface RunJavascriptCodeParams {
  code: string; // 要执行的 JavaScript 代码
  timeout?: number; // 执行超时（毫秒），默认 5000
}

// runJavascriptCode 执行结果
export interface RunJavascriptCodeResult {
  success: boolean;
  result?: any; // 代码执行返回值
  logs?: string[]; // console.log 输出
  error?: string; // 错误信息
}

// getStateContent 工具参数
export interface GetStateContentParams {
  path: string; // 如 "Creatures", "World.Registry", "Regions[0].Region"
}

// updateStateWithJavascript 工具参数
export interface UpdateStateWithJavascriptParams {
  code: string; // JavaScript 代码，可直接读写 state 对象
}

// Copilot 聊天消息
export interface CopilotMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls?: Array<{
    id: string;
    name: CopilotToolName;
    arguments: string;
    result?: string; // 工具执行结果（用于持久化）
    thought_signature?: string; // Gemini 3.0 思考签名（必须在后续请求中回传）
  }>;
  toolCallId?: string; // 用于 tool 角色的消息
  timestamp: number;
  isStreaming?: boolean;
}

// Copilot 聊天会话
export interface CopilotChatSession {
  id: string;
  title: string;
  messages: CopilotMessage[];
  createdAt: number;
  updatedAt: number;
}

// Copilot 流式事件
export type CopilotStreamEvent =
  | { type: "text_delta"; delta: string }
  | { type: "tool_call_start"; toolCallId: string; toolName: CopilotToolName }
  | { type: "tool_call_delta"; toolCallId: string; delta: string }
  | { type: "tool_call_end"; toolCallId: string; thought_signature?: string }
  | { type: "done" }
  | { type: "error"; error: string };
