import type {
  StateData,
  WorldSnapshot,
  CreatureSnapshot,
  RegionSnapshot,
  OrganizationSnapshot,
  SettingDocument,
  GameWikiEntry,
  StoryHistoryEntry,
  Attributes,
  GameTime,
  CustomComponentDef,
  BindSetting
} from '../../api/types'
import type { GameInitialStory } from '../../api/types'
import i18next from 'i18next'

// ============================================================================
// 编辑器专用类型定义
// ============================================================================

export type TabType = 'world' | 'creatures' | 'regions' | 'organizations' | 'initial-story' | 'story-history' | 'wiki'

export interface EditorProps {
  onSaveState: (data: StateData) => Promise<void>
  onLoadState: () => Promise<StateData | null>
  onListSaves?: () => Promise<Array<{ checkpointId: string; metadata?: any }>>
  onLoadSave?: (checkpointId: string) => Promise<void>
  onDeleteSave?: (checkpointId: string) => Promise<void>
  onClearSaves?: () => Promise<void>
  onPublishApp?: () => Promise<{ success: boolean; error?: string; artifactId?: string }>
  /** 游戏模式下禁用导入相关按钮 */
  disableImport?: boolean
  /** 覆盖层模式：点击启动游戏时回调（保存数据后关闭覆盖层），不启动嵌套游戏 */
  onLaunchGame?: () => Promise<void>
}

// 验证错误类型
export interface ValidationError {
  path: string
  message: string
  severity: 'error' | 'warning'
}

// JSON Schema 类型定义（简化版，用于前端编辑）
export interface TypeSchema {
  type?: 'string' | 'integer' | 'number' | 'boolean' | 'object' | 'array' | 'null'
  description?: string
  properties?: Record<string, TypeSchema>
  required?: string[]
  items?: TypeSchema
  additionalProperties?: boolean | TypeSchema
  oneOf?: TypeSchema[]
}

// ============================================================================
// 默认值
// ============================================================================

// 默认属性值（动态属性，初始值为空 Record）
export const DEFAULT_ATTRS: Attributes = {}

// 默认游戏时间
export const DEFAULT_GAME_TIME: GameTime = {
  year: 1,
  month: 1,
  day: 1,
  hour: 0,
  minute: 0
}

// 创建空的世界快照
export const createEmptyWorld = (): WorldSnapshot => ({
  entity_id: 1,
  GameTime: { ...DEFAULT_GAME_TIME },
  Registry: {},
  DirectorNotes: {
    notes: [],
    flags: {}
  },
  CustomComponentRegistry: {
    custom_components: []
  },
  Log: {
    entries: []
  }
})

// ============================================================================
// 工具函数
// ============================================================================

export const luaList = <T>(v: T[] | undefined | null | Record<string, never>): T[] => {
  return Array.isArray(v) ? v : [];
};
// 根据 Schema 获取默认值
export const getDefaultValueForSchema = (schema: TypeSchema): any => {
  switch (schema.type) {
    case 'string': return ''
    case 'number': return 0
    case 'integer': return 0
    case 'boolean': return false
    case 'object':
      const obj: Record<string, any> = {}
      // 为必需属性生成默认值
      if (schema.properties && schema.required) {
        luaList<string>(schema.required).forEach(key => {
          if (schema.properties![key]) {
            obj[key] = getDefaultValueForSchema(schema.properties![key])
          }
        })
      }
      return Object.keys(obj).length > 0 ? obj : {}
    case 'array': return []
    case 'null': return null
    default: return undefined
  }
}

// 生成唯一ID
export const generateUniqueId = (prefix: string): string => `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

// ============================================================================
// 数据验证函数
// ============================================================================

export const validateStateData = (data: StateData): ValidationError[] => {
  const errors: ValidationError[] = []
  
  // 验证世界数据
  if (!data.World) {
    errors.push({ path: 'World', message: i18next.t('editor:validation.missingWorld'), severity: 'error' })
  } else {
    if (!data.World.GameTime) {
      errors.push({ path: 'World.GameTime', message: i18next.t('editor:validation.missingGameTime'), severity: 'warning' })
    }
    
    // 验证自定义组件
    const componentKeys = new Set<string>();
    luaList<CustomComponentDef>(data.World.CustomComponentRegistry?.custom_components).forEach((def, index) => {
      if (!def.component_key) {
        errors.push({ path: `World.CustomComponentRegistry.custom_components[${index}]`, message: i18next.t('editor:validation.missingComponentKey'), severity: 'error' })
      } else if (componentKeys.has(def.component_key)) {
        errors.push({ path: `World.CustomComponentRegistry.custom_components[${index}]`, message: i18next.t('editor:validation.duplicateComponentKey', { key: def.component_key }), severity: 'error' })
      } else {
        componentKeys.add(def.component_key)
      }
    })
  }
  
  // 验证生物
  const creatureIds = new Set<string>();
  luaList<CreatureSnapshot>(data.Creatures).forEach((creature, index) => {
    const creatureId = creature.Creature?.creature_id
    if (!creatureId) {
      errors.push({ path: `Creatures[${index}]`, message: i18next.t('editor:validation.missingCreatureId'), severity: 'error' })
    } else if (creatureIds.has(creatureId)) {
      errors.push({ path: `Creatures[${index}]`, message: i18next.t('editor:validation.duplicateCreatureId', { id: creatureId }), severity: 'error' })
    } else {
      creatureIds.add(creatureId)
    }
    // 检查名称
    if (!creature.Creature?.name) {
      errors.push({ path: `Creatures[${index}]`, message: i18next.t('editor:validation.missingCreatureName'), severity: 'warning' })
    }
  })
  
  // 验证地区
  const regionIds = new Set<string>();
  luaList<RegionSnapshot>(data.Regions).forEach((region, index) => {
    const regionId = region.Region?.region_id
    if (!regionId) {
      errors.push({ path: `Regions[${index}]`, message: i18next.t('editor:validation.missingRegionId'), severity: 'error' })
    } else if (regionIds.has(regionId)) {
      errors.push({ path: `Regions[${index}]`, message: i18next.t('editor:validation.duplicateRegionId', { id: regionId }), severity: 'error' })
    } else {
      regionIds.add(regionId)
    }
  })
  
  // 验证组织
  const orgIds = new Set<string>();
  luaList<OrganizationSnapshot>(data.Organizations).forEach((org, index) => {
    const orgId = org.Organization?.organization_id
    if (!orgId) {
      errors.push({ path: `Organizations[${index}]`, message: i18next.t('editor:validation.missingOrgId'), severity: 'error' })
    } else if (orgIds.has(orgId)) {
      errors.push({ path: `Organizations[${index}]`, message: i18next.t('editor:validation.duplicateOrgId', { id: orgId }), severity: 'error' })
    } else {
      orgIds.add(orgId)
    }
  })
  
  return errors
}
