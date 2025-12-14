/**
 * VfsServiceImpl Tests
 *
 * Tests for the VFS service implementation that provides file access
 * and bundler integration for the sandbox.
 * 
 * Note: Integration tests for VfsServiceImpl are in e2e tests (test/e2e/vfs-service.e2e.test.ts)
 * because they require browser APIs (Web Workers for BundlerService).
 */

import { describe, it, expect } from 'vitest'
import { VfsServiceImpl } from '../../src/services/vfs-service'

describe('VfsServiceImpl', () => {
  describe('module exports', () => {
    it('should export VfsServiceImpl class', () => {
      expect(VfsServiceImpl).toBeDefined()
      expect(typeof VfsServiceImpl).toBe('function')
    })
  })
})
