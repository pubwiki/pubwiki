/**
 * Project Detector Tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import type { Vfs } from '@pubwiki/vfs'
import {
  detectProject,
  findTsConfig,
  getEntryFilesFromTsConfig,
  isEntryFile,
  getDefaultEntryFile,
  type ProjectConfig
} from '../../src/service/project-detector'
import { createTestVfs, addFile } from '../helpers'

describe('project-detector', () => {
  let vfs: Vfs

  beforeEach(() => {
    vfs = createTestVfs()
  })

  describe('findTsConfig', () => {
    it('should find tsconfig.json in same directory', async () => {
      await addFile(vfs, '/project/tsconfig.json', '{}')
      await addFile(vfs, '/project/src/main.ts', '')
      
      const result = await findTsConfig('/project/src/main.ts', vfs)
      
      expect(result).toBe('/project/tsconfig.json')
    })

    it('should find tsconfig.json in parent directory', async () => {
      await addFile(vfs, '/project/tsconfig.json', '{}')
      await addFile(vfs, '/project/src/deep/main.ts', '')
      
      const result = await findTsConfig('/project/src/deep/main.ts', vfs)
      
      expect(result).toBe('/project/tsconfig.json')
    })

    it('should return null if no tsconfig found', async () => {
      await addFile(vfs, '/project/src/main.ts', '')
      
      const result = await findTsConfig('/project/src/main.ts', vfs)
      
      expect(result).toBe(null)
    })

    it('should find tsconfig at root', async () => {
      await addFile(vfs, '/tsconfig.json', '{}')
      await addFile(vfs, '/src/main.ts', '')
      
      const result = await findTsConfig('/src/main.ts', vfs)
      
      expect(result).toBe('/tsconfig.json')
    })
  })

  describe('detectProject', () => {
    it('should detect project with files field', async () => {
      await addFile(vfs, '/project/tsconfig.json', JSON.stringify({
        compilerOptions: { target: 'ES2020' },
        files: ['src/main.ts', 'src/app.tsx']
      }))
      await addFile(vfs, '/project/src/main.ts', '')
      
      const result = await detectProject('/project/src/main.ts', vfs)
      
      expect(result).not.toBe(null)
      expect(result!.tsconfigPath).toBe('/project/tsconfig.json')
      expect(result!.projectRoot).toBe('/project')
      expect(result!.entryFiles).toEqual(['/project/src/main.ts', '/project/src/app.tsx'])
      expect(result!.isBuildable).toBe(true)
    })

    it('should return not buildable if no files field', async () => {
      await addFile(vfs, '/project/tsconfig.json', JSON.stringify({
        compilerOptions: { target: 'ES2020' }
      }))
      await addFile(vfs, '/project/src/main.ts', '')
      
      const result = await detectProject('/project/src/main.ts', vfs)
      
      expect(result).not.toBe(null)
      expect(result!.isBuildable).toBe(false)
      expect(result!.entryFiles).toEqual([])
    })

    it('should return null if no tsconfig found', async () => {
      await addFile(vfs, '/project/src/main.ts', '')
      
      const result = await detectProject('/project/src/main.ts', vfs)
      
      expect(result).toBe(null)
    })

    it('should handle tsconfig with comments', async () => {
      await addFile(vfs, '/project/tsconfig.json', `{
        // This is a comment
        "compilerOptions": {
          "target": "ES2020" /* inline comment */
        },
        "files": ["src/main.ts"]
      }`)
      await addFile(vfs, '/project/src/main.ts', '')
      
      const result = await detectProject('/project/src/main.ts', vfs)
      
      expect(result).not.toBe(null)
      expect(result!.entryFiles).toEqual(['/project/src/main.ts'])
    })

    it('should resolve relative paths in files field', async () => {
      await addFile(vfs, '/project/tsconfig.json', JSON.stringify({
        files: ['./src/main.ts', '../lib/utils.ts']
      }))
      
      const result = await detectProject('/project/src/main.ts', vfs)
      
      expect(result!.entryFiles).toContain('/project/src/main.ts')
      expect(result!.entryFiles).toContain('/lib/utils.ts')
    })
  })

  describe('getEntryFilesFromTsConfig', () => {
    it('should return entry files from tsconfig', async () => {
      await addFile(vfs, '/project/tsconfig.json', JSON.stringify({
        files: ['src/a.ts', 'src/b.ts']
      }))
      
      const result = await getEntryFilesFromTsConfig('/project/tsconfig.json', vfs)
      
      expect(result).toEqual(['/project/src/a.ts', '/project/src/b.ts'])
    })

    it('should return empty array if no files field', async () => {
      await addFile(vfs, '/project/tsconfig.json', JSON.stringify({
        compilerOptions: {}
      }))
      
      const result = await getEntryFilesFromTsConfig('/project/tsconfig.json', vfs)
      
      expect(result).toEqual([])
    })
  })

  describe('isEntryFile', () => {
    it('should return true for entry file', () => {
      const config: ProjectConfig = {
        tsconfigPath: '/project/tsconfig.json',
        projectRoot: '/project',
        entryFiles: ['/project/src/main.ts', '/project/src/app.tsx'],
        isBuildable: true,
        tsconfigContent: null
      }
      
      expect(isEntryFile('/project/src/main.ts', config)).toBe(true)
      expect(isEntryFile('/project/src/app.tsx', config)).toBe(true)
    })

    it('should return false for non-entry file', () => {
      const config: ProjectConfig = {
        tsconfigPath: '/project/tsconfig.json',
        projectRoot: '/project',
        entryFiles: ['/project/src/main.ts'],
        isBuildable: true,
        tsconfigContent: null
      }
      
      expect(isEntryFile('/project/src/utils.ts', config)).toBe(false)
    })
  })

  describe('getDefaultEntryFile', () => {
    it('should return first entry file', () => {
      const config: ProjectConfig = {
        tsconfigPath: '/project/tsconfig.json',
        projectRoot: '/project',
        entryFiles: ['/project/src/main.ts', '/project/src/app.tsx'],
        isBuildable: true,
        tsconfigContent: null
      }
      
      expect(getDefaultEntryFile(config)).toBe('/project/src/main.ts')
    })

    it('should return null if no entry files', () => {
      const config: ProjectConfig = {
        tsconfigPath: '/project/tsconfig.json',
        projectRoot: '/project',
        entryFiles: [],
        isBuildable: false,
        tsconfigContent: null
      }
      
      expect(getDefaultEntryFile(config)).toBe(null)
    })
  })
})
