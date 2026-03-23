// 游戏通用组件导出

export { default as InfoModal, type InfoModalContent, type InfoDetailItem } from './InfoModal'
export { default as CreatureModal } from './CreatureModal'
export { default as OrganizationModal } from './OrganizationModal'
export { default as LocationModal } from './LocationModal'
export { EntryModal } from './EntryModal'
export { 
  default as RegistryContext, 
  RegistryProvider, 
  useRegistries, 
  createEmptyRegistries,
  type GameRegistries 
} from './RegistryContext'
