import React, { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { supportedLanguages, changeLanguage } from './index'

/**
 * 紧凑型语言选择器 - 适用于游戏内侧边栏
 * 显示为图标按钮，点击弹出语言选项
 */
export const CompactLanguageSelector: React.FC<{ className?: string }> = ({ className }) => {
  const { i18n } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} style={{ position: 'relative' }} className={className}>
      <button
        className="sidebar-icon-btn"
        onClick={() => setIsOpen(!isOpen)}
        title="Language"
        style={{ fontSize: '1.2rem' }}
      >
        🌐
      </button>
      {isOpen && (
        <div style={{
          position: 'absolute',
          left: '110%',
          top: '50%',
          transform: 'translateY(-50%)',
          background: '#fff',
          border: '1px solid rgba(44,40,37,0.12)',
          borderRadius: '8px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          overflow: 'hidden',
          zIndex: 9999,
          minWidth: '120px',
        }}>
          {supportedLanguages.map(lang => (
            <button
              key={lang.code}
              onClick={() => { changeLanguage(lang.code); setIsOpen(false) }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                padding: '8px 14px',
                background: lang.code === i18n.language ? 'rgba(139,43,26,0.08)' : 'transparent',
                border: 'none',
                color: lang.code === i18n.language ? '#8b2b1a' : '#6a645e',
                fontSize: '0.85rem',
                cursor: 'pointer',
                fontWeight: lang.code === i18n.language ? 600 : 400,
              }}
            >
              <span>{lang.nativeName}</span>
              {lang.code === i18n.language && <span style={{ marginLeft: '8px' }}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
