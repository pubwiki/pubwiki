/**
 * Project Detector
 *
 * Detects TypeScript/JavaScript project configuration by finding tsconfig.json
 * and reading its settings.
 */

import type { Vfs } from '@pubwiki/vfs'
import { getDirectory, getParentDirectory, normalizePath, stripJsonComments } from '../utils'

/**
 * Parsed content from tsconfig.json
 */
export interface TsConfigContent {
  files?: string[]
  compilerOptions?: Record<string, unknown>
  include?: string[]
  exclude?: string[]
}

/**
 * Project configuration detected from the file system
 */
export interface ProjectConfig {
  /** tsconfig.json path (null if not found) */
  tsconfigPath: string
  /** Project root directory */
  projectRoot: string | null
  /** Entry file list (from tsconfig.json files field) */
  entryFiles: string[]
  /** Whether the project can be built (requires tsconfig.json with files field) */
  isBuildable: boolean
  /** Parsed tsconfig.json content */
  tsconfigContent: TsConfigContent | null
}

/**
 * Read file content as string from Vfs
 */
async function readFileContent(vfs: Vfs, path: string): Promise<string | null> {
  try {
    const file = await vfs.readFile(path)
    if (file.content === null) return null
    if (file.content instanceof ArrayBuffer) {
      return new TextDecoder().decode(file.content)
    }
    return file.content as string
  } catch {
    return null
  }
}

/**
 * Parse tsconfig.json content
 */
async function parseTsConfig(
  tsconfigPath: string,
  vfs: Vfs
): Promise<TsConfigContent | null> {
  try {
    const content = await readFileContent(vfs, tsconfigPath)
    if (!content) return null

    // Remove comments and parse JSON
    const jsonContent = stripJsonComments(content)
    return JSON.parse(jsonContent)
  } catch (error) {
    console.error('[ProjectDetector] Failed to parse tsconfig.json:', error)
    return null
  }
}

/**
 * Find tsconfig.json by searching upward from a file
 */
export async function findTsConfig(
  filePath: string,
  vfs: Vfs
): Promise<string | null> {
  let currentDir = getDirectory(filePath)

  while (currentDir) {
    const tsconfigPath = currentDir === '/' 
      ? '/tsconfig.json' 
      : `${currentDir}/tsconfig.json`
    
    const exists = await vfs.exists(tsconfigPath)
    if (exists) {
      return tsconfigPath
    }

    const parent = getParentDirectory(currentDir)
    if (!parent || parent === currentDir) break
    currentDir = parent
  }

  return null
}

/**
 * Detect project configuration from a file path
 */
export async function detectProject(
  filePath: string,
  vfs: Vfs
): Promise<ProjectConfig | null> {
  const tsconfigPath = await findTsConfig(filePath, vfs)
  
  if (!tsconfigPath) {
    return null
  }

  const tsconfigContent = await parseTsConfig(tsconfigPath, vfs)
  
  if (!tsconfigContent) {
    return {
      tsconfigPath,
      projectRoot: getDirectory(tsconfigPath),
      entryFiles: [],
      isBuildable: false,
      tsconfigContent: null
    }
  }

  const projectRoot = getDirectory(tsconfigPath)
  const files = tsconfigContent.files || []
  
  // Resolve entry files relative to project root
  const entryFiles = files.map(file => 
    normalizePath(projectRoot, file)
  )

  console.log("Entry files", entryFiles, tsconfigContent)
  return {
    tsconfigPath,
    projectRoot,
    entryFiles,
    isBuildable: entryFiles.length > 0,
    tsconfigContent
  }
}

/**
 * Check if a file is an entry file
 */
export function isEntryFile(filePath: string, projectConfig: ProjectConfig): boolean {
  return projectConfig.entryFiles.includes(filePath)
}

/**
 * Get the default entry file from project config
 */
export function getDefaultEntryFile(projectConfig: ProjectConfig): string | null {
  return projectConfig.entryFiles[0] || null
}

/**
 * Get entry files from tsconfig.json path
 */
export async function getEntryFilesFromTsConfig(
  tsconfigPath: string,
  vfs: Vfs
): Promise<string[]> {
  const tsconfigContent = await parseTsConfig(tsconfigPath, vfs)
  
  if (!tsconfigContent || !tsconfigContent.files) {
    return []
  }

  const projectRoot = getDirectory(tsconfigPath)
  return tsconfigContent.files.map(file => 
    normalizePath(projectRoot, file)
  )
}
