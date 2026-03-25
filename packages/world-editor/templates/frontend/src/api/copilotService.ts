import type {
  StateData,
  CopilotConfig,
  CopilotModelConfig,
  UploadedFile,
  StoredSkill,
  StoredMemory,
} from './types'
import { sandboxExecutor } from './sandboxExecutor'
import { loadAPIConfigFromStorage } from '../components/APIConfigModal'
import { IMAGE_EXTENSIONS } from './imageUtils'
import i18next from 'i18next'

// ============================================================================
// Constants and Configuration
// ============================================================================

const COPILOT_SKILLS_STORAGE_KEY = 'copilot-skills'

// ============================================================================
// IndexedDB Storage for Chat Sessions & Working Memory
// ============================================================================

const COPILOT_DB_NAME = 'copilot-storage'
const COPILOT_DB_VERSION = 3
const SESSIONS_STORE = 'chat-sessions'
const MEMORIES_STORE = 'working-memory'
const FILES_STORE = 'uploaded-files'
const LOREBOOKS_STORE = 'uploaded-lorebooks'

// In-memory caches (sync reads, async persistence)
let _sessionsCache: CopilotChatSession[] = []
let _memoriesCache: StoredMemory[] = []
let _filesCache: UploadedFile[] = []
let _lorebooksCache: import('./worldBuilderNextTypes').LorebookData[] = []
let _currentSessionId: string | null = null
let _dbInitialized = false

function openCopilotDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(COPILOT_DB_NAME, COPILOT_DB_VERSION)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
        db.createObjectStore(SESSIONS_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(MEMORIES_STORE)) {
        db.createObjectStore(MEMORIES_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(FILES_STORE)) {
        db.createObjectStore(FILES_STORE, { keyPath: 'name' })
      }
      if (!db.objectStoreNames.contains(LOREBOOKS_STORE)) {
        db.createObjectStore(LOREBOOKS_STORE, { keyPath: 'filename' })
      }
    }
  })
}

function idbPut(storeName: string, record: unknown): void {
  openCopilotDB().then(db => {
    const tx = db.transaction(storeName, 'readwrite')
    tx.objectStore(storeName).put(record)
  }).catch(e => console.error(`IDB put ${storeName}:`, e))
}

function idbDelete(storeName: string, key: string): void {
  openCopilotDB().then(db => {
    const tx = db.transaction(storeName, 'readwrite')
    tx.objectStore(storeName).delete(key)
  }).catch(e => console.error(`IDB delete ${storeName}:`, e))
}

function idbClear(storeName: string): void {
  openCopilotDB().then(db => {
    const tx = db.transaction(storeName, 'readwrite')
    tx.objectStore(storeName).clear()
  }).catch(e => console.error(`IDB clear ${storeName}:`, e))
}

async function idbGetAll<T>(storeName: string): Promise<T[]> {
  const db = await openCopilotDB()
  const tx = db.transaction(storeName, 'readonly')
  const request = tx.objectStore(storeName).getAll()
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as T[])
    request.onerror = () => reject(request.error)
  })
}

/**
 * Initialize chat sessions & working memory from IndexedDB into memory cache.
 * Call once on app startup; returns a promise that resolves when caches are ready.
 */
export async function initCopilotDB(): Promise<{ sessions: CopilotChatSession[]; memories: StoredMemory[]; files: UploadedFile[] }> {
  if (_dbInitialized) return { sessions: _sessionsCache, memories: _memoriesCache, files: _filesCache }
  try {
    const [sessions, memories, files, lorebooks] = await Promise.all([
      idbGetAll<CopilotChatSession>(SESSIONS_STORE),
      idbGetAll<StoredMemory>(MEMORIES_STORE),
      idbGetAll<UploadedFile>(FILES_STORE),
      idbGetAll<import('./worldBuilderNextTypes').LorebookData>(LOREBOOKS_STORE),
    ])
    // Sort sessions: newest first
    sessions.sort((a, b) => b.updatedAt - a.updatedAt)
    _sessionsCache = sessions
    _memoriesCache = memories
    _filesCache = files
    _lorebooksCache = lorebooks
    // Restore current session id from localStorage (tiny value, fine to keep there)
    _currentSessionId = localStorage.getItem('copilot-current-session-id')
  } catch (e) {
    console.error('Failed to init copilot DB:', e)
  }
  _dbInitialized = true
  return { sessions: _sessionsCache, memories: _memoriesCache, files: _filesCache }
}


// ============================================================================
// 配置管理（从 APIConfigModal 统一读取）
// ============================================================================

/**
 * 从 APIConfigModal 的 localStorage 配置映射为 CopilotConfig
 * generationModel → primaryModel, retrievalModel → secondaryModel
 */
export function loadCopilotConfigFromAPIConfig(): CopilotConfig {
  const apiConfig = loadAPIConfigFromStorage()
  const gen = apiConfig.generationModel
  const ret = apiConfig.retrievalModel

  const primaryModel: CopilotModelConfig = {
    model: gen?.model || '',
    apiKey: gen?.apiKey || '',
    baseUrl: gen?.baseUrl || '',
    temperature: gen?.temperature,
    maxTokens: gen?.maxTokens,
    reasoning: gen?.reasoning,
  }

  // secondaryModel 回退到 primaryModel（与原有行为一致）
  const secondaryModel: CopilotModelConfig = {
    model: ret?.model || primaryModel.model,
    apiKey: ret?.apiKey || primaryModel.apiKey,
    baseUrl: ret?.baseUrl || primaryModel.baseUrl,
    temperature: ret?.temperature ?? primaryModel.temperature,
    maxTokens: ret?.maxTokens ?? primaryModel.maxTokens,
    reasoning: ret?.reasoning ?? primaryModel.reasoning,
  }

  return { primaryModel, secondaryModel }
}

// ============================================================================
// File Management
// ============================================================================

/**
 * Load uploaded files from in-memory cache
 */
export function loadUploadedFiles(): UploadedFile[] {
  return _filesCache
}

/**
 * Add an uploaded file (text or image)
 */
export function addUploadedFile(file: UploadedFile): UploadedFile[] {
  const existingIndex = _filesCache.findIndex(f => f.name === file.name)
  if (existingIndex >= 0) {
    _filesCache[existingIndex] = file
  } else {
    _filesCache.push(file)
  }
  idbPut(FILES_STORE, file)
  return _filesCache
}

/**
 * Remove an uploaded file
 */
export function removeUploadedFile(filename: string): UploadedFile[] {
  _filesCache = _filesCache.filter(f => f.name !== filename)
  idbDelete(FILES_STORE, filename)
  return _filesCache
}

/**
 * Clear all uploaded files
 */
export function clearUploadedFiles(): void {
  _filesCache = []
  idbClear(FILES_STORE)
}

// ============================================================================
// Lorebook CRUD (parallel to file CRUD)
// ============================================================================

export function loadLorebooks(): import('./worldBuilderNextTypes').LorebookData[] {
  return _lorebooksCache
}

export function addLorebook(lb: import('./worldBuilderNextTypes').LorebookData): void {
  const idx = _lorebooksCache.findIndex(l => l.filename === lb.filename)
  if (idx >= 0) {
    _lorebooksCache[idx] = lb
  } else {
    _lorebooksCache.push(lb)
  }
  idbPut(LOREBOOKS_STORE, lb)
}

export function removeLorebook(filename: string): void {
  _lorebooksCache = _lorebooksCache.filter(l => l.filename !== filename)
  idbDelete(LOREBOOKS_STORE, filename)
}

export function clearLorebooks(): void {
  _lorebooksCache = []
  idbClear(LOREBOOKS_STORE)
}

/**
 * Get file type
 */
export function getFileType(filename: string): 'md' | 'json' | 'txt' | 'image' | null {
  const ext = filename.split('.').pop()?.toLowerCase()
  if (ext === 'md') return 'md'
  if (ext === 'json') return 'json'
  if (ext === 'txt') return 'txt'
  if (IMAGE_EXTENSIONS.includes(ext || '')) return 'image'
  return null
}

// ============================================================================
// Skill Management (Immutable Knowledge Base)
// ============================================================================

/**
 * Load Skills from localStorage
 */
export function loadSkills(): StoredSkill[] {
  try {
    const saved = localStorage.getItem(COPILOT_SKILLS_STORAGE_KEY)
    if (saved) {
      return JSON.parse(saved)
    }
  } catch (e) {
    console.error('Failed to load skills:', e)
  }
  return []
}

/**
 * Save Skills to localStorage
 */
export function saveSkills(skills: StoredSkill[]): void {
  try {
    localStorage.setItem(COPILOT_SKILLS_STORAGE_KEY, JSON.stringify(skills))
  } catch (e) {
    console.error('Failed to save skills:', e)
  }
}

/**
 * Get a single Skill by ID
 */
export function getSkill(id: string): StoredSkill | undefined {
  return loadSkills().find(s => s.id === id)
}

/**
 * Generate unique Skill ID for user-created skills
 */
function generateSkillId(): string {
  return `skill_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Create a user-defined Skill
 */
export function createUserSkill(title: string, content: string, description?: string): StoredSkill {
  const now = Date.now()
  const skill: StoredSkill = {
    id: generateSkillId(),
    title,
    description,
    content,
    isBuiltIn: false,
    createdAt: now,
    updatedAt: now
  }
  const skills = loadSkills()
  skills.push(skill)
  saveSkills(skills)
  return skill
}

/**
 * Update a user-defined Skill
 */
export function updateUserSkill(
  id: string,
  updates: { title?: string; description?: string; content?: string }
): StoredSkill | null {
  const skills = loadSkills()
  const index = skills.findIndex(s => s.id === id)
  if (index < 0) return null

  const skill = skills[index]
  
  // Built-in skills cannot be modified
  if (skill.isBuiltIn) {
    console.warn('Cannot modify built-in skill')
    return null
  }
  
  if (updates.title !== undefined) skill.title = updates.title
  if (updates.description !== undefined) skill.description = updates.description
  if (updates.content !== undefined) skill.content = updates.content
  skill.updatedAt = Date.now()

  skills[index] = skill
  saveSkills(skills)
  return skill
}

/**
 * Delete a user-defined Skill
 */
export function deleteUserSkill(id: string): boolean {
  const skills = loadSkills()
  const skill = skills.find(s => s.id === id)
  
  // Built-in skills cannot be deleted
  if (skill?.isBuiltIn) {
    console.warn('Cannot delete built-in skill')
    return false
  }
  
  const filtered = skills.filter(s => s.id !== id)
  if (filtered.length === skills.length) return false
  saveSkills(filtered)
  return true
}

/**
 * Export user-defined skills as JSON
 */
export function exportUserSkills(): string {
  const skills = loadSkills().filter(s => !s.isBuiltIn)
  return JSON.stringify(skills, null, 2)
}

/**
 * Export a single skill as a portable JSON object
 */
export function exportSkill(id: string): { title: string; description: string; content: string } | null {
  const skill = getSkill(id)
  if (!skill) return null
  return {
    title: skill.title,
    description: skill.description || '',
    content: skill.content
  }
}

/**
 * Import a single skill from a JSON object
 */
export function importSkill(data: { title?: string; description?: string; content?: string }): StoredSkill | null {
  if (!data.title || !data.content) return null
  return createUserSkill(data.title, data.content, data.description)
}

/**
 * Import user-defined skills from JSON
 */
export function importUserSkills(jsonString: string): { imported: number; errors: string[] } {
  const errors: string[] = []
  let imported = 0
  
  try {
    const data = JSON.parse(jsonString)
    const skillsToImport = Array.isArray(data) ? data : [data]
    const existingSkills = loadSkills()
    
    for (const item of skillsToImport) {
      if (!item.title || !item.content) {
        errors.push(`Skipped skill: missing title or content`)
        continue
      }
      
      const now = Date.now()
      const newSkill: StoredSkill = {
        id: generateSkillId(),
        title: item.title,
        description: item.description || '',
        content: item.content,
        isBuiltIn: false,
        createdAt: now,
        updatedAt: now
      }
      existingSkills.push(newSkill)
      imported++
    }
    
    saveSkills(existingSkills)
  } catch (e) {
    errors.push(`JSON parse error: ${(e as Error).message}`)
  }
  
  return { imported, errors }
}

// ============================================================================
// WorkingMemory Management (Mutable AI Working Notes)
// ============================================================================

/**
 * Generate unique Memory ID
 */
function generateMemoryId(): string {
  return `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Load Memories from in-memory cache
 */
export function loadMemories(): StoredMemory[] {
  return _memoriesCache
}

/**
 * Save Memories - update cache + persist to IndexedDB
 */
export function saveMemories(memories: StoredMemory[]): void {
  _memoriesCache = memories
  // Full replace: clear then put all
  idbClear(MEMORIES_STORE)
  for (const m of memories) idbPut(MEMORIES_STORE, m)
}

/**
 * Get a single Memory by ID
 */
export function getMemory(id: string): StoredMemory | undefined {
  return loadMemories().find(m => m.id === id)
}

/**
 * Create a new Memory
 */
export function createMemory(title: string, content: string): StoredMemory {
  const now = Date.now()
  const memory: StoredMemory = {
    id: generateMemoryId(),
    title,
    content,
    createdAt: now,
    updatedAt: now
  }
  _memoriesCache.push(memory)
  idbPut(MEMORIES_STORE, memory)
  return memory
}

/**
 * Update a Memory
 */
export function updateMemory(
  id: string,
  updates: { title?: string; content?: string }
): StoredMemory | null {
  const index = _memoriesCache.findIndex(m => m.id === id)
  if (index < 0) return null

  const memory = _memoriesCache[index]
  if (updates.title !== undefined) memory.title = updates.title
  if (updates.content !== undefined) memory.content = updates.content
  memory.updatedAt = Date.now()

  _memoriesCache[index] = memory
  idbPut(MEMORIES_STORE, memory)
  return memory
}

/**
 * Delete a Memory
 */
export function deleteMemory(id: string): boolean {
  const filtered = _memoriesCache.filter(m => m.id !== id)
  if (filtered.length === _memoriesCache.length) return false
  _memoriesCache = filtered
  idbDelete(MEMORIES_STORE, id)
  return true
}

/**
 * Clear all Memories
 */
export function clearMemories(): void {
  _memoriesCache = []
  idbClear(MEMORIES_STORE)
}

// ============================================================================
// Chat Session Management
// ============================================================================

import type { CopilotChatSession } from './types'
import {
  BUILTIN_STATEDATA_SCHEMA,
  BUILTIN_WORKFLOW,
  BUILTIN_SETTING_DOCS,
  BUILTIN_GAME_CREATION,
} from './copilotPrompt'

// 内置 Skill IDs
export const BUILTIN_SKILL_IDS = {
  WORKFLOW: 'builtin_workflow',
  SETTING_DOCS: 'builtin_setting_docs',
  STATEDATA_SCHEMA: 'builtin_statedata_schema',
  GAME_CREATION: 'builtin_game_creation'
} as const

// Built-in Skill definitions (function to allow i18next runtime resolution)
function getBuiltinSkillsConfig(): Array<{
  id: string
  title: string
  description: string
  content: string
}> {
  const t = i18next.t.bind(i18next)
  return [
    {
      id: BUILTIN_SKILL_IDS.WORKFLOW,
      title: t('builtinSkills.workflowTitle', { ns: 'copilot', defaultValue: '[Built-in] Workflow' }),
      description: t('builtinSkills.workflowDesc', { ns: 'copilot', defaultValue: 'User request processing workflow (references other Skills, read first when receiving requests)' }),
      content: BUILTIN_WORKFLOW
    },
    {
      id: BUILTIN_SKILL_IDS.SETTING_DOCS,
      title: t('builtinSkills.settingDocsTitle', { ns: 'copilot', defaultValue: '[Built-in] Setting Docs Writing' }),
      description: t('builtinSkills.settingDocsDesc', { ns: 'copilot', defaultValue: 'Setting document writing methods, templates and priority system' }),
      content: BUILTIN_SETTING_DOCS
    },
    {
      id: BUILTIN_SKILL_IDS.STATEDATA_SCHEMA,
      title: '[Built-in] StateData Schema',
      description: t('builtinSkills.stateDataSchemaDesc', { ns: 'copilot', defaultValue: 'StateData complete type definitions and field descriptions' }),
      content: BUILTIN_STATEDATA_SCHEMA
    },
    {
      id: BUILTIN_SKILL_IDS.GAME_CREATION,
      title: t('builtinSkills.gameCreationTitle', { ns: 'copilot', defaultValue: '[Built-in] Game Idea Implementation' }),
      description: t('builtinSkills.gameCreationDesc', { ns: 'copilot', defaultValue: 'How to implement a game idea (including Status system usage and quick start)' }),
      content: BUILTIN_GAME_CREATION
    }
  ]
}

/**
 * Initialize built-in Skills
 * Ensures system built-in reference documents always exist
 */
export function initializeBuiltInSkills(): void {
  const skills = loadSkills()
  const now = Date.now()
  let needsSave = false

  for (const config of getBuiltinSkillsConfig()) {
    const existing = skills.find(s => s.id === config.id)
    if (!existing) {
      skills.push({
        id: config.id,
        title: config.title,
        description: config.description,
        content: config.content,
        isBuiltIn: true,
        createdAt: now,
        updatedAt: now
      })
      needsSave = true
    } else if (existing.content !== config.content || existing.title !== config.title || existing.description !== config.description) {
      // Update built-in Skill content/title/description (if updated or language changed)
      existing.content = config.content
      existing.title = config.title
      existing.description = config.description
      existing.updatedAt = now
      needsSave = true
    }
  }

  if (needsSave) {
    saveSkills(skills)
    console.log('Initialized/Updated built-in skills')
  }
}

const COPILOT_CURRENT_SESSION_KEY = 'copilot-current-session-id'

/**
 * Generate unique session ID
 */
function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Load all chat sessions from in-memory cache
 */
export function loadChatSessions(): CopilotChatSession[] {
  return _sessionsCache
}

/**
 * Get current session ID
 */
export function getCurrentSessionId(): string | null {
  return _currentSessionId
}

/**
 * Set current session ID
 */
export function setCurrentSessionId(id: string | null): void {
  _currentSessionId = id
  if (id) {
    localStorage.setItem(COPILOT_CURRENT_SESSION_KEY, id)
  } else {
    localStorage.removeItem(COPILOT_CURRENT_SESSION_KEY)
  }
}

/**
 * Get a single chat session
 */
export function getChatSession(id: string): CopilotChatSession | undefined {
  return _sessionsCache.find(s => s.id === id)
}

/**
 * Create a new chat session
 */
export function createChatSession(title?: string): CopilotChatSession {
  const now = Date.now()
  const session: CopilotChatSession = {
    id: generateSessionId(),
    title: title || `Chat ${new Date(now).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
    messages: [],
    createdAt: now,
    updatedAt: now
  }
  _sessionsCache.unshift(session)
  idbPut(SESSIONS_STORE, session)
  setCurrentSessionId(session.id)
  return session
}

/**
 * Update a chat session
 */
export function updateChatSession(id: string, updates: Partial<Pick<CopilotChatSession, 'title' | 'messages'>>): CopilotChatSession | null {
  const index = _sessionsCache.findIndex(s => s.id === id)
  if (index < 0) return null

  const session = _sessionsCache[index]
  if (updates.title !== undefined) session.title = updates.title
  if (updates.messages !== undefined) session.messages = updates.messages
  session.updatedAt = Date.now()

  _sessionsCache[index] = session
  idbPut(SESSIONS_STORE, session)
  return session
}

/**
 * Delete a chat session
 */
export function deleteChatSession(id: string): boolean {
  const filtered = _sessionsCache.filter(s => s.id !== id)
  if (filtered.length === _sessionsCache.length) return false
  _sessionsCache = filtered
  idbDelete(SESSIONS_STORE, id)

  if (getCurrentSessionId() === id) {
    setCurrentSessionId(filtered.length > 0 ? filtered[0].id : null)
  }
  return true
}

/**
 * Clear all chat sessions
 */
export function clearChatSessions(): void {
  _sessionsCache = []
  idbClear(SESSIONS_STORE)
  setCurrentSessionId(null)
}

// ============================================================================
// Tool Execution
// ============================================================================

/**
 * Truncate long text
 */
function truncateText(text: string, maxLength: number = 50): string {
  if (!text || text.length <= maxLength) return text
  return text.substring(0, maxLength) + '...'
}

/**
 * Generate state overview
 */
function generateStateOverview(state: StateData): string {
  const lines: string[] = []
  
  // World information
  lines.push('## World')
  if (state.World) {
    if (state.World.GameTime) {
      const t = state.World.GameTime
      lines.push(`- Game Time: Year ${t.year}, Month ${t.month}, Day ${t.day}, ${t.hour}:${String(t.minute).padStart(2, '0')}`)
    }
    if (state.World.Registry) {
      const r = state.World.Registry
      lines.push(`- Attr Fields: ${r.creature_attr_fields?.length || 0} defined`)
    }
    if (state.World.CustomComponentRegistry) {
      lines.push(`- Custom Components Count: ${state.World.CustomComponentRegistry.custom_components?.length || 0}`)
    }
  }
  
  // Creatures information
  lines.push('\n## Creatures')
  const creatures = state.Creatures || []
  lines.push(`Total: ${creatures.length}`)
  creatures.forEach((c, i) => {
    const attrs = c.Creature
    const name = attrs?.name || 'Unnamed'
    const id = attrs?.creature_id || `entity_${c.entity_id}`
    const isPlayer = c.IsPlayer ? ' [Player]' : ''
    lines.push(`- [${i}] ${name} (${id})${isPlayer}`)
  })
  
  // Regions information
  lines.push('\n## Regions')
  const regions = state.Regions || []
  lines.push(`Total: ${regions.length}`)
  regions.forEach((r, i) => {
    const name = r.Region?.region_name || r.Metadata?.name || 'Unnamed'
    const locationCount = r.Region?.locations?.length || 0
    lines.push(`- [${i}] ${name} (${locationCount} locations)`)
  })
  
  // Organizations information
  lines.push('\n## Organizations')
  const orgs = state.Organizations || []
  lines.push(`Total: ${orgs.length}`)
  orgs.forEach((o, i) => {
    const name = o.Organization?.name || 'Unnamed'
    lines.push(`- [${i}] ${name}`)
  })
  
  // Setting documents (collected from entity BindSettings)
  lines.push('\n## SettingDocuments')
  let totalDocs = 0
  const worldDocs = state.World?.BindSetting?.documents || []
  totalDocs += worldDocs.length
  if (worldDocs.length > 0) {
    lines.push(`World: ${worldDocs.length} docs`)
    worldDocs.slice(0, 3).forEach(d => lines.push(`  - ${d.name}: ${truncateText(d.content, 30)}`))
  }
  creatures.forEach((c, i) => {
    const cDocs = c.BindSetting?.documents || []
    totalDocs += cDocs.length
    if (cDocs.length > 0) lines.push(`Creature ${c.Creature?.name || i}: ${cDocs.length} docs`)
  })
  regions.forEach((r, i) => {
    const rDocs = r.BindSetting?.documents || []
    totalDocs += rDocs.length
    if (rDocs.length > 0) lines.push(`Region ${r.Region?.region_name || i}: ${rDocs.length} docs`)
  })
  orgs.forEach((o, i) => {
    const oDocs = o.BindSetting?.documents || []
    totalDocs += oDocs.length
    if (oDocs.length > 0) lines.push(`Org ${o.Organization?.name || i}: ${oDocs.length} docs`)
  })
  lines.push(`Total: ${totalDocs}`)
  
  // Initial story
  lines.push('\n## GameInitialStory')
  if (state.GameInitialStory) {
    lines.push(`- Background: ${truncateText(state.GameInitialStory.background)}`)
    lines.push(`- Opening: ${truncateText(state.GameInitialStory.start_story)}`)
  } else {
    lines.push('Not set')
  }
  
  // App info
  lines.push('\n## AppInfo')
  if (state.AppInfo) {
    lines.push(`- Publish Type: ${state.AppInfo.publish_type || 'EDITOR'}`)
  } else {
    lines.push('Not set')
  }
  
  return lines.join('\n')
}

/**
 * Get object property by path
 */
function getByPath(obj: any, path: string): any {
  // Parse path, supports a.b[0].c format
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.')
  let current = obj
  
  for (const part of parts) {
    if (current === undefined || current === null) {
      return undefined
    }
    current = current[part]
  }
  
  return current
}

/**
 * Set object property by path
 */
function setByPath(obj: any, path: string, value: any): boolean {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.')
  let current = obj
  
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    if (current[part] === undefined || current[part] === null) {
      // Determine whether to create array or object based on next part
      const nextPart = parts[i + 1]
      current[part] = /^\d+$/.test(nextPart) ? [] : {}
    }
    current = current[part]
  }
  
  const lastPart = parts[parts.length - 1]
  current[lastPart] = value
  return true
}

// NOTE: CopilotService class has been removed.
// The actual chat logic is in components/copilot/copilotChat.ts (streamCopilotChat function)

/**
 * Generate message ID
 */
export function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}
