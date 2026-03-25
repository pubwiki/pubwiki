import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useRegistryStore } from './stores/registryStore'
import { useCreatureStore } from './stores/creatureStore'
import { useModalStore } from './stores/modalStore'

/**
 * 高亮实体名称的 Hook
 * 将文本中的角色、组织、地点、词条名称高亮显示
 */
export function useHighlightEntities() {
  const { t } = useTranslation('game')
  const creaturesRegistry = useRegistryStore(s => s.creaturesRegistry)
  const organizationsRegistry = useRegistryStore(s => s.organizationsRegistry)
  const locationsRegistry = useRegistryStore(s => s.locationsRegistry)
  const regionsMap = useCreatureStore(s => s.regionsMap)
  const entriesMap = useRegistryStore(s => s.entriesMap)
  
  const { openCreatureModal, openOrganizationModal, openLocationModal, openEntryModal } = useModalStore()
  
  // 对文本片段进行实体高亮（包括词条）
  const highlightEntitiesInText = useCallback((text: string, keyPrefix: string) => {
    if (!text) return text
    
    // 收集所有需要高亮的实体和词条
    const entities: Array<{ 
      name: string
      type: 'creature' | 'organization' | 'location' | 'entry'
      id: string
      regionId?: string 
    }> = []
    
    // 添加角色
    creaturesRegistry.forEach((info, id) => {
      entities.push({ name: info.name, type: 'creature', id })
    })
    
    // 添加组织
    organizationsRegistry.forEach((info, id) => {
      entities.push({ name: info.name, type: 'organization', id })
    })
    
    // 添加地点（需要同时记录region_id）
    locationsRegistry.forEach((info, id) => {
      const regionEntry = Array.from(regionsMap.entries()).find(([_, region]) => 
        (region.Region?.locations ?? []).some(loc => loc.id === id)
      )
      if (regionEntry) {
        entities.push({ name: info.name, type: 'location', id, regionId: regionEntry[0] })
      }
    })
    
    // 添加词条
    entriesMap.forEach((_, name) => {
      entities.push({ name, type: 'entry', id: name })
    })
    
    // 按名字长度排序（长的优先匹配，避免短名字误匹配）
    entities.sort((a, b) => b.name.length - a.name.length)
    
    if (entities.length === 0) return text
    
    // 创建正则表达式来匹配所有实体名字
    const pattern = new RegExp(`(${entities.map(e => 
      e.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    ).join('|')})`, 'g')
    
    const parts: (string | JSX.Element)[] = []
    let lastIndex = 0
    let match: RegExpExecArray | null
    let keyCounter = 0
    
    while ((match = pattern.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(text.substring(lastIndex, match.index))
      }
      
      const matchedName = match[1]
      const matchedEntities = entities.filter(e => e.name === matchedName)
      
      if (matchedEntities.length > 0) {
        const primaryEntity = matchedEntities.find(e => e.type === 'creature') ||
                              matchedEntities.find(e => e.type === 'organization') ||
                              matchedEntities.find(e => e.type === 'location') ||
                              matchedEntities.find(e => e.type === 'entry')
        
        const hasEntry = matchedEntities.some(e => e.type === 'entry')
        
        if (primaryEntity) {
          let className = ''
          let onClick = () => {}
          let title = ''
          
          if (primaryEntity.type === 'creature') {
            className = 'creature-name-highlight'
            onClick = () => openCreatureModal(primaryEntity.id)
            title = t('ink.highlight.viewCreature', { name: matchedName })
          } else if (primaryEntity.type === 'organization') {
            className = 'organization-name-highlight'
            onClick = () => openOrganizationModal(primaryEntity.id)
            title = t('ink.highlight.viewOrganization', { name: matchedName })
          } else if (primaryEntity.type === 'location' && primaryEntity.regionId) {
            className = 'location-name-highlight'
            onClick = () => openLocationModal(primaryEntity.regionId!, primaryEntity.id)
            title = t('ink.highlight.viewLocation', { name: matchedName })
          } else if (primaryEntity.type === 'entry') {
            className = 'entry-name-highlight'
            title = t('ink.highlight.viewEntry', { name: matchedName })
          }
          
          if (primaryEntity.type === 'entry') {
            parts.push(
              <span 
                key={`${keyPrefix}-entity-${primaryEntity.type}-${keyCounter++}`}
                className={className}
                title={title}
              >
                {matchedName}
                <button
                  className="entry-button"
                  onClick={(e) => {
                    e.stopPropagation()
                    openEntryModal(primaryEntity.id)
                  }}
                  title={t('ink.highlight.viewEntryDetail')}
                >
                  ?
                </button>
              </span>
            )
          } else if (hasEntry) {
            parts.push(
              <span 
                key={`${keyPrefix}-entity-multi-${keyCounter++}`}
                className={className}
                onClick={onClick}
                title={title}
                style={{ cursor: 'pointer' }}
              >
                {matchedName}
                <button
                  className="entry-button"
                  onClick={(e) => {
                    e.stopPropagation()
                    openEntryModal(matchedName)
                  }}
                  title={t('ink.highlight.viewEntryDetail')}
                >
                  ?
                </button>
              </span>
            )
          } else {
            parts.push(
              <span 
                key={`${keyPrefix}-entity-${primaryEntity.type}-${keyCounter++}`}
                className={className}
                onClick={onClick}
                title={title}
                style={{ cursor: 'pointer' }}
              >
                {matchedName}
              </span>
            )
          }
        }
      } else {
        parts.push(matchedName)
      }
      
      lastIndex = pattern.lastIndex
    }
    
    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex))
    }
    
    return parts.length > 0 ? <>{parts}</> : text
  }, [creaturesRegistry, organizationsRegistry, locationsRegistry, regionsMap, entriesMap, openCreatureModal, openOrganizationModal, openLocationModal, openEntryModal, t])
  
  // 高亮实体名称和对话
  const highlightCreatureNames = useCallback((text: string) => {
    if (!text) return text
    
    const quotePattern = /"([^"]*)"|“([^”]*)”|「([^」]*)」/g
    const parts: (string | JSX.Element)[] = []
    let lastIndex = 0
    let match: RegExpExecArray | null
    let keyCounter = 0
    
    while ((match = quotePattern.exec(text)) !== null) {
      if (match.index > lastIndex) {
        const beforeText = text.substring(lastIndex, match.index)
        parts.push(highlightEntitiesInText(beforeText, `before-${keyCounter}`))
      }
      
      const dialogueText = match[1] ?? match[2] ?? match[3] ?? ''
      let openQuote = '"'
      let closeQuote = '"'
      
      if (match[1] !== undefined) {
        openQuote = '"'
        closeQuote = '"'
      } else if (match[2] !== undefined) {
        openQuote = '“'
        closeQuote = '”'
      } else if (match[3] !== undefined) {
        openQuote = '「'
        closeQuote = '」'
      }
      
      parts.push(
        <span key={`dialogue-${keyCounter++}`} className="dialogue-text">
          {openQuote}
          {highlightEntitiesInText(dialogueText, `dialogue-${keyCounter}`)}
          {closeQuote}
        </span>
      )
      
      lastIndex = quotePattern.lastIndex
    }
    
    if (lastIndex < text.length) {
      const remainingText = text.substring(lastIndex)
      parts.push(highlightEntitiesInText(remainingText, `after-${keyCounter}`))
    }
    
    return parts.length > 0 ? <>{parts}</> : text
  }, [highlightEntitiesInText])
  
  return { highlightCreatureNames, highlightEntitiesInText }
}

/**
 * 构建 registries 对象供模态框组件使用
 */
export function useGameRegistries() {
  const skillsRegistry = useRegistryStore(s => s.skillsRegistry)
  const itemsRegistry = useRegistryStore(s => s.itemsRegistry)
  const movesRegistry = useRegistryStore(s => s.movesRegistry)
  const customComponentRegistry = useRegistryStore(s => s.customComponentRegistry)
  const organizationsRegistry = useRegistryStore(s => s.organizationsRegistry)
  const creaturesRegistry = useRegistryStore(s => s.creaturesRegistry)
  const locationsRegistry = useRegistryStore(s => s.locationsRegistry)
  const regionsRegistry = useRegistryStore(s => s.regionsRegistry)
  const entriesMap = useRegistryStore(s => s.entriesMap)
  
  return useMemo(() => ({
    skills: skillsRegistry,
    items: itemsRegistry,
    moves: movesRegistry,
    customComponents: customComponentRegistry,
    organizations: organizationsRegistry,
    creatures: creaturesRegistry,
    locations: locationsRegistry,
    regions: regionsRegistry,
    entries: entriesMap
  }), [skillsRegistry, itemsRegistry, movesRegistry, customComponentRegistry, organizationsRegistry, creaturesRegistry, locationsRegistry, regionsRegistry, entriesMap])
}
