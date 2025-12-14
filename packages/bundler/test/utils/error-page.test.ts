/**
 * Error Page Utils Tests
 */

import { describe, it, expect } from 'vitest'
import { createBuildErrorPage, createSimpleErrorPage } from '../../src/utils/error-page'
import type { BuildError } from '../../src/types'

describe('error-page utils', () => {
  describe('createBuildErrorPage', () => {
    it('should create HTML page with error information', () => {
      const errors: BuildError[] = [
        {
          file: '/project/src/main.ts',
          line: 10,
          column: 5,
          message: 'Cannot find module "./missing"'
        }
      ]

      const html = createBuildErrorPage('/project/src/main.ts', errors)

      expect(html).toContain('<!DOCTYPE html>')
      expect(html).toContain('Build Failed')
      expect(html).toContain('/project/src/main.ts')
      expect(html).toContain('Cannot find module')
      expect(html).toContain('10:5')
    })

    it('should escape HTML in error messages', () => {
      const errors: BuildError[] = [
        {
          file: '/project/main.ts',
          line: 1,
          column: 1,
          message: '<script>alert("xss")</script>'
        }
      ]

      const html = createBuildErrorPage('/project/main.ts', errors)

      expect(html).not.toContain('<script>alert("xss")</script>')
      expect(html).toContain('&lt;script&gt;')
    })

    it('should include snippet when provided', () => {
      const errors: BuildError[] = [
        {
          file: '/project/main.ts',
          line: 5,
          column: 10,
          message: 'Type error',
          snippet: 'const x: string = 123'
        }
      ]

      const html = createBuildErrorPage('/project/main.ts', errors)

      expect(html).toContain('const x: string = 123')
    })

    it('should show correct error count', () => {
      const errors: BuildError[] = [
        { file: 'a.ts', line: 1, column: 1, message: 'Error 1' },
        { file: 'b.ts', line: 2, column: 1, message: 'Error 2' },
        { file: 'c.ts', line: 3, column: 1, message: 'Error 3' }
      ]

      const html = createBuildErrorPage('/project', errors)

      expect(html).toContain('3 errors found')
    })

    it('should use singular form for single error', () => {
      const errors: BuildError[] = [
        { file: 'a.ts', line: 1, column: 1, message: 'Error 1' }
      ]

      const html = createBuildErrorPage('/project', errors)

      expect(html).toContain('1 error found')
    })
  })

  describe('createSimpleErrorPage', () => {
    it('should create simple HTML error page', () => {
      const html = createSimpleErrorPage('Something went wrong')

      expect(html).toContain('<!DOCTYPE html>')
      expect(html).toContain('Error')
      expect(html).toContain('Something went wrong')
    })

    it('should escape HTML in message', () => {
      const html = createSimpleErrorPage('<script>bad</script>')

      expect(html).not.toContain('<script>bad</script>')
      expect(html).toContain('&lt;script&gt;')
    })
  })
})
