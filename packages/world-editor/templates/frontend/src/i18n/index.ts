import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

// 导入翻译资源
import zhCommon from '../locales/zh/common.json'
import zhEditor from '../locales/zh/editor.json'
import zhCopilot from '../locales/zh/copilot.json'
import zhGame from '../locales/zh/game.json'

import jaCommon from '../locales/ja/common.json'
import jaEditor from '../locales/ja/editor.json'
import jaCopilot from '../locales/ja/copilot.json'
import jaGame from '../locales/ja/game.json'

import enCommon from '../locales/en/common.json'
import enEditor from '../locales/en/editor.json'
import enCopilot from '../locales/en/copilot.json'
import enGame from '../locales/en/game.json'

// 语言映射：根据系统语言映射到支持的语言
const languageMapping: Record<string, string> = {
  // 简体中文/繁体中文地区 -> 中文
  'zh': 'zh',
  'zh-CN': 'zh',
  'zh-TW': 'zh',
  'zh-HK': 'zh',
  'zh-SG': 'zh',
  // 日本地区 -> 日文
  'ja': 'ja',
  'ja-JP': 'ja',
  // 其他所有地区 -> 英文 (默认)
}

// 自定义语言检测器，用于映射系统语言
const customLanguageDetector = {
  name: 'customDetector',
  lookup() {
    // 获取浏览器语言
    const browserLang = navigator.language || (navigator as any).userLanguage
    // 检查是否有直接映射
    if (languageMapping[browserLang]) {
      return languageMapping[browserLang]
    }
    // 检查语言代码前缀
    const langPrefix = browserLang.split('-')[0]
    if (languageMapping[langPrefix]) {
      return languageMapping[langPrefix]
    }
    // 默认返回英文
    return 'en'
  },
  cacheUserLanguage() {}
}

const languageDetector = new LanguageDetector()
languageDetector.addDetector(customLanguageDetector)

i18n
  .use(languageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      zh: {
        common: zhCommon,
        editor: zhEditor,
        copilot: zhCopilot,
        game: zhGame
      },
      ja: {
        common: jaCommon,
        editor: jaEditor,
        copilot: jaCopilot,
        game: jaGame
      },
      en: {
        common: enCommon,
        editor: enEditor,
        copilot: enCopilot,
        game: enGame
      }
    },
    detection: {
      order: ['customDetector', 'localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'i18nextLng'
    },
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: ['common', 'editor', 'copilot', 'game'],
    interpolation: {
      escapeValue: false // React already handles escaping
    },
    react: {
      useSuspense: false
    }
  })

export default i18n

// 支持的语言列表
export const supportedLanguages = [
  { code: 'zh', name: '中文', nativeName: '中文' },
  { code: 'ja', name: '日本語', nativeName: '日本語' },
  { code: 'en', name: 'English', nativeName: 'English' }
]

// 切换语言
export const changeLanguage = (lng: string) => {
  i18n.changeLanguage(lng)
}

// 获取当前语言
export const getCurrentLanguage = () => i18n.language
