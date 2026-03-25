import { createPortal } from 'react-dom'
import './GameModals.css'

export interface InfoDetailItem {
  label: string
  value: string
  fieldKey?: string    // raw field name for quick scanning
  separator?: boolean  // true = render as section divider
}

export interface InfoModalContent {
  title: string
  description?: string
  details?: string[]
  structuredDetails?: InfoDetailItem[]
}

interface InfoModalProps {
  open: boolean
  content: InfoModalContent | null
  onClose: () => void
}

export default function InfoModal({ open, content, onClose }: InfoModalProps) {
  if (!open || !content) return null
  
  return createPortal(
    <div className="game-modal-overlay game-modal-high-priority" onClick={onClose}>
      <div className="game-modal" onClick={(e) => e.stopPropagation()}>
        <div className="game-modal-header">
          <h3>{content.title}</h3>
          <button className="game-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="game-modal-content">
          {content.description && (
            <p className="game-modal-description">{content.description}</p>
          )}
          {content.structuredDetails && content.structuredDetails.length > 0 && (
            <div className="game-modal-structured-details">
              {content.structuredDetails.map((item, idx) => (
                item.separator ? (
                  <div key={idx} className="structured-detail-separator">
                    <span>{item.label}</span>
                  </div>
                ) : (
                  <div key={idx} className="structured-detail-row">
                    <div className="structured-detail-label">
                      {item.fieldKey && <span className="structured-detail-key">{item.fieldKey}</span>}
                      {item.label !== item.fieldKey && <span className="structured-detail-desc">{item.label}</span>}
                    </div>
                    <div className="structured-detail-value">{item.value}</div>
                  </div>
                )
              ))}
            </div>
          )}
          {content.details && content.details.length > 0 && (
            <ul className="game-modal-details">
              {content.details.map((detail, idx) => (
                <li key={idx}>{detail}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
