import { useTranslation } from 'react-i18next'
import type { CreatureEntity } from '../api/types'
import './CreatureList.css'

interface CreatureListProps {
  creaturesMap: Map<string, CreatureEntity>
  playerEntity: CreatureEntity | null
  onCreatureClick: (creature: CreatureEntity) => void
}

export default function CreatureList({
  creaturesMap,
  playerEntity,
  onCreatureClick
}: CreatureListProps) {
  const { t } = useTranslation(['game', 'common'])
  // 将 Map 转换为数组并排序（玩家排第一）
  const creatures = Array.from(creaturesMap.values()).sort((a, b) => {
    if (a.is_player) return -1
    if (b.is_player) return 1
    return (a.Creature?.name || '').localeCompare(b.Creature?.name || '')
  })

  if (creatures.length === 0) {
    return (
      <div className="creature-list">
        <h3>👥 {t('creatureList.title')}</h3>
        <div className="creature-list-empty">{t('creatureList.empty')}</div>
      </div>
    )
  }

  return (
    <div className="creature-list">
      <h3>👥 {t('creatureList.title')}</h3>
      <div className="creature-list-items">
        {creatures.map((creature) => {
          const attrs = creature.Creature
          const isPlayer = creature.is_player
          const isCurrentPlayer = playerEntity?.entity_id === creature.entity_id

          return (
            <div
              key={creature.entity_id}
              className={`creature-list-item ${isPlayer ? 'is-player' : ''} ${isCurrentPlayer ? 'is-current' : ''}`}
              onClick={() => onCreatureClick(creature)}
              title={t('creatureList.clickToView', { name: attrs?.name || t('common:unknown') })}
            >
              <span className="creature-icon">
                {isPlayer ? '👤' : '🎭'}
              </span>
              <span className="creature-name">
                {attrs?.name || t('common:unknown')}
              </span>
              {isPlayer && <span className="player-tag">{t('player')}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
