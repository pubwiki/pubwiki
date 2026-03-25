import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { RegionEntity } from '../../api/types'
import type { GameRegistries } from './RegistryContext'
import './GameModals.css'

interface LocationModalProps {
  open: boolean
  regionEntity: RegionEntity | null
  locationId: string | null
  registries: GameRegistries
  onClose: () => void
  onShowInfo?: (info: { title: string, description?: string, details?: string[] }) => void
}

export default function LocationModal({
  open,
  regionEntity,
  locationId,
  registries,
  onClose,
  onShowInfo
}: LocationModalProps) {
  const { t } = useTranslation('game')
  if (!open || !regionEntity || !locationId) return null
  
  const region = regionEntity.Region
  const metadata = regionEntity.Metadata
  const currentLocation = (region.locations ?? []).find(loc => loc.id === locationId)
  
  // 获取地域名称，优先使用 metadata，然后从注册表查找，最后使用 ID
  const regionName = metadata?.name || registries.regions.get(region.region_id)?.name || region.region_id
  
  if (!currentLocation) return null
  
  return createPortal(
    <div className="game-modal-overlay" onClick={onClose}>
      <div className="game-modal location-modal" onClick={(e) => e.stopPropagation()}>
        <div className="game-modal-header">
          <h3>{currentLocation.name}</h3>
          <button className="game-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="game-modal-content">
          {/* 地点描述 */}
          {currentLocation.description && (
            <div className="location-section">
              <h4>{t('locationModal.description')}</h4>
              <p className="location-description">{currentLocation.description}</p>
            </div>
          )}
          
          {/* 地域信息 */}
          <div className="location-section">
            <h4>{t('locationModal.belongsToRegion', { name: regionName })}</h4>
            {metadata?.desc && (
              <p className="region-description">{metadata.desc}</p>
            )}
          </div>
          
          {/* 地域下其他地点 */}
          {(region.locations ?? []).length > 1 && (
            <div className="location-section">
              <h4>{t('locationModal.otherLocations')}</h4>
              <div className="locations-list">
                {(region.locations ?? [])
                  .filter(loc => loc.id !== locationId)
                  .map((loc, idx) => (
                    <div
                      key={idx}
                      className="location-item"
                      onClick={() => {
                        if (onShowInfo) {
                          onShowInfo({
                            title: t('locationModal.locationTitle', { name: loc.name }),
                            description: loc.description
                          })
                        }
                      }}
                      style={{ cursor: onShowInfo ? 'pointer' : 'default' }}
                    >
                      <span className="location-name">{loc.name}</span>
                      {loc.description && (
                        <span className="location-preview">{loc.description.slice(0, 30)}...</span>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* 设定文档 */}
          {regionEntity.BindSetting?.documents && regionEntity.BindSetting.documents.length > 0 && (
            <div className="location-section">
              <h4>{t('locationModal.settingDocs')}</h4>
              <div className="setting-docs-list">
                {regionEntity.BindSetting.documents.map((doc, idx) => (
                  <div
                    key={idx}
                    className={`setting-doc-item${doc.disable ? ' disabled' : ''}`}
                    onClick={() => !doc.disable && onShowInfo?.({ title: `${doc.name}`, description: doc.content })}
                  >
                    <span className="setting-doc-name">{doc.name}</span>
                    {doc.disable && <span className="setting-doc-badge disabled">{t('panel.disabled')}</span>}
                    {doc.static_priority !== undefined && !doc.disable && (
                      <span className="setting-doc-badge priority">P{doc.static_priority}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
