import React, { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { supportedLanguages, changeLanguage } from './index'
import './LanguageSelector.css'

/**
 * 语言选择器组件
 * 显示当前语言，点击后展开下拉菜单选择语言
 */
export const LanguageSelector: React.FC = () => {
  const { i18n } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const currentLang = supportedLanguages.find(l => l.code === i18n.language) || supportedLanguages[2] // 默认英语

  // 点击外部关闭下拉菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleLanguageChange = (langCode: string) => {
    changeLanguage(langCode)
    setIsOpen(false)
  }

  return (
    <div className="language-selector" ref={dropdownRef}>
      <button 
        className="language-selector-trigger"
        onClick={() => setIsOpen(!isOpen)}
        title="Change Language"
      >
        <span className="language-icon">🌐</span>
        <span className="language-name">{currentLang.nativeName}</span>
        <span className="dropdown-arrow">{isOpen ? '▲' : '▼'}</span>
      </button>
      
      {isOpen && (
        <div className="language-dropdown">
          {supportedLanguages.map(lang => (
            <button
              key={lang.code}
              className={`language-option ${lang.code === i18n.language ? 'active' : ''}`}
              onClick={() => handleLanguageChange(lang.code)}
            >
              <span className="language-native">{lang.nativeName}</span>
              {lang.code === i18n.language && <span className="check-mark">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default LanguageSelector
