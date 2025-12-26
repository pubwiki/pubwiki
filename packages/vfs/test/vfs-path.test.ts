/**
 * Unit tests for VfsPath class
 * 
 * Tests path parsing, manipulation, comparison, and edge cases
 */

import { describe, it, expect } from 'vitest'
import { VfsPath } from '../src/utils/vfs-path'

describe('VfsPath', () => {
  describe('parse', () => {
    it('should parse absolute paths', () => {
      const path = VfsPath.parse('/src/file.ts')
      expect(path.segments).toEqual(['src', 'file.ts'])
      expect(path.toString()).toBe('/src/file.ts')
    })

    it('should parse paths without leading slash', () => {
      const path = VfsPath.parse('src/file.ts')
      expect(path.segments).toEqual(['src', 'file.ts'])
      expect(path.toString()).toBe('/src/file.ts')
    })

    it('should parse root path', () => {
      const path = VfsPath.parse('/')
      expect(path.segments).toEqual([])
      expect(path.isRoot).toBe(true)
      expect(path.toString()).toBe('/')
    })

    it('should parse empty string as root', () => {
      const path = VfsPath.parse('')
      expect(path.isRoot).toBe(true)
      expect(path.toString()).toBe('/')
    })

    it('should normalize multiple slashes', () => {
      const path = VfsPath.parse('///a//b///')
      expect(path.segments).toEqual(['a', 'b'])
      expect(path.toString()).toBe('/a/b')
    })

    it('should handle trailing slashes', () => {
      const path = VfsPath.parse('/src/lib/')
      expect(path.segments).toEqual(['src', 'lib'])
      expect(path.toString()).toBe('/src/lib')
    })
  })

  describe('fromSegments', () => {
    it('should create path from segments', () => {
      const path = VfsPath.fromSegments(['src', 'lib', 'index.ts'])
      expect(path.toString()).toBe('/src/lib/index.ts')
    })

    it('should filter empty segments', () => {
      const path = VfsPath.fromSegments(['src', '', 'file.ts'])
      expect(path.segments).toEqual(['src', 'file.ts'])
    })
  })

  describe('basic properties', () => {
    it('should return correct depth', () => {
      expect(VfsPath.root().depth).toBe(0)
      expect(VfsPath.parse('/src').depth).toBe(1)
      expect(VfsPath.parse('/src/lib/index.ts').depth).toBe(3)
    })

    it('should return correct name', () => {
      expect(VfsPath.parse('/src/file.ts').name).toBe('file.ts')
      expect(VfsPath.parse('/src').name).toBe('src')
      expect(VfsPath.root().name).toBe('')
    })

    it('should return correct extension', () => {
      expect(VfsPath.parse('/src/file.ts').extension).toBe('ts')
      expect(VfsPath.parse('/src/file.test.ts').extension).toBe('ts')
      expect(VfsPath.parse('/src/file').extension).toBe('')
      expect(VfsPath.parse('/.gitignore').extension).toBe('')
    })

    it('should return correct baseName', () => {
      expect(VfsPath.parse('/src/file.ts').baseName).toBe('file')
      expect(VfsPath.parse('/src/file.test.ts').baseName).toBe('file.test')
      expect(VfsPath.parse('/src/file').baseName).toBe('file')
    })

    it('should detect hidden files', () => {
      expect(VfsPath.parse('/.gitignore').isHidden).toBe(true)
      expect(VfsPath.parse('/src/.hidden').isHidden).toBe(true)
      expect(VfsPath.parse('/src/file.ts').isHidden).toBe(false)
    })
  })

  describe('at', () => {
    const path = VfsPath.parse('/a/b/c/d')

    it('should return segment at positive index', () => {
      expect(path.at(0)).toBe('a')
      expect(path.at(1)).toBe('b')
      expect(path.at(3)).toBe('d')
    })

    it('should return segment at negative index', () => {
      expect(path.at(-1)).toBe('d')
      expect(path.at(-2)).toBe('c')
      expect(path.at(-4)).toBe('a')
    })

    it('should return undefined for out of range index', () => {
      expect(path.at(4)).toBeUndefined()
      expect(path.at(-5)).toBeUndefined()
    })
  })

  describe('parent', () => {
    it('should return parent path', () => {
      expect(VfsPath.parse('/src/lib/index.ts').parent().toString()).toBe('/src/lib')
      expect(VfsPath.parse('/src/lib').parent().toString()).toBe('/src')
      expect(VfsPath.parse('/src').parent().toString()).toBe('/')
    })

    it('should return root for root path', () => {
      expect(VfsPath.root().parent().toString()).toBe('/')
      expect(VfsPath.root().parent().isRoot).toBe(true)
    })
  })

  describe('append', () => {
    it('should append single segment', () => {
      expect(VfsPath.parse('/src').append('file.ts').toString()).toBe('/src/file.ts')
    })

    it('should append multiple segments', () => {
      expect(VfsPath.root().append('src', 'lib', 'index.ts').toString()).toBe('/src/lib/index.ts')
    })

    it('should handle segments with slashes', () => {
      expect(VfsPath.parse('/src').append('lib/index.ts').toString()).toBe('/src/lib/index.ts')
    })

    it('should append to root', () => {
      expect(VfsPath.root().append('src').toString()).toBe('/src')
    })
  })

  describe('join', () => {
    it('should join two paths', () => {
      const base = VfsPath.parse('/src')
      const relative = VfsPath.parse('/lib/index.ts')
      expect(base.join(relative).toString()).toBe('/src/lib/index.ts')
    })
  })

  describe('take and skip', () => {
    const path = VfsPath.parse('/a/b/c/d')

    it('should take first n segments', () => {
      expect(path.take(2).toString()).toBe('/a/b')
      expect(path.take(0).toString()).toBe('/')
      expect(path.take(10).toString()).toBe('/a/b/c/d')
    })

    it('should skip first n segments', () => {
      expect(path.skip(2).toString()).toBe('/c/d')
      expect(path.skip(0).toString()).toBe('/a/b/c/d')
      expect(path.skip(10).toString()).toBe('/')
    })
  })

  describe('equals', () => {
    it('should return true for equal paths', () => {
      expect(VfsPath.parse('/src/file.ts').equals(VfsPath.parse('/src/file.ts'))).toBe(true)
      expect(VfsPath.root().equals(VfsPath.parse('/'))).toBe(true)
    })

    it('should return false for different paths', () => {
      expect(VfsPath.parse('/src/file.ts').equals(VfsPath.parse('/src/other.ts'))).toBe(false)
      expect(VfsPath.parse('/src').equals(VfsPath.parse('/src/file.ts'))).toBe(false)
    })
  })

  describe('isUnder', () => {
    it('should check if path is under base (non-strict)', () => {
      expect(VfsPath.parse('/src/file.ts').isUnder(VfsPath.parse('/src'))).toBe(true)
      expect(VfsPath.parse('/src/lib/index.ts').isUnder(VfsPath.parse('/src'))).toBe(true)
      expect(VfsPath.parse('/src').isUnder(VfsPath.parse('/src'))).toBe(true) // equal paths
      expect(VfsPath.parse('/other/file.ts').isUnder(VfsPath.parse('/src'))).toBe(false)
    })

    it('should check if path is under base (strict)', () => {
      expect(VfsPath.parse('/src/file.ts').isUnder(VfsPath.parse('/src'), true)).toBe(true)
      expect(VfsPath.parse('/src').isUnder(VfsPath.parse('/src'), true)).toBe(false) // equal paths
    })

    it('should handle root as base', () => {
      expect(VfsPath.parse('/src/file.ts').isUnder(VfsPath.root())).toBe(true)
      expect(VfsPath.root().isUnder(VfsPath.root())).toBe(true)
      expect(VfsPath.root().isUnder(VfsPath.root(), true)).toBe(false)
    })
  })

  describe('isDirectChildOf', () => {
    it('should detect direct children', () => {
      expect(VfsPath.parse('/src/file.ts').isDirectChildOf(VfsPath.parse('/src'))).toBe(true)
      expect(VfsPath.parse('/src').isDirectChildOf(VfsPath.root())).toBe(true)
    })

    it('should not detect non-direct children', () => {
      expect(VfsPath.parse('/src/lib/file.ts').isDirectChildOf(VfsPath.parse('/src'))).toBe(false)
      expect(VfsPath.parse('/src').isDirectChildOf(VfsPath.parse('/src'))).toBe(false)
    })
  })

  describe('relativeTo', () => {
    it('should return relative path', () => {
      const relative = VfsPath.parse('/src/lib/index.ts').relativeTo(VfsPath.parse('/src'))
      expect(relative).not.toBeNull()
      expect(relative!.toString()).toBe('/lib/index.ts')
    })

    it('should return root for equal paths', () => {
      const relative = VfsPath.parse('/src').relativeTo(VfsPath.parse('/src'))
      expect(relative).not.toBeNull()
      expect(relative!.isRoot).toBe(true)
    })

    it('should return null when not under base', () => {
      const relative = VfsPath.parse('/other/file.ts').relativeTo(VfsPath.parse('/src'))
      expect(relative).toBeNull()
    })

    it('should handle root base', () => {
      const relative = VfsPath.parse('/src/file.ts').relativeTo(VfsPath.root())
      expect(relative).not.toBeNull()
      expect(relative!.toString()).toBe('/src/file.ts')
    })
  })

  describe('commonAncestor', () => {
    it('should find common ancestor', () => {
      const ancestor = VfsPath.parse('/src/a/file.ts').commonAncestor(VfsPath.parse('/src/b/other.ts'))
      expect(ancestor.toString()).toBe('/src')
    })

    it('should return root for unrelated paths', () => {
      const ancestor = VfsPath.parse('/src/file.ts').commonAncestor(VfsPath.parse('/lib/other.ts'))
      expect(ancestor.isRoot).toBe(true)
    })

    it('should handle one path being prefix of other', () => {
      const ancestor = VfsPath.parse('/src').commonAncestor(VfsPath.parse('/src/lib/file.ts'))
      expect(ancestor.toString()).toBe('/src')
    })
  })

  describe('ancestors', () => {
    it('should iterate all ancestors including self', () => {
      const path = VfsPath.parse('/src/lib/index.ts')
      const ancestors = Array.from(path.ancestors()).map(p => p.toString())
      expect(ancestors).toEqual(['/', '/src', '/src/lib', '/src/lib/index.ts'])
    })

    it('should return just root for root path', () => {
      const ancestors = Array.from(VfsPath.root().ancestors()).map(p => p.toString())
      expect(ancestors).toEqual(['/'])
    })
  })

  describe('withName', () => {
    it('should replace file name', () => {
      expect(VfsPath.parse('/src/file.ts').withName('other.js').toString()).toBe('/src/other.js')
    })

    it('should handle root path', () => {
      expect(VfsPath.root().withName('src').toString()).toBe('/src')
    })
  })

  describe('withExtension', () => {
    it('should replace extension', () => {
      expect(VfsPath.parse('/src/file.ts').withExtension('js').toString()).toBe('/src/file.js')
      expect(VfsPath.parse('/src/file.ts').withExtension('.js').toString()).toBe('/src/file.js')
    })

    it('should remove extension when empty', () => {
      expect(VfsPath.parse('/src/file.ts').withExtension('').toString()).toBe('/src/file')
    })
  })
})
