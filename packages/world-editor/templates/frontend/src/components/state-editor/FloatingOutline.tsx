/**
 * FloatingOutline - 浮动大纲导航
 * 替代原有右侧 OutlinePanel 面板
 * 固定在右下角，点击展开大纲列表
 */
import React, { useState, useEffect, useCallback, useRef } from 'react'
import type { OutlineItem } from './OutlinePanel'

interface FloatingOutlineProps {
  items: OutlineItem[]
  containerRef: React.RefObject<HTMLElement | null>
  onItemClick?: (item: OutlineItem) => void
  title?: string
}

export const FloatingOutline: React.FC<FloatingOutlineProps> = ({
  items,
  containerRef,
  onItemClick,
  title = 'Navigate'
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const popupRef = useRef<HTMLDivElement>(null)

  // Track active section via IntersectionObserver
  useEffect(() => {
    const container = containerRef.current
    if (!container || items.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = (entry.target as HTMLElement).dataset.outlineId
            if (id) setActiveId(id)
          }
        }
      },
      { root: container, threshold: 0.3 }
    )

    const elements = container.querySelectorAll('[data-outline-id]')
    elements.forEach(el => observer.observe(el))

    return () => observer.disconnect()
  }, [containerRef, items])

  // Close popup when clicking outside
  useEffect(() => {
    if (!isOpen) return
    const handleClick = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [isOpen])

  const handleItemClick = useCallback((item: OutlineItem) => {
    // Scroll to element
    const container = containerRef.current
    if (container) {
      const el = container.querySelector(`[data-outline-id="${item.id}"]`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    onItemClick?.(item)
  }, [containerRef, onItemClick])

  if (items.length === 0) return null

  return (
    <div className="paper-floating-outline" ref={popupRef} style={{
      position: 'absolute',
      bottom: '20px',
      right: '20px',
      zIndex: 'var(--paper-z-float-outline)' as any,
    }}>
      {/* Toggle button */}
      <button
        className="paper-outline-toggle"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '10px 18px',
          borderRadius: 'var(--paper-radius-pill)',
          border: '2.5px solid var(--paper-text-primary)',
          background: isOpen ? 'var(--paper-gradient-aurora)' : 'var(--paper-bg-secondary)',
          color: isOpen ? 'white' : 'var(--paper-text-primary)',
          fontWeight: 700,
          fontSize: '0.85rem',
          cursor: 'pointer',
          boxShadow: 'var(--paper-shadow-hard)',
          transition: 'all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      >
        🧭 {title}
      </button>

      {/* Popup list */}
      {isOpen && (
        <div
          className="paper-outline-popup"
          style={{
            position: 'absolute',
            bottom: '100%',
            right: 0,
            marginBottom: '8px',
            width: '260px',
            maxHeight: '360px',
            overflowY: 'auto',
            background: 'var(--paper-bg-glass-strong)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '2.5px solid var(--paper-text-primary)',
            borderRadius: 'var(--paper-radius-xl)',
            boxShadow: 'var(--paper-shadow-hard)',
            padding: '8px',
            animation: 'paper-bounce-in 0.2s ease-out',
          }}
        >
          {items.map(item => (
            <button
              key={item.id}
              onClick={() => handleItemClick(item)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                width: '100%',
                padding: '8px 12px',
                paddingLeft: `${12 + (item.level || 0) * 14}px`,
                border: 'none',
                borderRadius: 'var(--paper-radius-md)',
                background: activeId === item.id ? 'var(--paper-electric-blue-alpha)' : 'transparent',
                color: activeId === item.id ? 'var(--paper-electric-blue)' : 'var(--paper-text-secondary)',
                fontWeight: activeId === item.id ? 700 : 500,
                fontSize: '0.85rem',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.15s ease',
                borderLeft: activeId === item.id ? '3px solid var(--paper-electric-blue)' : '3px solid transparent',
              }}
              onMouseEnter={e => {
                if (activeId !== item.id) {
                  (e.target as HTMLElement).style.background = 'var(--paper-bg-tertiary)'
                }
              }}
              onMouseLeave={e => {
                if (activeId !== item.id) {
                  (e.target as HTMLElement).style.background = 'transparent'
                }
              }}
            >
              {item.icon && <span style={{ fontSize: '0.9rem' }}>{item.icon}</span>}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.label}
              </span>
              {item.count !== undefined && (
                <span style={{
                  marginLeft: 'auto',
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  padding: '1px 6px',
                  borderRadius: 'var(--paper-radius-pill)',
                  background: 'var(--paper-candy-purple-alpha)',
                  color: 'var(--paper-candy-purple)',
                }}>
                  {item.count}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default FloatingOutline
