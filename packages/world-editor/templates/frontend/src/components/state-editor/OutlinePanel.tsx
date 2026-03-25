import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '../../i18n'
import './OutlinePanel.css'

// ============================================================================
// 类型定义
// ============================================================================

export interface OutlineItem {
  id: string           // 唯一标识，对应 data-outline-id
  label: string        // 显示文本
  icon?: string        // 图标 emoji
  level: number        // 层级 (0=顶级, 1=子项, 2=孙项...)
  count?: number       // 可选的计数显示
  children?: OutlineItem[]  // 子项（可选，用于树形结构）
}

export interface OutlinePanelProps {
  items: OutlineItem[]
  containerRef: React.RefObject<HTMLElement | null>  // 滚动容器的 ref
  title?: string
  defaultExpanded?: boolean
  /** 点击大纲项时的回调，在执行滚动之前调用，可用于展开折叠的区块 */
  onItemClick?: (item: OutlineItem) => void
}

// ============================================================================
// 大纲面板组件
// ============================================================================

// ============================================================================
// 大纲面板组件 - Modernized
// ============================================================================

export const OutlinePanel: React.FC<OutlinePanelProps> = ({
  items,
  containerRef,
  title,
  defaultExpanded = true,
  onItemClick
}) => {
  const { t } = useTranslation('editor')
  const displayTitle = title ?? t('sidebar.outline')
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set())
  const observerRef = useRef<IntersectionObserver | null>(null)

  // 初始化时展开所有顶级项
  useEffect(() => {
    const topLevelIds = items.filter(item => item.level === 0).map(item => item.id)
    setExpandedItems(new Set(topLevelIds))
  }, [items])

  // 设置 IntersectionObserver 监听当前可见区域
  useEffect(() => {
    if (!containerRef.current) return

    const container = containerRef.current

    observerRef.current = new IntersectionObserver(
      (entries) => {
        // 找到第一个可见的元素
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = entry.target.getAttribute('data-outline-id')
            if (id) {
              setActiveId(id)
              break
            }
          }
        }
      },
      {
        root: container,
        rootMargin: '-10% 0px -80% 0px', // 只关注顶部 10% 的区域
        threshold: 0
      }
    )

    // 观察所有带有 data-outline-id 的元素
    const elements = container.querySelectorAll('[data-outline-id]')
    elements.forEach(el => observerRef.current?.observe(el))

    return () => {
      observerRef.current?.disconnect()
    }
  }, [containerRef, items])

  // 点击大纲项跳转
  const handleItemClick = useCallback((item: OutlineItem) => {
    if (!containerRef.current) return

    // 先通知父组件，让它有机会展开折叠的区块
    if (onItemClick) {
      onItemClick(item)
    }

    // 使用 setTimeout 确保在父组件更新 DOM 后再执行滚动
    setTimeout(() => {
      const element = containerRef.current?.querySelector(`[data-outline-id="${item.id}"]`)
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' })
        setActiveId(item.id)
        
        // 添加高亮动画 (CSS animation defined externally or inline)
        element.animate([
            { background: 'rgba(59, 130, 246, 0.1)' },
            { background: 'transparent' }
        ], { duration: 1500 });
      }
    }, 50)
  }, [containerRef, onItemClick])

  // 切换子项展开/收起
  const toggleExpand = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setExpandedItems(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  // 递归渲染大纲项
  const renderItems = (itemList: OutlineItem[]): React.ReactNode => {
    return itemList.map(item => {
      const hasChildren = item.children && item.children.length > 0
      const isItemExpanded = expandedItems.has(item.id)
      const isActive = activeId === item.id

      return (
        <div key={item.id}>
          <div
            className={`tree-node-item ${isActive ? 'selected' : ''}`}
            onClick={() => handleItemClick(item)}
            style={{ paddingLeft: `${8 + item.level * 12}px` }}
          >
             <div className="tree-icon" style={{ opacity: 0.7, width: '16px', marginRight: '6px' }}>
                {item.icon ?? (hasChildren ? (isItemExpanded ? '📂' : '📁') : null)}
             </div>
             
             <div className="tree-label">
                {item.label}
             </div>

             {item.count !== undefined && (
                <span className="virtual-badge">({item.count})</span>
             )}

            {hasChildren && (
              <span 
                onClick={(e) => toggleExpand(item.id, e)}
                style={{ marginLeft: 'auto', padding: '0 4px', cursor: 'pointer', opacity: 0.6 }}
              >
                {isItemExpanded ? '▼' : '▶'}
              </span>
            )}
          </div>
          
          {hasChildren && isItemExpanded && (
            <div className="tree-children-container" style={{ marginLeft: `${12 + item.level * 12}px` }}>
              {renderItems(item.children!)}
            </div>
          )}
        </div>
      )
    })
  }

  // 扁平化 items 为树形结构（如果需要）- logic maintained but simplified
  const buildTree = (flatItems: OutlineItem[]): OutlineItem[] => {
    if (flatItems.some(item => item.children && item.children.length > 0)) {
      return flatItems
    }
    const result: OutlineItem[] = []
    const stack: OutlineItem[] = []
    for (const item of flatItems) {
      const newItem = { ...item, children: [] as OutlineItem[] }
      while (stack.length > 0 && stack[stack.length - 1].level >= item.level) {
        stack.pop()
      }
      if (stack.length === 0) {
        result.push(newItem)
      } else {
        stack[stack.length - 1].children!.push(newItem)
      }
      stack.push(newItem)
    }
    return result
  }

  const treeItems = buildTree(items)

  if (!isExpanded) {
      return (
          <div style={{ position: 'absolute', right: 0, top: '100px', background: 'rgba(15, 23, 42, 0.8)', padding: '8px', zIndex: 10, borderRadius: '8px 0 0 8px', border: '1px solid rgba(255,255,255,0.1)', borderRight: 'none', cursor: 'pointer' }} onClick={() => setIsExpanded(true)}>
             📑
          </div>
      )
  }

  return (
    <div className="editor-right-sidebar" style={{ height: '100%' }}>
      <div className="sidebar-header">
        <span>{displayTitle}</span>
        <div className="sidebar-actions">
           <button onClick={() => setIsExpanded(false)} title={t('sidebar.outline')}>
             ✕
           </button>
        </div>
      </div>
      <div className="tree-scroll-container">
        {treeItems.length > 0 ? (
          renderItems(treeItems)
        ) : (
          <div style={{ padding: '16px', textAlign: 'center', color: '#666' }}>{t('common:noContent')}</div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// 辅助 Hook：生成大纲数据
// ============================================================================

export interface UseOutlineOptions {
  // 可以扩展更多选项
}


/**
 * 用于生成世界编辑器的大纲数据
 */
export function useWorldOutline(
  world: {
    Registry?: { skills?: any[]; moves?: any[]; items?: any[] }
    CustomComponentRegistry?: { custom_components?: any[] }
    Log?: { entries?: any[] }
  }
): OutlineItem[] {
  const registry = world.Registry || {}
  const customComponentRegistry = world.CustomComponentRegistry || {}

  return [
    { id: 'world-time', label: i18n.t('outline.gameTime', { ns: 'editor' }), icon: '⏰', level: 0 },
    { id: 'world-skills', label: i18n.t('outline.skillsList', { ns: 'editor' }), icon: '📚', level: 0, count: registry.skills?.length || 0 },
    { id: 'world-moves', label: i18n.t('outline.movesList', { ns: 'editor' }), icon: '⚔️', level: 0, count: registry.moves?.length || 0 },
    { id: 'world-items', label: i18n.t('outline.itemsList', { ns: 'editor' }), icon: '🎒', level: 0, count: registry.items?.length || 0 },
    { id: 'world-custom-components', label: i18n.t('outline.customComponents', { ns: 'editor' }), icon: '🧩', level: 0, count: customComponentRegistry.custom_components?.length || 0 },
    { id: 'world-log', label: i18n.t('outline.worldLog', { ns: 'editor' }), icon: '📝', level: 0, count: world.Log?.entries?.length || 0 },
  ]
}

/**
 * 用于生成地域编辑器的大纲数据
 */
export function useRegionOutline(
  regions: Array<{ entity_id: number; Region?: { region_name?: string } }>
): OutlineItem[] {
  return regions.map(region => ({
    id: `region-${region.entity_id}`,
    label: region.Region?.region_name || `${i18n.t('outline.region', { ns: 'editor' })} ${region.entity_id}`,
    icon: '🗺️',
    level: 0
  }))
}

/**
 * 用于生成组织编辑器的大纲数据
 */
export function useOrganizationOutline(
  organizations: Array<{ entity_id: number; Organization?: { name?: string } }>
): OutlineItem[] {
  return organizations.map(org => ({
    id: `org-${org.entity_id}`,
    label: org.Organization?.name || `${i18n.t('outline.organization', { ns: 'editor' })} ${org.entity_id}`,
    icon: '🏛️',
    level: 0
  }))
}
