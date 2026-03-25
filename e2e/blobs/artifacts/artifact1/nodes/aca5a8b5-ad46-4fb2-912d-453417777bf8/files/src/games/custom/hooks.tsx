import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useRegistryStore } from './stores/registryStore'
import { useCreatureStore } from './stores/creatureStore'
import { useModalStore } from './stores/modalStore'

/**
 * 高亮实体名称的 Hook（与 ink 相同逻辑，引用 galgame 的 stores）
 */
export function useHighlightEntities() {
  const { t } = useTranslation('game')
  const creaturesRegistry = useRegistryStore(s => s.creaturesRegistry)
  const organizationsRegistry = useRegistryStore(s => s.organizationsRegistry)
  const locationsRegistry = useRegistryStore(s => s.locationsRegistry)
  const regionsMap = useCreatureStore(s => s.regionsMap)
  const entriesMap = useRegistryStore(s => s.entriesMap)

  const { openCreatureModal, openOrganizationModal, openLocationModal, openEntryModal } = useModalStore()

  const highlightEntitiesInText = useCallback((text: string, keyPrefix: string) => {
    if (!text) return text

    const entities: Array<{
      name: string
      type: 'creature' | 'organization' | 'location' | 'entry'
      id: string
      regionId?: string
    }> = []

    creaturesRegistry.forEach((info, id) => {
      entities.push({ name: info.name, type: 'creature', id })
    })

    organizationsRegistry.forEach((info, id) => {
      entities.push({ name: info.name, type: 'organization', id })
    })

    locationsRegistry.forEach((info, id) => {
      const regionEntry = Array.from(regionsMap.entries()).find(([_, region]) =>
        (region.Region?.locations ?? []).some(loc => loc.id === id)
      )
      if (regionEntry) {
        entities.push({ name: info.name, type: 'location', id, regionId: regionEntry[0] })
      }
    })

    entriesMap.forEach((_, name) => {
      entities.push({ name, type: 'entry', id: name })
    })

    entities.sort((a, b) => b.name.length - a.name.length)

    if (entities.length === 0) return text

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
            title = t('galgame.highlight.viewCreature', { name: matchedName })
          } else if (primaryEntity.type === 'organization') {
            className = 'organization-name-highlight'
            onClick = () => openOrganizationModal(primaryEntity.id)
            title = t('galgame.highlight.viewOrganization', { name: matchedName })
          } else if (primaryEntity.type === 'location' && primaryEntity.regionId) {
            className = 'location-name-highlight'
            onClick = () => openLocationModal(primaryEntity.regionId!, primaryEntity.id)
            title = t('galgame.highlight.viewLocation', { name: matchedName })
          } else if (primaryEntity.type === 'entry') {
            className = 'entry-name-highlight'
            title = t('galgame.highlight.viewEntry', { name: matchedName })
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
                  title={t('galgame.highlight.viewEntryDetail')}
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
                  title={t('galgame.highlight.viewEntryDetail')}
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
  }, [t, creaturesRegistry, organizationsRegistry, locationsRegistry, regionsMap, entriesMap, openCreatureModal, openOrganizationModal, openLocationModal, openEntryModal])

  return { highlightEntitiesInText }
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
