/**
 * GameUI DSL v2 Parser
 *
 * 扁平无转义标记语言，用于 LLM 生成交互式表单 UI（商店/技能消耗/装备栏等）
 *
 * 支持两种模式：
 * - resource-select: 资源约束下的多选（商店购物、行动规划）
 * - slot-assign: 槽位分配（装备栏、技能编队）
 */

// ─── Parsed Types ──────────────────────────────────────────────

export interface ResourceDef {
  id: string
  displayName: string
  value: number
}

export interface ItemCost {
  resourceId: string
  amount: number
}

export interface ItemConstraints {
  max: number
  own?: number
  tag?: string
}

export interface ItemDef {
  id: string
  name: string
  costs: ItemCost[]
  constraints: ItemConstraints
  description: string
}

export interface SlotModifiers {
  required: boolean
  filter?: string[]  // tag filters
  defaultOpt?: string
}

export interface SlotDef {
  id: string
  label: string
  modifiers: SlotModifiers
}

export interface OptModifiers {
  unique: boolean  // true = can only be placed in one slot
  tags: string[]
}

export interface OptDef {
  id: string
  name: string
  modifiers: OptModifiers
  description: string
}

export interface ResourceSelectUI {
  mode: 'resource-select'
  title: string
  desc: string
  submit: string
  resources: ResourceDef[]
  items: ItemDef[]
}

export interface SlotAssignUI {
  mode: 'slot-assign'
  title: string
  desc: string
  submit: string
  slots: SlotDef[]
  options: OptDef[]
}

export type ParsedFormUI = ResourceSelectUI | SlotAssignUI

// ─── Submit Result Types ───────────────────────────────────────

export interface ResourceSelectResult {
  ui: 'resource-select'
  selected: Array<{ id: string; qty: number }>
}

export interface SlotAssignResult {
  ui: 'slot-assign'
  assignments: Record<string, string | null>
}

export type FormUIResult = ResourceSelectResult | SlotAssignResult

// ─── Parser ────────────────────────────────────────────────────

export function parseFormUI(dsl: string): ParsedFormUI | null {
  const lines = dsl.split('\n').map(l => l.trim()).filter(l => l.length > 0)

  // Find ::ui and ::end
  const startLine = lines.find(l => l.startsWith('::ui '))
  const endIdx = lines.findIndex(l => l === '::end')
  if (!startLine || endIdx < 0) return null

  const mode = startLine.replace('::ui ', '').trim()
  if (mode !== 'resource-select' && mode !== 'slot-assign') return null

  const startIdx = lines.indexOf(startLine)
  const bodyLines = lines.slice(startIdx + 1, endIdx)

  // Parse metadata (@key value)
  const meta: Record<string, string> = {}
  for (const line of bodyLines) {
    if (line.startsWith('@')) {
      const spaceIdx = line.indexOf(' ')
      if (spaceIdx > 0) {
        const key = line.slice(1, spaceIdx)
        meta[key] = line.slice(spaceIdx + 1)
      }
    }
  }

  if (mode === 'resource-select') {
    return parseResourceSelect(bodyLines, meta)
  } else {
    return parseSlotAssign(bodyLines, meta)
  }
}

function parseCosts(costStr: string): ItemCost[] {
  if (!costStr) return []
  return costStr.split(',').map(part => {
    const [resourceId, amountStr] = part.split(':')
    return { resourceId: resourceId.trim(), amount: parseInt(amountStr) || 0 }
  })
}

function parseConstraints(constraintStr: string): ItemConstraints {
  const result: ItemConstraints = { max: 1 }
  if (!constraintStr) return result
  for (const part of constraintStr.split(',')) {
    const [key, val] = part.split(':')
    const k = key.trim()
    if (k === 'max') result.max = parseInt(val) || 1
    else if (k === 'own') result.own = parseInt(val) || 0
    else if (k === 'tag') result.tag = val?.trim()
  }
  return result
}

function parseResourceSelect(lines: string[], meta: Record<string, string>): ResourceSelectUI {
  const resources: ResourceDef[] = []
  const items: ItemDef[] = []

  for (const line of lines) {
    if (line.startsWith('#res ')) {
      const parts = line.slice(5).split('|')
      if (parts.length >= 3) {
        resources.push({
          id: parts[0].trim(),
          displayName: parts[1].trim(),
          value: parseInt(parts[2]) || 0
        })
      }
    } else if (line.startsWith('#item ')) {
      const parts = line.slice(6).split('|')
      if (parts.length >= 3) {
        items.push({
          id: parts[0].trim(),
          name: parts[1].trim(),
          costs: parseCosts(parts[2] || ''),
          constraints: parseConstraints(parts[3] || ''),
          description: parts[4]?.trim() || ''
        })
      }
    }
  }

  return {
    mode: 'resource-select',
    title: meta.title || '',
    desc: meta.desc || '',
    submit: meta.submit || '确认',
    resources,
    items
  }
}

function parseSlotModifiers(modStr: string): SlotModifiers {
  const result: SlotModifiers = { required: false }
  if (!modStr) return result
  for (const part of modStr.split(',')) {
    const p = part.trim()
    if (p === 'required') result.required = true
    else if (p.startsWith('filter:')) {
      if (!result.filter) result.filter = []
      result.filter.push(p.slice(7))
    }
    else if (p.startsWith('default:')) result.defaultOpt = p.slice(8)
  }
  return result
}

function parseOptModifiers(modStr: string): OptModifiers {
  const result: OptModifiers = { unique: true, tags: [] }
  if (!modStr) return result
  for (const part of modStr.split(',')) {
    const p = part.trim()
    if (p === 'unique') result.unique = true
    else if (p === 'reusable') result.unique = false
    else if (p.startsWith('tag:')) result.tags.push(p.slice(4))
  }
  return result
}

function parseSlotAssign(lines: string[], meta: Record<string, string>): SlotAssignUI {
  const slots: SlotDef[] = []
  const options: OptDef[] = []

  for (const line of lines) {
    if (line.startsWith('#slot ')) {
      const parts = line.slice(6).split('|')
      if (parts.length >= 2) {
        slots.push({
          id: parts[0].trim(),
          label: parts[1].trim(),
          modifiers: parseSlotModifiers(parts[2] || '')
        })
      }
    } else if (line.startsWith('#opt ')) {
      const parts = line.slice(5).split('|')
      if (parts.length >= 2) {
        options.push({
          id: parts[0].trim(),
          name: parts[1].trim(),
          modifiers: parseOptModifiers(parts[2] || ''),
          description: parts[3]?.trim() || ''
        })
      }
    }
  }

  return {
    mode: 'slot-assign',
    title: meta.title || '',
    desc: meta.desc || '',
    submit: meta.submit || '确认',
    slots,
    options
  }
}

// ─── Helpers ───────────────────────────────────────────────────

/** 将表单提交结果格式化为玩家行动文本 */
export function formatFormUIResult(parsed: ParsedFormUI, result: FormUIResult): string {
  if (result.ui === 'resource-select' && parsed.mode === 'resource-select') {
    const selected = result.selected.filter(s => s.qty > 0)
    if (selected.length === 0) return `[${parsed.title}] 未选择任何项目`
    const lines = selected.map(s => {
      const item = parsed.items.find(i => i.id === s.id)
      const costText = item?.costs.map(c => {
        const res = parsed.resources.find(r => r.id === c.resourceId)
        return `${res?.displayName || c.resourceId} x${c.amount * s.qty}`
      }).join(', ') || ''
      return `${item?.name || s.id} x${s.qty}${costText ? ` (${costText})` : ''}`
    })
    return `[${parsed.title}] 选择了: ${lines.join('; ')}`
  }

  if (result.ui === 'slot-assign' && parsed.mode === 'slot-assign') {
    const entries = Object.entries(result.assignments).filter(([, v]) => v !== null)
    if (entries.length === 0) return `[${parsed.title}] 未分配任何选项`
    const lines = entries.map(([slotId, optId]) => {
      const slot = parsed.slots.find(s => s.id === slotId)
      const opt = parsed.options.find(o => o.id === optId)
      return `${slot?.label || slotId}: ${opt?.name || optId}`
    })
    return `[${parsed.title}] ${lines.join(', ')}`
  }

  return '[表单提交]'
}
