import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { OrganizationEntity } from '../../api/types'
import type { GameRegistries } from './RegistryContext'
import './GameModals.css'

interface OrganizationModalProps {
  open: boolean
  organization: OrganizationEntity | null
  registries: GameRegistries
  onClose: () => void
  onShowInfo?: (info: { title: string, description?: string, details?: string[] }) => void
}

export default function OrganizationModal({
  open,
  organization,
  registries,
  onClose,
  onShowInfo
}: OrganizationModalProps) {
  const { t } = useTranslation('game')
  if (!open || !organization) return null
  
  const org = organization.Organization
  
  return createPortal(
    <div className="game-modal-overlay" onClick={onClose}>
      <div className="game-modal organization-modal" onClick={(e) => e.stopPropagation()}>
        <div className="game-modal-header">
          <h3>{org.name}</h3>
          <button className="game-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="game-modal-content">
          {/* 基本信息 */}
          <div className="org-section">
            <h4>{t('orgModal.basicInfo')}</h4>
            <div className="org-info-item">
              <span className="org-label">{t('orgModal.orgId')}</span>
              <span className="org-value">{org.organization_id}</span>
            </div>
            {org.description && (
              <div className="org-info-item">
                <span className="org-label">{t('orgModal.description')}</span>
                <span className="org-value">{org.description}</span>
              </div>
            )}
          </div>
          
          {/* 领地 */}
          {org.territories && org.territories.length > 0 && (
            <div className="org-section">
              <h4>{t('orgModal.territories')}</h4>
              <div className="org-territories">
                {org.territories.map((territory, idx) => {
                  const regionName = registries.regions.get(territory.region_id)?.name || territory.region_id
                  const locationName = registries.locations.get(territory.location_id)?.name || territory.location_id
                  return (
                    <div key={idx} className="territory-item">
                      <span className="territory-region">{regionName}</span>
                      <span className="territory-separator">·</span>
                      <span className="territory-location">{locationName}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          
          
          {/* 日志 */}
          {organization.Log?.entries && organization.Log.entries.length > 0 && (
            <div className="org-section">
              <h4>{t('orgModal.orgLog')}</h4>
              <div className="org-log">
                {organization.Log.entries.slice(-10).map((entry, idx) => (
                  <div key={idx} className="log-entry">
                    <div className="log-time">{entry.add_at}</div>
                    <div className="log-content">{entry.content}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 设定文档 */}
          {organization.BindSetting?.documents && organization.BindSetting.documents.length > 0 && (
            <div className="org-section">
              <h4>{t('orgModal.settingDocs')}</h4>
              <div className="setting-docs-list">
                {organization.BindSetting.documents.map((doc, idx) => (
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
