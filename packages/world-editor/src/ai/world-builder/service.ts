/**
 * WorldBuilder Service
 *
 * Context message building for phase generation, plus state application logic.
 * Migrated from worldBuilderNextService.ts — stripped localStorage persistence,
 * uses StateOperation dispatch via state-bridge instead of direct StateData mutation.
 */

import type {
  WBNPhaseId,
  WBNSession,
  WBNDraftOutput,
} from './types'
import { WBN_PHASE_IDS as PHASE_IDS, WBN_PHASE_LABELS } from './types'
import { getPhaseUserInstruction } from './prompts'
import type { StateOperation, WorldEditorAIContext } from '../types'
import { executeUpdateState, extractChildren } from '../state-bridge'
import type { StateChangeEntry } from './types'

// ============================================================================
// Serialize Draft (for context injection)
// ============================================================================

function serializeDraftOutput(draft: WBNDraftOutput): string {
  const parts: string[] = []

  parts.push(`# 设计稿`)
  parts.push(`**游玩基调**: ${draft.tone}`)
  parts.push(`**开场时机**: ${draft.opening}`)
  parts.push(`**故事线**: ${draft.storyline}`)
  parts.push(`**游戏机制**: ${draft.mechanics}`)
  parts.push(`**主角描述**: ${draft.protagonist}`)

  if (draft.regions?.length) {
    const regionLines = draft.regions.map((r) => `- \`${r.region_id}\` — ${r.name}`)
    parts.push(`## 地域清单\n${regionLines.join('\n')}`)
  }

  if (draft.organizations?.length) {
    const orgLines = draft.organizations.map((o) => `- \`${o.organization_id}\` — ${o.name}`)
    parts.push(`## 组织清单\n${orgLines.join('\n')}`)
  }

  if (draft.creatures?.length) {
    const creatureLines = draft.creatures.map(
      (c) =>
        `- \`${c.creature_id}\` — ${c.name}${c.is_player ? '（玩家）' : ''}`,
    )
    parts.push(`## 角色清单\n${creatureLines.join('\n')}`)
  }

  return parts.join('\n\n')
}

// ============================================================================
// Build Phase Messages
// ============================================================================

/**
 * Build the message chain for a phase.
 * Chains all prior phase outputs as user/assistant pairs (prompt caching friendly).
 * Extracted content is passed separately via the `extractedContent` parameter.
 */
export function buildPhaseMessages(
  session: WBNSession,
  extractedContent?: string,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = []

  // 1. User's initial description
  messages.push({ role: 'user', content: session.initialPrompt })
  messages.push({
    role: 'assistant',
    content: `Now beginning game data generation...`,
  })

  // 2. Chained prior phase outputs
  const currentIdx = PHASE_IDS.indexOf(session.currentPhase)
  for (let i = 0; i < currentIdx; i++) {
    const phaseId = PHASE_IDS[i]
    if (phaseId === 'organizations' && session.skipOrganizations) continue
    const phaseData = session.phases[phaseId]
    if (!phaseData.output) continue

    if (phaseId === 'synopsis') {
      messages.push({
        role: 'user',
        content: '以下是你之前生成的设计稿，请据此继续后续步骤。',
      })
      messages.push({
        role: 'assistant',
        content: serializeDraftOutput(phaseData.output as WBNDraftOutput),
      })
      if (session.userDesignNotes) {
        messages.push({
          role: 'user',
          content: `## 用户设计偏好（问卷回答）\n\n以下是用户在设计稿阶段通过问卷表达的设计偏好，请在后续步骤中充分参考：\n\n${session.userDesignNotes}`,
        })
        messages.push({
          role: 'assistant',
          content:
            '已了解用户的设计偏好，我会在后续生成中充分参考这些信息。',
        })
      }
    } else if (phaseId === 'initial_story') {
      const story = phaseData.output as { background?: string; start_story?: string }
      const storySummary = [
        `**背景旁白**: ${story?.background || '(无)'}`,
        `**开场第一幕**: ${story?.start_story || '(无)'}`,
      ].join('\n\n')
      messages.push({
        role: 'user',
        content:
          '以下是你之前生成的开场故事。后续步骤中的所有数据应反映此时间点的状态，而非参考素材中后续发展的状态。',
      })
      messages.push({ role: 'assistant', content: storySummary })
    } else if (phaseId === 'world_data') {
      const wd = phaseData.output as Record<string, unknown>
      const docSummaries = (
        (wd?.documents as Array<{ name: string; condition?: string }>) || []
      )
        .map(
          (d) =>
            `- **${d.name}**${d.condition ? ` (条件: ${d.condition})` : ''}`,
        )
        .join('\n')
      const summary = [
        `## 角色属性字段\n\`\`\`json\n${JSON.stringify(wd?.creature_attr_fields || [], null, 2)}\n\`\`\``,
        `## 游戏时间\n\`\`\`json\n${JSON.stringify(wd?.GameTime || {})}\n\`\`\``,
        `## 自定义组件注册表\n\`\`\`json\n${JSON.stringify(wd?.CustomComponentRegistry || {}, null, 2)}\n\`\`\``,
        `## 设定文档列表\n${docSummaries || '(无)'}`,
      ].join('\n\n')
      messages.push({
        role: 'user',
        content:
          '以下是你之前生成的世界数据，请据此继续后续步骤。',
      })
      messages.push({ role: 'assistant', content: summary })
    } else {
      const label = WBN_PHASE_LABELS[phaseId]
      messages.push({
        role: 'user',
        content: `以下是你之前生成的${label}数据，请据此继续后续步骤。`,
      })
      messages.push({
        role: 'assistant',
        content: JSON.stringify(phaseData.output, null, 2),
      })
    }
  }

  // 3. Prior creature batch data for consistency across batches
  if (session.currentPhase === 'creatures' && session.creatureBatching) {
    const { currentBatch, batchPlan } = session.creatureBatching
    if (currentBatch > 0) {
      const allPriorIds: string[] = []
      for (let i = 0; i < currentBatch; i++) {
        allPriorIds.push(...batchPlan[i].creatureIds)
      }
      const creaturesOutput = session.phases.creatures.output as {
        creatures?: Array<Record<string, unknown>>
      }
      if (creaturesOutput?.creatures) {
        const priorCreatures: Record<string, unknown>[] = []
        for (const c of creaturesOutput.creatures) {
          const cId = (c.Creature as Record<string, unknown>)?.creature_id as
            | string
            | undefined
          if (cId && allPriorIds.includes(cId)) {
            const stripped = JSON.parse(JSON.stringify(c))
            // Strip document content, keep only titles and conditions
            if (stripped.BindSetting?.documents) {
              stripped.BindSetting.documents = stripped.BindSetting.documents.map(
                (d: { name: string; condition?: string }) => ({
                  name: d.name,
                  ...(d.condition ? { condition: d.condition } : {}),
                }),
              )
            }
            priorCreatures.push(stripped)
          }
        }
        if (priorCreatures.length > 0) {
          messages.push({
            role: 'user',
            content: `以下是前 ${currentBatch} 批次已生成的角色数据（设定文档仅保留标题），请参考这些角色的设定来保持一致性（如人物关系、外貌风格、属性数值范围等）。`,
          })
          messages.push({
            role: 'assistant',
            content: JSON.stringify({ creatures: priorCreatures }, null, 2),
          })
        }
      }
    }
  }

  // 4. Current phase instruction with relevant draft context prepended
  let currentInstruction = getPhaseUserInstruction(session.currentPhase)
  const draft = session.phases.synopsis.output as WBNDraftOutput | undefined

  if (session.currentPhase !== 'synopsis' && draft) {
    // Temporal anchoring from opening story
    if (session.currentPhase === 'initial_story') {
      currentInstruction = `## 设计稿摘要（开场与故事线）\n\n**开场时机**: ${draft.opening}\n**故事线**: ${draft.storyline}\n**游玩基调**: ${draft.tone}\n\n---\n\n${currentInstruction}`
    }

    const initialStory = session.phases.initial_story?.output as
      | { background?: string; start_story?: string }
      | undefined
    if (initialStory && session.currentPhase !== 'initial_story') {
      const storyPreview =
        initialStory.start_story && initialStory.start_story.length > 200
          ? initialStory.start_story.substring(0, 200) + '...'
          : initialStory.start_story || '(无)'
      const storyAnchor =
        `## 时空锚定（开场故事已确定）\n\n` +
        `**背景**: ${initialStory.background || '(无)'}\n` +
        `**开场**: ${storyPreview}\n\n` +
        `> 你生成的所有数据必须反映**此时间点**的状态。从参考文件中提取数据时，注意区分"故事开头的状态"和"后续发展的状态"。未来剧情线索应写入设定文档（BindSetting），而非设为当前属性/关系值。\n\n---\n\n`
      currentInstruction = storyAnchor + currentInstruction
    }

    if (session.currentPhase === 'world_data') {
      currentInstruction = `## 设计稿摘要（基调与机制）\n\n**游玩基调**: ${draft.tone}\n**游戏机制**: ${draft.mechanics}\n\n---\n\n${currentInstruction}`
    }

    if (session.currentPhase === 'regions' && draft.regions?.length) {
      const regionList = draft.regions
        .map((r) => `- \`${r.region_id}\` — ${r.name}`)
        .join('\n')
      currentInstruction = `## 地域清单（来自设计稿）\n\n${regionList}\n\n---\n\n${currentInstruction}`
    }

    if (session.currentPhase === 'organizations' && draft.organizations?.length) {
      const orgList = draft.organizations
        .map((o) => `- \`${o.organization_id}\` — ${o.name}`)
        .join('\n')
      currentInstruction = `## 组织清单（来自设计稿）\n\n${orgList}\n\n---\n\n${currentInstruction}`
    }

    if (
      session.currentPhase === 'creatures' &&
      draft.creatures &&
      session.creatureBatching
    ) {
      const batch =
        session.creatureBatching.batchPlan[session.creatureBatching.currentBatch]
      const { currentBatch, totalBatches } = session.creatureBatching

      const batchCreatures = batch.creatureIds
        .map((id) => {
          const c = draft.creatures.find((cr) => cr.creature_id === id)
          return c
            ? `- \`${c.creature_id}\` — ${c.name}${c.is_player ? '（玩家角色）' : ''}`
            : `- \`${id}\``
        })
        .join('\n')
      currentInstruction = `## 本批次角色清单（批次 ${currentBatch + 1}/${totalBatches}）\n\n${batchCreatures}\n\n---\n\n${currentInstruction}`

      currentInstruction += `\n\n### 本批次必须生成的角色清单（共 ${batch.creatureIds.length} 个）\n\n${batch.creatureIds.map((id) => `- \`${id}\``).join('\n')}\n\n> 你的输出中 creatures 数组必须恰好包含以上 ${batch.creatureIds.length} 个角色，不多不少。缺少任何一个角色将被视为不合格输出。`

      // Inject organization list for creature generation
      if (session.skipOrganizations) {
        currentInstruction += `\n\n### 组织步骤已跳过\n\n所有角色的 \`organization_id\` 字段请留空。`
      } else {
        const orgsOutput = session.phases.organizations?.output as {
          organizations?: Array<{ organization_id: string; name: string }>
        }
        if (orgsOutput?.organizations?.length) {
          const orgList = orgsOutput.organizations
            .map((o) => `- \`${o.organization_id}\` — ${o.name}`)
            .join('\n')
          currentInstruction += `\n\n### 可用组织列表（来自组织阶段）\n\n以下是已生成的组织，请为每个角色考虑其组织归属：\n${orgList}\n\n> 请根据角色设定合理分配 \`organization_id\`。无组织归属的角色可以不填，但大多数角色应有所属组织。`
        }
      }

      // Prior batch creature IDs quick reference
      if (currentBatch > 0) {
        const priorCreatureIds: string[] = []
        for (let i = 0; i < currentBatch; i++) {
          priorCreatureIds.push(
            ...session.creatureBatching.batchPlan[i].creatureIds,
          )
        }
        currentInstruction += `\n\n### 已生成角色（前 ${currentBatch} 批次）\n\n前批次角色完整数据已在上文提供，以下是 creature_id 速查：\n${priorCreatureIds.map((id) => `- \`${id}\``).join('\n')}\n\n> 请参考前批次角色的属性数值、外貌风格、关系设定等，确保本批次角色与之保持一致性。Relationship 中可引用这些 creature_id。`
      }
    }
  }

  // 5. Inject pre-extracted reference content (from sub-agent)
  if (extractedContent) {
    messages.push({
      role: 'user',
      content: `## Reference Material (from user's uploaded file)\n\nThe following content is provided as reference only. Use it flexibly based on the user's requirements — you may adapt, extend, or selectively incorporate details as appropriate.\n\n${extractedContent}`,
    })
    messages.push({
      role: 'assistant',
      content:
        'Understood. I will use this reference material as a guide while generating data, adapting details as needed.',
    })
  }

  messages.push({ role: 'user', content: currentInstruction })
  return messages
}

// ============================================================================
// Apply Phase Output to State via StateOperations
// ============================================================================

/**
 * Normalize document content: convert literal "\n" (two chars) to real newlines.
 */
function normalizeDocContent(doc: Record<string, unknown>): Record<string, unknown> {
  if (typeof doc.content === 'string') {
    doc.content = (doc.content as string).replace(/\\n/g, '\n')
  }
  // Strip null condition (from nullable JSON schema field)
  if (doc.condition === null) {
    delete doc.condition
  }
  return doc
}

function normalizeBindSetting(
  bs: { documents?: Array<Record<string, unknown>> } | undefined,
): { documents?: Array<Record<string, unknown>> } | undefined {
  if (!bs?.documents) return bs
  bs.documents = bs.documents.map((d) => normalizeDocContent(d))
  return bs
}

/**
 * Parse a simplified field_type string into a JSON Schema fragment.
 */
function parseFieldType(fieldType: string): Record<string, unknown> {
  const ft = fieldType.trim()
  if (ft === 'string' || ft === 'number' || ft === 'boolean') return { type: ft }

  const arrayObjMatch = ft.match(/^array<object<\{(.+)\}>>$/)
  if (arrayObjMatch) return { type: 'array', items: parseObjectFields(arrayObjMatch[1]) }

  const arrayMatch = ft.match(/^array<(\w+)>$/)
  if (arrayMatch) return { type: 'array', items: { type: arrayMatch[1] } }

  const objMatch = ft.match(/^object<\{(.+)\}>$/)
  if (objMatch) return parseObjectFields(objMatch[1])

  return { type: 'string' }
}

function parseObjectFields(fieldsStr: string): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  const parts = splitTopLevelCommas(fieldsStr)
  for (const part of parts) {
    const colonIdx = part.indexOf(':')
    if (colonIdx < 0) continue
    const key = part.substring(0, colonIdx).trim()
    const valType = part.substring(colonIdx + 1).trim()
    properties[key] = parseFieldType(valType)
    required.push(key)
  }
  return { type: 'object', properties, required }
}

function splitTopLevelCommas(s: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const ch of s) {
    if (ch === '<' || ch === '{') depth++
    else if (ch === '>' || ch === '}') depth--
    if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim()) parts.push(current)
  return parts
}

function convertFieldsToTypeSchema(
  fields: Array<{
    field_name: string
    field_type: string
    field_description?: string
  }>,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const f of fields) {
    const schema = parseFieldType(f.field_type) as Record<string, unknown>
    if (f.field_description) schema.description = f.field_description
    properties[f.field_name] = schema
    required.push(f.field_name)
  }
  return { type: 'object', properties, required }
}

/**
 * Auto-correct common AI mistakes in creature data.
 */
function autoCorrectCreature(c: Record<string, unknown>): Record<string, unknown> {
  const result = { ...c }
  const attrs = result.Creature as Record<string, unknown> | undefined

  if (attrs) {
    if (attrs.description && !attrs.appearance) {
      attrs.appearance = { body: attrs.description, clothing: '(not described)' }
      delete attrs.description
    }
    if (!attrs.titles) attrs.titles = []
    else if (!Array.isArray(attrs.titles)) attrs.titles = [String(attrs.titles)]
    delete attrs.age
  }

  if (result.IsPlayer === true) result.IsPlayer = {}
  else if (result.IsPlayer === false) delete result.IsPlayer

  const tryParseJsonData = (item: Record<string, unknown>) => {
    if (typeof item.data === 'string') {
      const trimmed = (item.data as string).trim()
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          item.data = JSON.parse(trimmed)
        } catch {
          /* keep as-is */
        }
      }
    }
    return item
  }
  if ((result.CustomComponents as Record<string, unknown>)?.custom_components) {
    ;(result.CustomComponents as Record<string, unknown>).custom_components = (
      (result.CustomComponents as Record<string, unknown>)
        .custom_components as Array<Record<string, unknown>>
    ).map(tryParseJsonData)
  }
  if ((result.StatusEffects as Record<string, unknown>)?.status_effects) {
    ;(result.StatusEffects as Record<string, unknown>).status_effects = (
      (result.StatusEffects as Record<string, unknown>)
        .status_effects as Array<Record<string, unknown>>
    ).map(tryParseJsonData)
  }

  if ((result.Inventory as Record<string, unknown>)?.items) {
    ;(result.Inventory as Record<string, unknown>).items = (
      (result.Inventory as Record<string, unknown>).items as Array<Record<string, unknown>>
    ).map((item) => ({
      id: item.id || item.item_id,
      count: item.count ?? item.quantity ?? 1,
      name: item.name || item.id || item.item_id || '',
      description: item.description || '',
      details: item.details || [],
    }))
  }

  return result
}

// ============================================================================
// Apply Phase Output via StateOperation Dispatch
// ============================================================================

/**
 * Convert a phase's structured output into StateOperations and apply them
 * to the world state via the state-bridge.
 */
export function applyPhaseOutput(
  session: WBNSession,
  phaseId: WBNPhaseId,
  ctx: WorldEditorAIContext,
): { text: string; changes: StateChangeEntry[] } {
  const phaseOutput = session.phases[phaseId].output as Record<string, unknown> | undefined
  if (!phaseOutput) return { text: 'No output to apply.', changes: [] }

  const ops: StateOperation[] = []

  switch (phaseId) {
    case 'synopsis':
      // Synopsis doesn't apply any data
      return { text: 'Draft phase -- no state changes.', changes: [] }

    case 'world_data': {
      const data: Record<string, unknown> = {}

      // Map AI output field names → WorldSnapshot field names
      if (phaseOutput.creature_attr_fields) {
        data.registry = phaseOutput.creature_attr_fields
      }
      if (phaseOutput.GameTime) {
        data.game_time = phaseOutput.GameTime
      }
      if (phaseOutput.CustomComponentRegistry) {
        const ccr = phaseOutput.CustomComponentRegistry as {
          custom_components?: Array<{
            component_key: string
            component_name: string
            fields?: Array<{
              field_name: string
              field_type: string
              field_description?: string
            }>
          }>
        }
        data.custom_component_registry = (ccr.custom_components || []).map((comp) => ({
          component_key: comp.component_key,
          component_name: comp.component_name,
          is_array: false,
          type_schema: convertFieldsToTypeSchema(comp.fields || []),
        }))
      }
      if (phaseOutput.documents) {
        data.bind_setting = {
          documents: (phaseOutput.documents as Array<Record<string, unknown>>).map(
            (d) => normalizeDocContent({ ...d }),
          ),
        }
      }

      ops.push({ op: 'update_world', data })
      break
    }

    case 'regions': {
      const regions = phaseOutput.regions as Array<Record<string, unknown>> | undefined
      if (regions) {
        for (const r of regions) {
          const regionData: Record<string, unknown> = {
            region: {
              name: (r.region_name as string) || '',
              description: (r.description as string) || '',
              locations: r.locations || [],
              paths: ((r.paths as Array<Record<string, unknown>>) || []).map((p) => ({
                src_location: p.src_location || p.from || '',
                src_region: p.src_region || r.region_id,
                discovered: p.discovered !== undefined ? p.discovered : true,
                to_region: p.to_region || r.region_id,
                to_location: p.to_location || p.to || '',
                description: p.description || '',
              })),
            },
          }
          if (r.BindSetting) {
            regionData.bind_setting = normalizeBindSetting(
              r.BindSetting as { documents?: Array<Record<string, unknown>> },
            )
          }
          ops.push({ op: 'upsert_region', region_id: r.region_id as string, data: regionData })
        }
      }
      break
    }

    case 'organizations': {
      const orgs = phaseOutput.organizations as Array<Record<string, unknown>> | undefined
      if (orgs) {
        for (const o of orgs) {
          const orgData: Record<string, unknown> = {
            organization: {
              name: (o.name as string) || '',
              description: (o.description as string) || '',
              territories: o.territories || [],
            },
          }
          if (o.BindSetting) {
            orgData.bind_setting = normalizeBindSetting(
              o.BindSetting as { documents?: Array<Record<string, unknown>> },
            )
          }
          ops.push({
            op: 'upsert_organization',
            organization_id: o.organization_id as string,
            data: orgData,
          })
        }
      }
      break
    }

    case 'creatures': {
      const creatures = phaseOutput.creatures as Array<Record<string, unknown>> | undefined
      if (creatures) {
        for (const raw of creatures) {
          const corrected = autoCorrectCreature(raw)
          const creatureAttrs = corrected.Creature as Record<string, unknown> | undefined
          const creatureId = creatureAttrs?.creature_id as string
          if (!creatureId) continue

          // Restructure from AI PascalCase format → CreatureSnapshot nested format
          const creatureData: Record<string, unknown> = {
            creature: {
              name: creatureAttrs?.name || '',
              gender: creatureAttrs?.gender,
              race: creatureAttrs?.race,
              personality: creatureAttrs?.personality,
              description: creatureAttrs?.description,
              emotion: creatureAttrs?.emotion,
              goal: creatureAttrs?.goal,
              organization_id: creatureAttrs?.organization_id,
              titles: creatureAttrs?.titles || [],
              known_infos: creatureAttrs?.known_infos,
              attrs: creatureAttrs?.attrs,
              appearance: creatureAttrs?.appearance,
            },
            is_player: corrected.IsPlayer !== undefined,
          }

          if (corrected.Location) {
            creatureData.location = corrected.Location
          }
          if ((corrected.StatusEffects as Record<string, unknown>)?.status_effects) {
            creatureData.status_effects = (corrected.StatusEffects as Record<string, unknown>).status_effects
          }
          if ((corrected.CustomComponents as Record<string, unknown>)?.custom_components) {
            creatureData.custom_components = (corrected.CustomComponents as Record<string, unknown>).custom_components
          }
          if ((corrected.Inventory as Record<string, unknown>)?.items) {
            creatureData.inventory = (corrected.Inventory as Record<string, unknown>).items
          }
          if (corrected.BindSetting) {
            creatureData.bind_setting = normalizeBindSetting(
              corrected.BindSetting as { documents?: Array<Record<string, unknown>> },
            )
          }

          ops.push({
            op: 'upsert_creature',
            creature_id: creatureId,
            data: creatureData,
          })
        }
      }
      break
    }

    case 'initial_story': {
      ops.push({ op: 'set_initial_story', data: phaseOutput })
      break
    }
  }

  if (ops.length === 0) return { text: 'No operations to apply.', changes: [] }
  return executeUpdateState(ops, ctx)
}

/**
 * Compute change entries from a saved phase's output WITHOUT applying ops to the store.
 * Used to reconstruct the change report when restoring a session from IndexedDB.
 */
export function computePhaseChanges(
  session: WBNSession,
  phaseId: WBNPhaseId,
): StateChangeEntry[] {
  const phaseOutput = session.phases[phaseId].output as Record<string, unknown> | undefined
  if (!phaseOutput) return []

  switch (phaseId) {
    case 'synopsis':
      return []

    case 'world_data': {
      const data: Record<string, unknown> = {}
      if (phaseOutput.creature_attr_fields) data.registry = phaseOutput.creature_attr_fields
      if (phaseOutput.GameTime) data.game_time = phaseOutput.GameTime
      if (phaseOutput.CustomComponentRegistry) data.custom_component_registry = phaseOutput.CustomComponentRegistry
      if (phaseOutput.documents) data.bind_setting = phaseOutput.documents
      if (Object.keys(data).length === 0) return []
      return [{ action: 'updated', category: 'world', label: 'World', tab: 'world', children: extractChildren(data) }]
    }

    case 'regions': {
      const regions = phaseOutput.regions as Array<Record<string, unknown>> | undefined
      if (!regions) return []
      return regions.map((r) => {
        const regionData: Record<string, unknown> = { region: r }
        if (r.BindSetting) regionData.bind_setting = r.BindSetting
        return { action: 'created' as const, category: 'region' as const, entityId: r.region_id as string, label: r.region_id as string, tab: 'regions' as const, children: extractChildren(regionData) }
      })
    }

    case 'organizations': {
      const orgs = phaseOutput.organizations as Array<Record<string, unknown>> | undefined
      if (!orgs) return []
      return orgs.map((o) => {
        const orgData: Record<string, unknown> = { organization: o }
        if (o.BindSetting) orgData.bind_setting = o.BindSetting
        return { action: 'created' as const, category: 'organization' as const, entityId: o.organization_id as string, label: o.organization_id as string, tab: 'organizations' as const, children: extractChildren(orgData) }
      })
    }

    case 'creatures': {
      const creatures = phaseOutput.creatures as Array<Record<string, unknown>> | undefined
      if (!creatures) return []
      return creatures.map((raw) => {
        const creatureAttrs = raw.Creature as Record<string, unknown> | undefined
        const creatureId = creatureAttrs?.creature_id as string
        const data: Record<string, unknown> = { creature: creatureAttrs }
        if (raw.Location) data.location = raw.Location
        if (raw.IsPlayer !== undefined) data.is_player = raw.IsPlayer
        if ((raw.StatusEffects as Record<string, unknown>)?.status_effects) data.status_effects = (raw.StatusEffects as Record<string, unknown>).status_effects
        if ((raw.CustomComponents as Record<string, unknown>)?.custom_components) data.custom_components = (raw.CustomComponents as Record<string, unknown>).custom_components
        if ((raw.Inventory as Record<string, unknown>)?.items) data.inventory = (raw.Inventory as Record<string, unknown>).items
        if (raw.BindSetting) data.bind_setting = raw.BindSetting
        return { action: 'created' as const, category: 'creature' as const, entityId: creatureId, label: creatureId, tab: 'characters' as const, children: extractChildren(data) }
      })
    }

    case 'initial_story': {
      return [{ action: 'updated', category: 'story', label: 'Initial Story', tab: 'story', children: extractChildren(phaseOutput as Record<string, unknown>) }]
    }
  }

  return []
}

// ============================================================================
// Apply Revision Patch to Phase Output
// ============================================================================

/**
 * Find an entity in the phase output by type and ID.
 */
function findEntityInOutput(
  output: Record<string, unknown>,
  entityType: string,
  entityId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any | null {
  switch (entityType) {
    case 'creature': {
      const creatures = (output.creatures as Array<Record<string, unknown>>) || []
      return creatures.find(
        (c) => (c.Creature as Record<string, unknown>)?.creature_id === entityId,
      ) || null
    }
    case 'region': {
      const regions = (output.regions as Array<Record<string, unknown>>) || []
      return regions.find((r) => r.region_id === entityId) || null
    }
    case 'organization': {
      const orgs = (output.organizations as Array<Record<string, unknown>>) || []
      return orgs.find((o) => o.organization_id === entityId) || null
    }
    default:
      return null
  }
}

/**
 * Apply a revision patch to the phase output. Pure function (deep-clones).
 * Returns the updated output and a human-readable summary.
 */
export function applyRevisionPatch(
  currentOutput: unknown,
  toolName: string,
  toolArgs: Record<string, unknown>,
): { updatedOutput: unknown; summary: string } {
  const output = JSON.parse(JSON.stringify(currentOutput ?? {})) as Record<string, unknown>

  switch (toolName) {
    // ---- Draft patch tools ----
    case 'patch_draft': {
      const fields = ['tone', 'opening', 'storyline', 'mechanics', 'protagonist'] as const
      const updated: string[] = []
      for (const f of fields) {
        if (toolArgs[f] !== undefined) {
          output[f] = toolArgs[f] as string
          updated.push(f)
        }
      }
      return { updatedOutput: output, summary: `Updated draft: ${updated.join(', ') || 'no changes'}` }
    }
    case 'patch_synopsis_region': {
      if (!output.regions) output.regions = []
      const regions = output.regions as Array<Record<string, unknown>>
      const rIdx = regions.findIndex((r) => r.region_id === toolArgs.region_id)
      if (rIdx >= 0) {
        if (toolArgs.name) regions[rIdx].name = toolArgs.name
        return { updatedOutput: output, summary: `Updated region "${toolArgs.region_id}"` }
      } else {
        regions.push({ region_id: toolArgs.region_id, name: toolArgs.name || toolArgs.region_id })
        return { updatedOutput: output, summary: `Added region "${toolArgs.region_id}"` }
      }
    }
    case 'patch_synopsis_organization': {
      if (!output.organizations) output.organizations = []
      const orgs = output.organizations as Array<Record<string, unknown>>
      const oIdx = orgs.findIndex((o) => o.organization_id === toolArgs.organization_id)
      if (oIdx >= 0) {
        if (toolArgs.name) orgs[oIdx].name = toolArgs.name
        return { updatedOutput: output, summary: `Updated organization "${toolArgs.organization_id}"` }
      } else {
        orgs.push({
          organization_id: toolArgs.organization_id,
          name: toolArgs.name || toolArgs.organization_id,
        })
        return { updatedOutput: output, summary: `Added organization "${toolArgs.organization_id}"` }
      }
    }
    case 'patch_synopsis_creature': {
      if (!output.creatures) output.creatures = []
      const creatures = output.creatures as Array<Record<string, unknown>>
      const cIdx = creatures.findIndex((c) => c.creature_id === toolArgs.creature_id)
      if (cIdx >= 0) {
        if (toolArgs.name) creatures[cIdx].name = toolArgs.name
        if (toolArgs.is_player !== undefined) creatures[cIdx].is_player = toolArgs.is_player
        return { updatedOutput: output, summary: `Updated character "${toolArgs.creature_id}"` }
      } else {
        creatures.push({
          creature_id: toolArgs.creature_id,
          name: toolArgs.name || toolArgs.creature_id,
          is_player: toolArgs.is_player || false,
        })
        return { updatedOutput: output, summary: `Added character "${toolArgs.creature_id}"` }
      }
    }
    case 'remove_synopsis_entry': {
      const entryType = toolArgs.entry_type as string
      const entryId = toolArgs.entry_id as string
      if (entryType === 'region' && output.regions) {
        output.regions = (output.regions as Array<Record<string, unknown>>).filter(
          (r) => r.region_id !== entryId,
        )
        return { updatedOutput: output, summary: `Removed region "${entryId}"` }
      } else if (entryType === 'organization' && output.organizations) {
        output.organizations = (output.organizations as Array<Record<string, unknown>>).filter(
          (o) => o.organization_id !== entryId,
        )
        return { updatedOutput: output, summary: `Removed organization "${entryId}"` }
      } else if (entryType === 'creature' && output.creatures) {
        output.creatures = (output.creatures as Array<Record<string, unknown>>).filter(
          (c) => c.creature_id !== entryId,
        )
        return { updatedOutput: output, summary: `Removed character "${entryId}"` }
      }
      return { updatedOutput: output, summary: `Not found: ${entryType} "${entryId}"` }
    }

    // ---- Data phase patch tools ----
    case 'patch_creature': {
      const creatureId = toolArgs.creature_id as string
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const creatureData = toolArgs.creature_data as any
      if (!creatureId || !creatureData)
        return { updatedOutput: output, summary: 'Error: creature_id and creature_data required' }
      const creatures = (output.creatures as Array<Record<string, unknown>>) || []
      const idx = creatures.findIndex(
        (c) => (c.Creature as Record<string, unknown>)?.creature_id === creatureId,
      )
      if (idx >= 0) {
        for (const [key, value] of Object.entries(creatureData)) {
          if (key === 'Creature' && creatures[idx].Creature) {
            Object.assign(creatures[idx].Creature as Record<string, unknown>, value as Record<string, unknown>)
          } else {
            creatures[idx][key] = value
          }
        }
        return { updatedOutput: output, summary: `Updated character "${creatureId}"` }
      } else {
        const newCreature = creatureData.Creature
          ? { ...creatureData, Creature: { ...creatureData.Creature, creature_id: creatureId } }
          : { Creature: { creature_id: creatureId }, ...creatureData }
        const hasPlayer = creatures.some((c) => c.IsPlayer !== undefined)
        if (hasPlayer && newCreature.IsPlayer !== undefined) delete newCreature.IsPlayer
        creatures.push(newCreature)
        output.creatures = creatures
        return { updatedOutput: output, summary: `Added character "${creatureId}"` }
      }
    }
    case 'replace_creature': {
      const creatureId = toolArgs.creature_id as string
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const creatureData = toolArgs.creature_data as any
      if (!creatureId || !creatureData)
        return { updatedOutput: output, summary: 'Error: creature_id and creature_data required' }
      const creatures = (output.creatures as Array<Record<string, unknown>>) || []
      if (creatureData.Creature) creatureData.Creature.creature_id = creatureId
      else creatureData.Creature = { creature_id: creatureId }
      const idx = creatures.findIndex(
        (c) => (c.Creature as Record<string, unknown>)?.creature_id === creatureId,
      )
      if (idx >= 0) {
        const wasPlayer = creatures[idx].IsPlayer !== undefined
        if (!wasPlayer && creatureData.IsPlayer !== undefined) {
          const hasOtherPlayer = creatures.some((c, i) => i !== idx && c.IsPlayer !== undefined)
          if (hasOtherPlayer) delete creatureData.IsPlayer
        }
        creatures[idx] = creatureData
        return { updatedOutput: output, summary: `Replaced character "${creatureId}"` }
      } else {
        const hasPlayer = creatures.some((c) => c.IsPlayer !== undefined)
        if (hasPlayer && creatureData.IsPlayer !== undefined) delete creatureData.IsPlayer
        creatures.push(creatureData)
        output.creatures = creatures
        return { updatedOutput: output, summary: `Added character "${creatureId}" (replace mode)` }
      }
    }
    case 'patch_region': {
      const regionId = toolArgs.region_id as string
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const regionData = toolArgs.region_data as any
      if (!regionId || !regionData)
        return { updatedOutput: output, summary: 'Error: region_id and region_data required' }
      const regions = (output.regions as Array<Record<string, unknown>>) || []
      const idx = regions.findIndex((r) => r.region_id === regionId)
      if (idx >= 0) {
        if (regionData.region_name) regions[idx].region_name = regionData.region_name
        if (regionData.description) regions[idx].description = regionData.description
        if (regionData.locations) regions[idx].locations = regionData.locations
        if (regionData.paths) regions[idx].paths = regionData.paths
        if (regionData.BindSetting) regions[idx].BindSetting = regionData.BindSetting
        return { updatedOutput: output, summary: `Updated region "${regionId}"` }
      } else {
        regions.push({ region_id: regionId, ...regionData })
        output.regions = regions
        return { updatedOutput: output, summary: `Added region "${regionId}"` }
      }
    }
    case 'replace_region': {
      const regionId = toolArgs.region_id as string
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const regionData = toolArgs.region_data as any
      if (!regionId || !regionData)
        return { updatedOutput: output, summary: 'Error: region_id and region_data required' }
      const regions = (output.regions as Array<Record<string, unknown>>) || []
      const idx = regions.findIndex((r) => r.region_id === regionId)
      if (idx >= 0) {
        regions[idx] = { region_id: regionId, ...regionData }
        return { updatedOutput: output, summary: `Replaced region "${regionId}"` }
      }
      return { updatedOutput: output, summary: `Region "${regionId}" not found` }
    }
    case 'patch_organization': {
      const orgId = toolArgs.organization_id as string
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const orgData = toolArgs.organization_data as any
      if (!orgId || !orgData)
        return { updatedOutput: output, summary: 'Error: organization_id and organization_data required' }
      const orgs = (output.organizations as Array<Record<string, unknown>>) || []
      const idx = orgs.findIndex((o) => o.organization_id === orgId)
      if (idx >= 0) {
        if (orgData.organization_name) orgs[idx].organization_name = orgData.organization_name
        if (orgData.description) orgs[idx].description = orgData.description
        if (orgData.territories) orgs[idx].territories = orgData.territories
        if (orgData.relationships) orgs[idx].relationships = orgData.relationships
        if (orgData.BindSetting) orgs[idx].BindSetting = orgData.BindSetting
        return { updatedOutput: output, summary: `Updated organization "${orgId}"` }
      } else {
        orgs.push({ organization_id: orgId, ...orgData })
        output.organizations = orgs
        return { updatedOutput: output, summary: `Added organization "${orgId}"` }
      }
    }
    case 'replace_organization': {
      const orgId = toolArgs.organization_id as string
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const orgData = toolArgs.organization_data as any
      if (!orgId || !orgData)
        return { updatedOutput: output, summary: 'Error: organization_id and organization_data required' }
      const orgs = (output.organizations as Array<Record<string, unknown>>) || []
      const idx = orgs.findIndex((o) => o.organization_id === orgId)
      if (idx >= 0) {
        orgs[idx] = { organization_id: orgId, ...orgData }
        return { updatedOutput: output, summary: `Replaced organization "${orgId}"` }
      }
      return { updatedOutput: output, summary: `Organization "${orgId}" not found` }
    }
    case 'patch_document': {
      const docName = toolArgs.doc_name as string
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const docData = toolArgs.document_data as any
      if (!docName || !docData)
        return { updatedOutput: output, summary: 'Error: doc_name and document_data required' }
      const docs = (output.documents as Array<Record<string, unknown>>) || []
      const idx = docs.findIndex((d) => (d.name || d.path) === docName)
      if (idx >= 0) {
        Object.assign(docs[idx], docData)
        if (!docs[idx].name) docs[idx].name = docName
        return { updatedOutput: output, summary: `Updated document "${docName}"` }
      } else {
        docs.push({ name: docName, ...docData })
        output.documents = docs
        return { updatedOutput: output, summary: `Added document "${docName}"` }
      }
    }
    case 'replace_document': {
      const docName = toolArgs.doc_name as string
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const docData = toolArgs.document_data as any
      if (!docName || !docData)
        return { updatedOutput: output, summary: 'Error: doc_name and document_data required' }
      const docs = (output.documents as Array<Record<string, unknown>>) || []
      const idx = docs.findIndex((d) => (d.name || d.path) === docName)
      if (idx >= 0) {
        docs[idx] = { name: docName, ...docData }
        return { updatedOutput: output, summary: `Replaced document "${docName}"` }
      }
      return { updatedOutput: output, summary: `Document "${docName}" not found` }
    }
    case 'patch_entity_document':
    case 'replace_entity_document': {
      const entityType = toolArgs.entity_type as string
      const entityId = toolArgs.entity_id as string
      const docName = toolArgs.doc_name as string
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const docData = toolArgs.document_data as any
      if (!entityType || !entityId || !docName || !docData) {
        return {
          updatedOutput: output,
          summary: 'Error: entity_type, entity_id, doc_name, document_data required',
        }
      }
      const entity = findEntityInOutput(output, entityType, entityId)
      if (!entity) {
        return { updatedOutput: output, summary: `${entityType} "${entityId}" not found` }
      }
      if (!entity.BindSetting) entity.BindSetting = { documents: [] }
      if (!entity.BindSetting.documents) entity.BindSetting.documents = []
      const docs = entity.BindSetting.documents as Array<Record<string, unknown>>
      const docIdx = docs.findIndex((d) => d.name === docName)
      if (toolName === 'replace_entity_document') {
        if (docIdx >= 0) {
          docs[docIdx] = { name: docName, ...docData }
          return { updatedOutput: output, summary: `Replaced "${entityId}" document "${docName}"` }
        }
        docs.push({ name: docName, ...docData })
        return { updatedOutput: output, summary: `Added "${entityId}" document "${docName}"` }
      } else {
        if (docIdx >= 0) {
          Object.assign(docs[docIdx], docData)
          return { updatedOutput: output, summary: `Updated "${entityId}" document "${docName}"` }
        }
        docs.push({ name: docName, ...docData })
        return { updatedOutput: output, summary: `Added "${entityId}" document "${docName}"` }
      }
    }
    case 'patch_story': {
      if (toolArgs.background !== undefined) output.background = toolArgs.background
      if (toolArgs.start_story !== undefined) output.start_story = toolArgs.start_story
      const parts: string[] = []
      if (toolArgs.background !== undefined) parts.push('background')
      if (toolArgs.start_story !== undefined) parts.push('opening story')
      return { updatedOutput: output, summary: `Updated: ${parts.join(', ')}` }
    }
    case 'patch_world_data': {
      const parts: string[] = []
      if (toolArgs.creature_attr_fields !== undefined) {
        const existing = (output.creature_attr_fields as Array<Record<string, unknown>>) || []
        const incoming = toolArgs.creature_attr_fields as Array<Record<string, unknown>>
        for (const inc of incoming) {
          const idx = existing.findIndex((e) => e.field_name === inc.field_name)
          if (idx >= 0) Object.assign(existing[idx], inc)
          else existing.push(inc)
        }
        output.creature_attr_fields = existing
        parts.push(`attr fields (${incoming.length})`)
      }
      if (toolArgs.GameTime !== undefined) {
        output.GameTime = Object.assign(
          {},
          (output.GameTime as Record<string, unknown>) || {},
          toolArgs.GameTime as Record<string, unknown>,
        )
        parts.push('game time')
      }
      if (toolArgs.CustomComponentRegistry !== undefined) {
        const reg = (output.CustomComponentRegistry as {
          custom_components?: Array<Record<string, unknown>>
        }) || { custom_components: [] }
        const existingComps = reg.custom_components || []
        const incomingComps = (toolArgs.CustomComponentRegistry as {
          custom_components?: Array<Record<string, unknown>>
        }).custom_components || []
        for (const inc of incomingComps) {
          const idx = existingComps.findIndex((e) => e.component_key === inc.component_key)
          if (idx >= 0) Object.assign(existingComps[idx], inc)
          else existingComps.push(inc)
        }
        reg.custom_components = existingComps
        output.CustomComponentRegistry = reg
        parts.push(`custom components (${incomingComps.length})`)
      }
      return { updatedOutput: output, summary: `Updated world data: ${parts.join(', ') || 'no changes'}` }
    }
    case 'remove_entry': {
      const entityType = toolArgs.entity_type as string
      const entityId = toolArgs.entity_id as string
      if (!entityType || !entityId)
        return { updatedOutput: output, summary: 'Error: entity_type and entity_id required' }
      switch (entityType) {
        case 'creature': {
          const arr = (output.creatures as Array<Record<string, unknown>>) || []
          const idx = arr.findIndex(
            (c) => (c.Creature as Record<string, unknown>)?.creature_id === entityId,
          )
          if (idx >= 0) {
            arr.splice(idx, 1)
            return { updatedOutput: output, summary: `Removed character "${entityId}"` }
          }
          return { updatedOutput: output, summary: `Character "${entityId}" not found` }
        }
        case 'region': {
          const arr = (output.regions as Array<Record<string, unknown>>) || []
          const idx = arr.findIndex((r) => r.region_id === entityId)
          if (idx >= 0) {
            arr.splice(idx, 1)
            return { updatedOutput: output, summary: `Removed region "${entityId}"` }
          }
          return { updatedOutput: output, summary: `Region "${entityId}" not found` }
        }
        case 'organization': {
          const arr = (output.organizations as Array<Record<string, unknown>>) || []
          const idx = arr.findIndex((o) => o.organization_id === entityId)
          if (idx >= 0) {
            arr.splice(idx, 1)
            return { updatedOutput: output, summary: `Removed organization "${entityId}"` }
          }
          return { updatedOutput: output, summary: `Organization "${entityId}" not found` }
        }
        case 'document': {
          const arr = (output.documents as Array<Record<string, unknown>>) || []
          const idx = arr.findIndex((d) => (d.name || d.path) === entityId)
          if (idx >= 0) {
            arr.splice(idx, 1)
            return { updatedOutput: output, summary: `Removed document "${entityId}"` }
          }
          return { updatedOutput: output, summary: `Document "${entityId}" not found` }
        }
        case 'entity_document': {
          // Format: "entity_type/entity_id/doc_name"
          const parts = entityId.split('/')
          if (parts.length !== 3) return { updatedOutput: output, summary: 'Invalid entity_document ID format' }
          const [eType, eId, dName] = parts
          const entity = findEntityInOutput(output, eType, eId)
          if (!entity?.BindSetting?.documents) {
            return { updatedOutput: output, summary: `${eType} "${eId}" or document not found` }
          }
          const docs = entity.BindSetting.documents as Array<Record<string, unknown>>
          const dIdx = docs.findIndex((d) => d.name === dName)
          if (dIdx >= 0) {
            docs.splice(dIdx, 1)
            return { updatedOutput: output, summary: `Removed "${eId}" document "${dName}"` }
          }
          return { updatedOutput: output, summary: `Document "${dName}" not found in "${eId}"` }
        }
        default:
          return { updatedOutput: output, summary: `Unknown entity type "${entityType}"` }
      }
    }
    default:
      return { updatedOutput: output, summary: `Unknown tool "${toolName}"` }
  }
}

/**
 * Apply a revision patch, then re-apply the patched output to state via StateOperations.
 */
export function applyRevisionToState(
  phaseId: WBNPhaseId,
  phaseOutput: unknown,
  toolName: string,
  toolArgs: Record<string, unknown>,
  ctx: WorldEditorAIContext,
): { updatedOutput: unknown; summary: string } {
  const result = applyRevisionPatch(phaseOutput, toolName, toolArgs)

  // Re-apply the patched output to state
  const fakeSession = {
    phases: { [phaseId]: { output: result.updatedOutput } },
  } as unknown as WBNSession
  applyPhaseOutput(fakeSession, phaseId, ctx)

  return result
}
