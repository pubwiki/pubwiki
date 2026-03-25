import React, { useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import './GameModals.css'

export interface EntryModalProps {
  open: boolean
  entryName: string
  entryContent: string
  entriesMap: Map<string, string>
  onClose: () => void
  onShowEntry: (entryName: string) => void
}

interface ParsedEntry {
  name: string
  content: string
  references: string[]
}

export function EntryModal({
  open,
  entryName,
  entryContent,
  entriesMap,
  onClose,
  onShowEntry
}: EntryModalProps) {
  const { t } = useTranslation('game')
  // 解析词条内容，提取 <> 引用
  const parseEntry = (name: string, content: string): ParsedEntry => {
    const refPattern = /<([^>]+)>/g
    const references: string[] = []
    let match: RegExpExecArray | null
    
    while ((match = refPattern.exec(content)) !== null) {
      const refName = match[1]
      if (!references.includes(refName)) {
        references.push(refName)
      }
    }
    
    return { name, content, references }
  }

  // 递归获取所有引用的词条（包括次级词条的引用）
  const getAllReferencedEntries = useMemo(() => {
    const visited = new Set<string>()
    const result: ParsedEntry[] = []
    
    const collectReferences = (name: string) => {
      if (visited.has(name)) return
      visited.add(name)
      
      const content = entriesMap.get(name)
      if (!content) return
      
      const parsed = parseEntry(name, content)
      result.push(parsed)
      
      // 递归收集引用的词条
      parsed.references.forEach(refName => {
        collectReferences(refName)
      })
    }
    
    collectReferences(entryName)
    return result
  }, [entryName, entriesMap])

  // 渲染词条内容，将 <> 引用转换为可点击的链接
  const renderEntryContent = (content: string) => {
    const parts: React.ReactNode[] = []
    const refPattern = /<([^>]+)>/g
    let lastIndex = 0
    let match: RegExpExecArray | null
    let key = 0
    
    while ((match = refPattern.exec(content)) !== null) {
      // 添加引用前的文本
      if (match.index > lastIndex) {
        parts.push(content.substring(lastIndex, match.index))
      }
      
      // 添加可点击的引用
      const refName = match[1]
      parts.push(
        <span
          key={`ref-${key++}`}
          className="entry-reference"
          onClick={(e) => {
            e.stopPropagation()
            onShowEntry(refName)
          }}
        >
          {refName}
        </span>
      )
      
      lastIndex = match.index + match[0].length
    }
    
    // 添加剩余文本
    if (lastIndex < content.length) {
      parts.push(content.substring(lastIndex))
    }
    
    return parts
  }

  if (!open) return null

  const modalContent = (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="entry-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{entryName}</h3>
          <button className="modal-close" onClick={onClose}></button>
        </div>
        <div className="modal-body">
          {getAllReferencedEntries.map((entry, index) => (
            <div key={entry.name} className="entry-section">
              {index === 0 ? (
                // 主词条
                <div className="entry-main">
                  <p className="entry-content">{renderEntryContent(entry.content)}</p>
                  {entry.references.length > 0 && (
                    <div className="entry-references-hint">
                      {t('panel.references', { refs: entry.references.join(', ') })}
                    </div>
                  )}
                </div>
              ) : (
                // 次级词条
                <div className="entry-sub">
                  <h4 className="entry-sub-title">
                    <span
                      className="entry-sub-name"
                      onClick={(e) => {
                        e.stopPropagation()
                        onShowEntry(entry.name)
                      }}
                    >
                      {entry.name}
                    </span>
                  </h4>
                  <p className="entry-content">{renderEntryContent(entry.content)}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
}
