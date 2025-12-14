/**
 * Path Utils Tests
 */

import { describe, it, expect } from 'vitest'
import {
  normalizePath,
  normalizeAbsolutePath,
  getDirectory,
  getParentDirectory,
  getFilename,
  getExtension,
  joinPath,
  isAbsolutePath,
  stripJsonComments
} from '../../src/utils/path'

describe('path utils', () => {
  describe('normalizePath', () => {
    it('should resolve relative paths', () => {
      expect(normalizePath('/project/src', './utils.ts')).toBe('/project/src/utils.ts')
      expect(normalizePath('/project/src', '../lib/helper.ts')).toBe('/project/lib/helper.ts')
    })

    it('should handle multiple ..', () => {
      expect(normalizePath('/a/b/c', '../../x.ts')).toBe('/a/x.ts')
    })

    it('should handle absolute relative paths', () => {
      expect(normalizePath('/project', '/absolute/path.ts')).toBe('/absolute/path.ts')
    })

    it('should handle . in paths', () => {
      expect(normalizePath('/project', './a/./b/./c.ts')).toBe('/project/a/b/c.ts')
    })
  })

  describe('normalizeAbsolutePath', () => {
    it('should normalize . and ..', () => {
      expect(normalizeAbsolutePath('/a/b/../c')).toBe('/a/c')
      expect(normalizeAbsolutePath('/a/./b/./c')).toBe('/a/b/c')
      expect(normalizeAbsolutePath('/a/b/c/../../d')).toBe('/a/d')
    })

    it('should handle root path', () => {
      expect(normalizeAbsolutePath('/')).toBe('/')
    })

    it('should remove empty segments', () => {
      expect(normalizeAbsolutePath('/a//b///c')).toBe('/a/b/c')
    })
  })

  describe('getDirectory', () => {
    it('should return directory of file path', () => {
      expect(getDirectory('/project/src/main.ts')).toBe('/project/src')
      expect(getDirectory('/file.ts')).toBe('/')
    })
  })

  describe('getParentDirectory', () => {
    it('should return parent directory', () => {
      expect(getParentDirectory('/project/src')).toBe('/project')
      expect(getParentDirectory('/project')).toBe('/')
    })

    it('should return null for root', () => {
      expect(getParentDirectory('/')).toBe(null)
      expect(getParentDirectory('')).toBe(null)
    })

    it('should handle trailing slash', () => {
      expect(getParentDirectory('/project/src/')).toBe('/project')
    })
  })

  describe('getFilename', () => {
    it('should return filename from path', () => {
      expect(getFilename('/project/src/main.ts')).toBe('main.ts')
      expect(getFilename('file.ts')).toBe('file.ts')
    })
  })

  describe('getExtension', () => {
    it('should return file extension', () => {
      expect(getExtension('/project/main.ts')).toBe('.ts')
      expect(getExtension('/project/styles.css')).toBe('.css')
      expect(getExtension('/project/file')).toBe('')
    })

    it('should handle multiple dots', () => {
      expect(getExtension('/project/file.test.ts')).toBe('.ts')
    })
  })

  describe('joinPath', () => {
    it('should join path segments', () => {
      expect(joinPath('/project', 'src', 'main.ts')).toBe('/project/src/main.ts')
    })

    it('should normalize the result', () => {
      expect(joinPath('/project', '../lib', 'utils.ts')).toBe('/lib/utils.ts')
    })
  })

  describe('isAbsolutePath', () => {
    it('should detect absolute paths', () => {
      expect(isAbsolutePath('/project/src')).toBe(true)
      expect(isAbsolutePath('./relative')).toBe(false)
      expect(isAbsolutePath('../parent')).toBe(false)
      expect(isAbsolutePath('file.ts')).toBe(false)
    })
  })

  describe('stripJsonComments', () => {
    it('should remove single-line comments', () => {
      const input = `{
  "key": "value" // this is a comment
}`
      const result = stripJsonComments(input)
      expect(result).toContain('"key": "value"')
      expect(result).not.toContain('//')
    })

    it('should remove multi-line comments', () => {
      const input = `{
  /* comment */
  "key": "value"
}`
      const result = stripJsonComments(input)
      expect(result).toContain('"key": "value"')
      expect(result).not.toContain('/*')
      expect(result).not.toContain('*/')
    })

    it('should preserve strings with comment-like content', () => {
      const input = `{
  "url": "https://example.com/path",
  "comment": "this has // and /* */ inside"
}`
      const result = stripJsonComments(input)
      expect(result).toContain('"https://example.com/path"')
      expect(result).toContain('"this has // and /* */ inside"')
    })

    it('should handle escaped quotes in strings', () => {
      const input = `{
  "key": "value with \\"quotes\\"" // comment
}`
      const result = stripJsonComments(input)
      expect(result).toContain('"value with \\"quotes\\""')
      expect(result).not.toContain('// comment')
    })

    it('should produce valid JSON', () => {
      const input = `{
  // First property
  "name": "test",
  /* 
   * Multi-line comment
   */
  "version": "1.0.0"
}`
      const result = stripJsonComments(input)
      expect(() => JSON.parse(result)).not.toThrow()
      const parsed = JSON.parse(result)
      expect(parsed.name).toBe('test')
      expect(parsed.version).toBe('1.0.0')
    })
  })
})
