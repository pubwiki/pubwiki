import { createContext, useContext } from 'react'

// 注册表类型定义
export interface GameRegistries {
  skills: Map<string, { name: string, description?: string }>
  items: Map<string, { name: string, description?: string, detail?: string[] }>
  moves: Map<string, { name: string, desc: string, details: string[] }>
  customComponents: Map<string, { component_key: string, component_name: string, is_array: boolean, type_schema?: import('../../api/types').TypeSchema }>
  organizations: Map<string, { name: string }>
  creatures: Map<string, { name: string }>
  locations: Map<string, { name: string, description?: string }>
  regions: Map<string, { name: string }>
  entries: Map<string, string>
}

// 创建空的默认注册表
export const createEmptyRegistries = (): GameRegistries => ({
  skills: new Map(),
  items: new Map(),
  moves: new Map(),
  customComponents: new Map(),
  organizations: new Map(),
  creatures: new Map(),
  locations: new Map(),
  regions: new Map(),
  entries: new Map()
})

// Context
const RegistryContext = createContext<GameRegistries | null>(null)

// Provider 组件
export const RegistryProvider = RegistryContext.Provider

// Hook 获取注册表
export function useRegistries(): GameRegistries {
  const registries = useContext(RegistryContext)
  if (!registries) {
    console.warn('useRegistries must be used within a RegistryProvider')
    return createEmptyRegistries()
  }
  return registries
}

export default RegistryContext
