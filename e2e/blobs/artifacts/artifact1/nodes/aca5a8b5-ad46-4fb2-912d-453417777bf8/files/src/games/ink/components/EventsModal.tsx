/**
 * EventsModal - 剧情事件模态框
 *
 * 展示当前游戏世界中的所有剧情事件
 */

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { EventEntry } from '../../../api/types'

interface EventsModalProps {
  open: boolean
  onClose: () => void
  events: EventEntry[]
}

export function EventsModal({ open, onClose, events }: EventsModalProps) {
  const { t } = useTranslation('game')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  if (!open) return null

  const toggleExpand = (eventId: string) => {
    setExpandedId(prev => prev === eventId ? null : eventId)
  }

  return createPortal(
    <div className="events-modal-overlay" onClick={onClose}>
      <div className="events-modal-panel" onClick={(e) => e.stopPropagation()}>
        {/* 头部 */}
        <div className="events-modal-header">
          <h3>🎬 {t('ink.events.title')}</h3>
          <button className="events-modal-close" onClick={onClose}>✕</button>
        </div>

        {/* 事件列表 */}
        <div className="events-modal-body">
          {events.length === 0 ? (
            <div className="events-modal-empty">{t('ink.events.empty')}</div>
          ) : (
            <div className="events-list">
              {events.map((evt) => {
                const isExpanded = expandedId === evt.event_id
                return (
                  <div
                    key={evt.event_id}
                    className={`event-card ${isExpanded ? 'expanded' : ''}`}
                  >
                    <div
                      className="event-card-header"
                      onClick={() => toggleExpand(evt.event_id)}
                    >
                      <span className="event-expand-icon">{isExpanded ? '▼' : '▶'}</span>
                      <div className="event-card-title">
                        <span className="event-title">{evt.title}</span>
                        {evt.created_at && (
                          <span className="event-time">{evt.created_at}</span>
                        )}
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="event-card-summary">{evt.summary}</div>
                    )}
                    {isExpanded && (
                      <div className="event-card-content">
                        <pre>{evt.content}</pre>
                        {evt.related_entities && evt.related_entities.length > 0 && (
                          <div className="event-related">
                            <span className="event-related-label">{t('ink.events.relatedEntities')}:</span>
                            {evt.related_entities.map((id, i) => (
                              <span key={i} className="event-related-tag">{id}</span>
                            ))}
                          </div>
                        )}
                        {evt.updated_at && (
                          <div className="event-updated">
                            {t('ink.events.updatedAt')}: {evt.updated_at}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
