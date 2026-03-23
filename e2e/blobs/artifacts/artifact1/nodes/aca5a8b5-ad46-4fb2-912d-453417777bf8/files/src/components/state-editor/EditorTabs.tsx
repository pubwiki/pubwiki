/**
 * EditorTabs - 顶部水平标签导航
 * 替代原有的 EditorSidebar 垂直侧边栏
 * 多巴胺风格：pill shape 按钮，渐变活跃态
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { TabType } from './types'

interface NavItem {
  key: TabType
  label: string
  icon: string
  badge?: number
}

interface NavGroup {
  label: string
  items: NavItem[]
}

interface EditorTabsProps {
  activeTab: TabType
  onTabChange: (tab: TabType) => void
  simpleMode?: boolean
  /** 禁用所有 tab 切换（世界构建器运行时） */
  disabled?: boolean
}

export const EditorTabs: React.FC<EditorTabsProps> = ({ activeTab, onTabChange, disabled }) => {
  const { t } = useTranslation('editor')

  const navGroups: NavGroup[] = [
    {
      label: t('sidebar.worldBuilding'),
      items: [
        { key: 'world', label: t('sidebar.world'), icon: '🌍' },
        { key: 'creatures', label: t('sidebar.creatures'), icon: '👥' },
        { key: 'regions', label: t('sidebar.regions'), icon: '🗺️' },
        { key: 'organizations', label: t('sidebar.organizations'), icon: '🏛️' },
      ]
    },
    {
      label: t('sidebar.storyFlow'),
      items: [
        { key: 'initial-story', label: t('sidebar.initialStory'), icon: '🎬' },
        { key: 'story-history', label: t('sidebar.storyHistory'), icon: '📜' },
      ]
    },
  ]

  const filteredGroups = navGroups

  return (
    <nav className="paper-tabs">
      {filteredGroups.map((group, groupIndex) => (
        <React.Fragment key={groupIndex}>
          {groupIndex > 0 && <span className="paper-tab-separator" />}
          {group.items.map(item => (
            <button
              key={item.key}
              className={`paper-tab-btn ${activeTab === item.key ? 'active' : ''}`}
              disabled={disabled}
              onClick={() => !disabled && onTabChange(item.key)}
              title={item.label}
            >
              <span className="paper-tab-icon">{item.icon}</span>
              <span className="paper-tab-text">{item.label}</span>
              {item.badge !== undefined && item.badge > 0 && (
                <span className="paper-tab-badge">{item.badge}</span>
              )}
            </button>
          ))}
        </React.Fragment>
      ))}
    </nav>
  )
}

export default EditorTabs
