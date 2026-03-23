/**
 * BentoEditModal - 多巴胺风格编辑模态框
 * 用于 bento grid 中"重展示，轻编辑"模式：
 * 卡片上展示摘要，点击编辑按钮打开此模态框进行详细编辑
 */
import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

interface BentoEditModalProps {
  open: boolean
  onClose: () => void
  title: string
  icon?: string
  /** 宽度模式: normal (~640px), wide (~900px), full (~1200px) */
  size?: 'normal' | 'wide' | 'full'
  children: React.ReactNode
}

export const BentoEditModal: React.FC<BentoEditModalProps> = ({
  open,
  onClose,
  title,
  icon,
  size = 'normal',
  children
}) => {
  const { t } = useTranslation('editor')

  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="paper-editor paper-modal-overlay" onClick={onClose}>
      <div
        className={`paper-modal paper-modal-${size}`}
        onClick={e => e.stopPropagation()}
      >
        <div className="paper-modal-header">
          <h3>
            {icon && <span className="paper-modal-icon">{icon}</span>}
            {title}
          </h3>
          <button className="paper-modal-close" onClick={onClose} title={t('common:close') || 'Close'}>
            ✕
          </button>
        </div>
        <div className="paper-modal-body">
          {children}
        </div>
      </div>
    </div>,
    document.body
  )
}

export default BentoEditModal
