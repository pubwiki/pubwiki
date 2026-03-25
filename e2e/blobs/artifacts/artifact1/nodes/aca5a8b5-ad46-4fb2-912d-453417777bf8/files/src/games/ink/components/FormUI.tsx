/**
 * FormUI — 渲染 GameUI DSL 生成的交互式表单
 *
 * 支持两种模式：
 * - resource-select: 资源约束多选（商店、锻造、行动规划）
 * - slot-assign: 槽位分配（装备栏、技能编队）
 */

import React, { useState, useMemo, useCallback } from 'react'
import type {
  ParsedFormUI,
  ResourceSelectUI,
  SlotAssignUI,
  FormUIResult,
  ResourceSelectResult,
  SlotAssignResult,
  ItemDef,
} from '../utils/formUIDSL'

interface FormUIProps {
  parsed: ParsedFormUI
  disabled?: boolean
  onSubmit: (result: FormUIResult) => void
}

export function FormUI({ parsed, disabled, onSubmit }: FormUIProps) {
  if (parsed.mode === 'resource-select') {
    return <ResourceSelectForm ui={parsed} disabled={disabled} onSubmit={onSubmit} />
  }
  return <SlotAssignForm ui={parsed} disabled={disabled} onSubmit={onSubmit} />
}

// ─── Resource Select ───────────────────────────────────────────

function ResourceSelectForm({ ui, disabled, onSubmit }: { ui: ResourceSelectUI; disabled?: boolean; onSubmit: (r: FormUIResult) => void }) {
  const [quantities, setQuantities] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {}
    for (const item of ui.items) init[item.id] = 0
    return init
  })

  // 计算当前总消耗
  const totalCosts = useMemo(() => {
    const costs: Record<string, number> = {}
    for (const res of ui.resources) costs[res.id] = 0
    for (const item of ui.items) {
      const qty = quantities[item.id] || 0
      for (const cost of item.costs) {
        costs[cost.resourceId] = (costs[cost.resourceId] || 0) + cost.amount * qty
      }
    }
    return costs
  }, [quantities, ui.items, ui.resources])

  // 计算剩余资源
  const remaining = useMemo(() => {
    const rem: Record<string, number> = {}
    for (const res of ui.resources) {
      rem[res.id] = res.value - (totalCosts[res.id] || 0)
    }
    return rem
  }, [totalCosts, ui.resources])

  // 检查某个 item 是否可以 +1
  const canIncrement = useCallback((item: ItemDef) => {
    const qty = quantities[item.id] || 0
    if (qty >= item.constraints.max) return false
    // 检查所有资源是否足够
    for (const cost of item.costs) {
      if ((remaining[cost.resourceId] || 0) < cost.amount) return false
    }
    return true
  }, [quantities, remaining])

  const setQty = useCallback((itemId: string, qty: number) => {
    setQuantities(prev => ({ ...prev, [itemId]: qty }))
  }, [])

  const hasSelection = Object.values(quantities).some(q => q > 0)

  const handleSubmit = useCallback(() => {
    const selected = Object.entries(quantities)
      .filter(([, qty]) => qty > 0)
      .map(([id, qty]) => ({ id, qty }))
    onSubmit({ ui: 'resource-select', selected } as ResourceSelectResult)
  }, [quantities, onSubmit])

  return (
    <div className="form-ui form-ui-resource-select">
      {/* 标题与描述 */}
      <div className="form-ui-header">
        <div className="form-ui-title">{ui.title}</div>
        {ui.desc && <div className="form-ui-desc">{ui.desc}</div>}
      </div>

      {/* 资源栏 */}
      <div className="form-ui-resources">
        {ui.resources.map(res => {
          const rem = remaining[res.id] ?? res.value
          const spent = res.value - rem
          return (
            <div key={res.id} className={`form-ui-resource ${rem < 0 ? 'over-budget' : ''}`}>
              <span className="res-name">{res.displayName}</span>
              <span className="res-value">
                {spent > 0 ? (
                  <><span className="res-remaining">{rem}</span> / {res.value}</>
                ) : (
                  <>{res.value}</>
                )}
              </span>
            </div>
          )
        })}
      </div>

      {/* 物品列表 */}
      <div className="form-ui-items">
        {ui.items.map(item => {
          const qty = quantities[item.id] || 0
          const costText = item.costs.map(c => {
            const res = ui.resources.find(r => r.id === c.resourceId)
            return `${res?.displayName || c.resourceId} ×${c.amount}`
          }).join('  ')

          return (
            <div key={item.id} className={`form-ui-item ${qty > 0 ? 'selected' : ''}`}>
              <div className="item-main">
                <div className="item-name">{item.name}</div>
                {item.description && <div className="item-desc">{item.description}</div>}
                <div className="item-cost">{costText}</div>
                {item.constraints.own != null && (
                  <div className="item-own">已拥有: {item.constraints.own}</div>
                )}
              </div>
              <div className="item-qty-control">
                <button
                  className="qty-btn minus"
                  onClick={() => setQty(item.id, qty - 1)}
                  disabled={disabled || qty <= 0}
                >−</button>
                <span className="qty-value">{qty}</span>
                <button
                  className="qty-btn plus"
                  onClick={() => setQty(item.id, qty + 1)}
                  disabled={disabled || !canIncrement(item)}
                >+</button>
              </div>
            </div>
          )
        })}
      </div>

      {/* 提交按钮 */}
      <button
        className="form-ui-submit"
        onClick={handleSubmit}
        disabled={disabled || !hasSelection}
      >
        {ui.submit}
      </button>
    </div>
  )
}

// ─── Slot Assign ───────────────────────────────────────────────

function SlotAssignForm({ ui, disabled, onSubmit }: { ui: SlotAssignUI; disabled?: boolean; onSubmit: (r: FormUIResult) => void }) {
  const [assignments, setAssignments] = useState<Record<string, string | null>>(() => {
    const init: Record<string, string | null> = {}
    for (const slot of ui.slots) {
      init[slot.id] = slot.modifiers.defaultOpt || null
    }
    return init
  })

  // 已经被 unique 选项占用的 opt id
  const usedUniqueOpts = useMemo(() => {
    const used = new Set<string>()
    for (const optId of Object.values(assignments)) {
      if (!optId) continue
      const opt = ui.options.find(o => o.id === optId)
      if (opt?.modifiers.unique) used.add(optId)
    }
    return used
  }, [assignments, ui.options])

  // 获取某个 slot 可用的选项
  const getAvailableOptions = useCallback((slotId: string) => {
    const slot = ui.slots.find(s => s.id === slotId)
    if (!slot) return []
    return ui.options.filter(opt => {
      // tag filter
      if (slot.modifiers.filter && slot.modifiers.filter.length > 0) {
        if (!slot.modifiers.filter.some(f => opt.modifiers.tags.includes(f))) return false
      }
      // unique: 如果已被其他 slot 占用，不可选（除非就是当前 slot）
      if (opt.modifiers.unique && usedUniqueOpts.has(opt.id) && assignments[slotId] !== opt.id) return false
      return true
    })
  }, [ui.slots, ui.options, usedUniqueOpts, assignments])

  const setSlot = useCallback((slotId: string, optId: string | null) => {
    setAssignments(prev => ({ ...prev, [slotId]: optId }))
  }, [])

  // 检查必填 slot 是否都已分配
  const allRequiredFilled = ui.slots.every(slot =>
    !slot.modifiers.required || assignments[slot.id] != null
  )

  const handleSubmit = useCallback(() => {
    onSubmit({ ui: 'slot-assign', assignments } as SlotAssignResult)
  }, [assignments, onSubmit])

  return (
    <div className="form-ui form-ui-slot-assign">
      {/* 标题与描述 */}
      <div className="form-ui-header">
        <div className="form-ui-title">{ui.title}</div>
        {ui.desc && <div className="form-ui-desc">{ui.desc}</div>}
      </div>

      {/* 槽位列表 */}
      <div className="form-ui-slots">
        {ui.slots.map(slot => {
          const available = getAvailableOptions(slot.id)
          const currentOpt = assignments[slot.id]
          return (
            <div key={slot.id} className={`form-ui-slot ${slot.modifiers.required ? 'required' : ''}`}>
              <div className="slot-label">
                {slot.label}
                {slot.modifiers.required && <span className="slot-required">*</span>}
              </div>
              <select
                className="slot-select"
                value={currentOpt || ''}
                onChange={(e) => setSlot(slot.id, e.target.value || null)}
                disabled={disabled}
              >
                <option value="">— 空 —</option>
                {available.map(opt => (
                  <option key={opt.id} value={opt.id}>
                    {opt.name}{opt.description ? ` — ${opt.description}` : ''}
                  </option>
                ))}
              </select>
            </div>
          )
        })}
      </div>

      {/* 选项说明 */}
      <div className="form-ui-options-info">
        {ui.options.map(opt => {
          const isUsed = Object.values(assignments).includes(opt.id)
          return (
            <div key={opt.id} className={`form-ui-opt-info ${isUsed ? 'used' : ''}`}>
              <span className="opt-name">{opt.name}</span>
              {opt.modifiers.tags.length > 0 && (
                <span className="opt-tags">{opt.modifiers.tags.join(', ')}</span>
              )}
              {opt.description && <span className="opt-desc">{opt.description}</span>}
              {!opt.modifiers.unique && <span className="opt-reusable">可重复</span>}
            </div>
          )
        })}
      </div>

      {/* 提交按钮 */}
      <button
        className="form-ui-submit"
        onClick={handleSubmit}
        disabled={disabled || !allRequiredFilled}
      >
        {ui.submit}
      </button>
    </div>
  )
}
