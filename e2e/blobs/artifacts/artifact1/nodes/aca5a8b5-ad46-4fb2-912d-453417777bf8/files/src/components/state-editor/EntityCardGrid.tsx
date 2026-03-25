/**
 * EntityCardGrid - 可复用的实体卡片网格组件
 * 用于 CreaturesEditor / RegionsEditor / OrganizationsEditor
 * 多巴胺风格：弹性卡片、渐变徽章、硬阴影
 */
import React from 'react'
import { useTranslation } from 'react-i18next'

export type SortOrder = 'original' | 'az' | 'za'

interface EntityCardGridProps {
  /** 排序模式 */
  sortOrder: SortOrder
  /** 排序变更回调 */
  onSortChange: (order: SortOrder) => void
  /** 操作按钮区域（添加按钮等） */
  actions?: React.ReactNode
  /** 空列表提示 */
  emptyLabel: string
  /** 网格内容（由父组件渲染具体卡片） */
  children: React.ReactNode
  /** 是否有内容 */
  hasItems: boolean
}

export const EntityCardGrid: React.FC<EntityCardGridProps> = ({
  sortOrder,
  onSortChange,
  actions,
  emptyLabel,
  children,
  hasItems
}) => {
  const { t } = useTranslation('editor')

  return (
    <div className="paper-entity-grid-section">
      {/* Toolbar row */}
      <div className="paper-grid-toolbar">
        {actions}
      </div>

      {/* Card grid */}
      <div className="paper-entity-card-grid">
        {hasItems ? children : (
          <div className="paper-grid-empty">{emptyLabel}</div>
        )}
      </div>
    </div>
  )
}

export default EntityCardGrid
