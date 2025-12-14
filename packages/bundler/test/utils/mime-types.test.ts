/**
 * MIME Types Utils Tests
 */

import { describe, it, expect } from 'vitest'
import { getMimeType } from '../../src/utils/mime-types'

describe('mime-types utils', () => {
  describe('getMimeType', () => {
    it('should return correct MIME type for JavaScript files', () => {
      expect(getMimeType('/project/main.js')).toBe('application/javascript')
      expect(getMimeType('/project/main.mjs')).toBe('application/javascript')
      expect(getMimeType('/project/main.cjs')).toBe('application/javascript')
      expect(getMimeType('/project/main.jsx')).toBe('application/javascript')
    })

    it('should return correct MIME type for TypeScript files', () => {
      expect(getMimeType('/project/main.ts')).toBe('application/typescript')
      expect(getMimeType('/project/main.tsx')).toBe('application/typescript')
    })

    it('should return correct MIME type for web files', () => {
      expect(getMimeType('/project/index.html')).toBe('text/html')
      expect(getMimeType('/project/styles.css')).toBe('text/css')
      expect(getMimeType('/project/data.json')).toBe('application/json')
    })

    it('should return correct MIME type for image files', () => {
      expect(getMimeType('/images/logo.png')).toBe('image/png')
      expect(getMimeType('/images/photo.jpg')).toBe('image/jpeg')
      expect(getMimeType('/images/photo.jpeg')).toBe('image/jpeg')
      expect(getMimeType('/images/icon.svg')).toBe('image/svg+xml')
      expect(getMimeType('/images/banner.webp')).toBe('image/webp')
    })

    it('should return correct MIME type for font files', () => {
      expect(getMimeType('/fonts/font.woff')).toBe('font/woff')
      expect(getMimeType('/fonts/font.woff2')).toBe('font/woff2')
      expect(getMimeType('/fonts/font.ttf')).toBe('font/ttf')
    })

    it('should return octet-stream for unknown extensions', () => {
      expect(getMimeType('/project/file.unknown')).toBe('application/octet-stream')
      expect(getMimeType('/project/noextension')).toBe('application/octet-stream')
    })

    it('should be case insensitive', () => {
      expect(getMimeType('/project/main.JS')).toBe('application/javascript')
      expect(getMimeType('/project/main.TS')).toBe('application/typescript')
      expect(getMimeType('/project/index.HTML')).toBe('text/html')
    })
  })
})
