/**
 * Service Module
 */

export { BundlerService } from './bundler-service'
export {
  detectProject,
  findTsConfig,
  getEntryFilesFromTsConfig,
  isEntryFile,
  getDefaultEntryFile,
  type ProjectConfig,
  type TsConfigContent
} from './project-detector'
