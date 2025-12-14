/**
 * SandboxConnection Tests
 *
 * Tests for the sandbox connection manager that coordinates
 * iframe communication and RPC channels.
 * 
 * Note: Integration tests for SandboxConnection are in e2e tests (test/e2e/connection.e2e.test.ts)
 * because they require browser APIs (window events, Web Workers).
 */

import { describe, it, expect } from 'vitest'
import { createSandboxConnection } from '../../src/connection'

describe('createSandboxConnection', () => {
  describe('module exports', () => {
    it('should export createSandboxConnection function', () => {
      expect(createSandboxConnection).toBeDefined()
      expect(typeof createSandboxConnection).toBe('function')
    })
  })
})
