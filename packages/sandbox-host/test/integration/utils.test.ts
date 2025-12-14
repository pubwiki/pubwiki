/**
 * Utility Functions Tests
 *
 * Tests for the utility functions exported by @pubwiki/sandbox-host.
 */

import { describe, it, expect } from 'vitest'
import { getMimeType, normalizePath, createBuildErrorPage, createSimpleErrorPage } from '../../src/utils'

describe('getMimeType', () => {
  describe('HTML files', () => {
    it('should return text/html for .html files', () => {
      expect(getMimeType('/index.html')).toBe('text/html')
      expect(getMimeType('/pages/about.html')).toBe('text/html')
    })

    it('should return text/html for .htm files', () => {
      expect(getMimeType('/page.htm')).toBe('text/html')
    })
  })

  describe('JavaScript files', () => {
    it('should return application/javascript for .js files', () => {
      expect(getMimeType('/app.js')).toBe('application/javascript')
      expect(getMimeType('/lib/utils.js')).toBe('application/javascript')
    })

    it('should return application/javascript for .mjs files', () => {
      expect(getMimeType('/module.mjs')).toBe('application/javascript')
    })
  })

  describe('TypeScript files', () => {
    it('should return application/typescript for .ts files', () => {
      expect(getMimeType('/app.ts')).toBe('application/typescript')
    })

    it('should return application/typescript for .tsx files', () => {
      expect(getMimeType('/component.tsx')).toBe('application/typescript')
    })

    it('should return application/javascript for .jsx files', () => {
      expect(getMimeType('/component.jsx')).toBe('application/javascript')
    })
  })

  describe('CSS files', () => {
    it('should return text/css for .css files', () => {
      expect(getMimeType('/styles.css')).toBe('text/css')
      expect(getMimeType('/src/app.css')).toBe('text/css')
    })
  })

  describe('JSON files', () => {
    it('should return application/json for .json files', () => {
      expect(getMimeType('/config.json')).toBe('application/json')
      expect(getMimeType('/data/manifest.json')).toBe('application/json')
    })
  })

  describe('Image files', () => {
    it('should return image/png for .png files', () => {
      expect(getMimeType('/logo.png')).toBe('image/png')
    })

    it('should return image/jpeg for .jpg files', () => {
      expect(getMimeType('/photo.jpg')).toBe('image/jpeg')
    })

    it('should return image/jpeg for .jpeg files', () => {
      expect(getMimeType('/photo.jpeg')).toBe('image/jpeg')
    })

    it('should return image/gif for .gif files', () => {
      expect(getMimeType('/animation.gif')).toBe('image/gif')
    })

    it('should return image/svg+xml for .svg files', () => {
      expect(getMimeType('/icon.svg')).toBe('image/svg+xml')
    })

    it('should return image/webp for .webp files', () => {
      expect(getMimeType('/image.webp')).toBe('image/webp')
    })
  })

  describe('Font files', () => {
    it('should return font/woff for .woff files', () => {
      expect(getMimeType('/font.woff')).toBe('font/woff')
    })

    it('should return font/woff2 for .woff2 files', () => {
      expect(getMimeType('/font.woff2')).toBe('font/woff2')
    })

    it('should return font/ttf for .ttf files', () => {
      expect(getMimeType('/font.ttf')).toBe('font/ttf')
    })
  })

  describe('Default case', () => {
    it('should return application/octet-stream for unknown extensions', () => {
      expect(getMimeType('/file.xyz')).toBe('application/octet-stream')
      expect(getMimeType('/binary.dat')).toBe('application/octet-stream')
    })

    it('should handle files without extension', () => {
      expect(getMimeType('/README')).toBe('application/octet-stream')
      expect(getMimeType('/Makefile')).toBe('application/octet-stream')
    })
  })

  describe('Case insensitivity', () => {
    it('should handle uppercase extensions', () => {
      expect(getMimeType('/file.HTML')).toBe('text/html')
      expect(getMimeType('/file.JS')).toBe('application/javascript')
      expect(getMimeType('/file.CSS')).toBe('text/css')
    })

    it('should handle mixed case extensions', () => {
      expect(getMimeType('/file.Html')).toBe('text/html')
      expect(getMimeType('/file.Js')).toBe('application/javascript')
    })
  })
})

describe('normalizePath', () => {
  describe('relative path resolution', () => {
    it('should resolve relative path from base', () => {
      expect(normalizePath('/src', 'main.ts')).toBe('/src/main.ts')
    })

    it('should return absolute path unchanged', () => {
      expect(normalizePath('/src', '/abs/main.ts')).toBe('/abs/main.ts')
    })
  })

  describe('dot handling', () => {
    it('should resolve parent directory references', () => {
      expect(normalizePath('/src/lib', '../main.ts')).toBe('/src/main.ts')
    })

    it('should resolve current directory references', () => {
      expect(normalizePath('/src', './main.ts')).toBe('/src/main.ts')
    })

    it('should handle complex paths', () => {
      expect(normalizePath('/src/lib', '../utils/../helpers/index.ts'))
        .toBe('/src/helpers/index.ts')
    })
  })

  describe('edge cases', () => {
    it('should handle root base path', () => {
      expect(normalizePath('/', 'file.ts')).toBe('/file.ts')
    })

    it('should handle going above root', () => {
      // Going above root should stay at root
      expect(normalizePath('/src', '../../../file.ts')).toBe('/file.ts')
    })
  })
})

describe('createSimpleErrorPage', () => {
  it('should generate an HTML error page', () => {
    const html = createSimpleErrorPage('Something went wrong')

    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<html')
    expect(html).toContain('</html>')
    expect(html).toContain('Something went wrong')
  })

  it('should escape HTML in message', () => {
    const html = createSimpleErrorPage('<img src=x onerror=alert(1)>')

    expect(html).not.toContain('<img src=x onerror=alert(1)>')
    expect(html).toContain('&lt;img')
  })

  it('should include basic styling', () => {
    const html = createSimpleErrorPage('Error')

    expect(html).toContain('<style>')
    expect(html).toContain('</style>')
  })
})

describe('createBuildErrorPage', () => {
  it('should generate an HTML error page with build errors', () => {
    const errors = [{
      file: '/src/main.ts',
      line: 10,
      column: 5,
      message: 'Cannot find name x'
    }]
    const html = createBuildErrorPage('/src/main.ts', errors)

    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('Build Failed')
    expect(html).toContain('/src/main.ts')
    expect(html).toContain('Cannot find name x')
  })

  it('should escape HTML in error messages', () => {
    const errors = [{
      file: '<script>alert(1)</script>',
      line: 1,
      column: 1,
      message: '<dangerous>'
    }]
    const html = createBuildErrorPage('/test.ts', errors)

    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).not.toContain('<dangerous>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('should include error count', () => {
    const errors = [
      { file: '/a.ts', line: 1, column: 1, message: 'Error 1' },
      { file: '/b.ts', line: 2, column: 1, message: 'Error 2' }
    ]
    const html = createBuildErrorPage('/test.ts', errors)

    expect(html).toContain('2 errors')
  })
})
