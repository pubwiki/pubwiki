import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { CreatureEntity, OrganizationEntity } from '../../api/types'
import CreaturePanel from '../../components/CreaturePanel'
import type { GameRegistries } from './RegistryContext'
import type { InfoModalContent } from './InfoModal'
import './GameModals.css'

interface CreatureModalProps {
  open: boolean
  creature: CreatureEntity | null
  registries: GameRegistries
  onClose: () => void
  onShowInfo: (info: InfoModalContent) => void
  onShowOrganization?: (organizationId: string) => void
  onShowLocation?: (regionId: string, locationId: string) => void
}

export default function CreatureModal({
  open,
  creature,
  registries,
  onClose,
  onShowInfo,
  onShowOrganization,
  onShowLocation
}: CreatureModalProps) {
  const { t } = useTranslation('game')
  if (!open || !creature) return null
  
  return createPortal(
    <div className="game-modal-overlay" onClick={onClose}>
      <div className="game-modal creature-modal" onClick={(e) => e.stopPropagation()}>
        <div className="game-modal-header">
          <h3>
            {creature.is_player ? '' : ''} {creature.Creature?.name || t('panel.unknown')}
          </h3>
          <button className="game-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="game-modal-content creature-modal-content">
          <CreaturePanel
            creature={creature}
            loading={false}
            customComponentRegistry={registries.customComponents}
            regionsRegistry={registries.regions}
            locationsRegistry={registries.locations}
            organizationsRegistry={registries.organizations}
            creaturesRegistry={registries.creatures}
            onShowInfo={onShowInfo}
            onShowOrganization={onShowOrganization}
            onShowLocation={onShowLocation}
          />
        </div>
      </div>
    </div>,
    document.body
  )
}
