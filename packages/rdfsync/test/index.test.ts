/**
 * rdfsync 单元测试
 */

import { describe, it, expect } from 'vitest'
import {
  ROOT_REF,
  generateRef,
  generateRefChain,
  verifyRefChain,
  canonicalizeOperation,
} from '../src/index.js'
import type { Quad, Operation, OperationWithRef } from '../src/index.js'

describe('rdfsync', () => {
  describe('ROOT_REF', () => {
    it('should be "root"', () => {
      expect(ROOT_REF).toBe('root')
    })
  })

  describe('canonicalizeOperation', () => {
    it('should produce deterministic output', () => {
      const quad: Quad = {
        subject: '<http://s>',
        predicate: '<http://p>',
        object: 'value',
      }
      const op: Operation = { type: 'insert', quad }
      
      expect(canonicalizeOperation(op)).toBe(canonicalizeOperation(op))
    })

    it('should sort quads in batch operations', () => {
      const q1: Quad = { subject: '<http://z>', predicate: '<http://p>', object: '1' }
      const q2: Quad = { subject: '<http://a>', predicate: '<http://p>', object: '2' }
      
      const op1: Operation = { type: 'batch-insert', quads: [q1, q2] }
      const op2: Operation = { type: 'batch-insert', quads: [q2, q1] }
      
      expect(canonicalizeOperation(op1)).toBe(canonicalizeOperation(op2))
    })
  })

  describe('generateRef', () => {
    it('should generate 16-char hex string', async () => {
      const quad: Quad = { subject: '<http://s>', predicate: '<http://p>', object: 'v' }
      const op: Operation = { type: 'insert', quad }
      
      const ref = await generateRef('root', op)
      
      expect(ref).toHaveLength(16)
      expect(ref).toMatch(/^[0-9a-f]+$/)
    })

    it('should be deterministic', async () => {
      const quad: Quad = { subject: '<http://s>', predicate: '<http://p>', object: 'v' }
      const op: Operation = { type: 'insert', quad }
      
      const ref1 = await generateRef('root', op)
      const ref2 = await generateRef('root', op)
      
      expect(ref1).toBe(ref2)
    })

    it('should differ for different operations', async () => {
      const q1: Quad = { subject: '<http://s1>', predicate: '<http://p>', object: 'v' }
      const q2: Quad = { subject: '<http://s2>', predicate: '<http://p>', object: 'v' }
      
      const ref1 = await generateRef('root', { type: 'insert', quad: q1 })
      const ref2 = await generateRef('root', { type: 'insert', quad: q2 })
      
      expect(ref1).not.toBe(ref2)
    })

    it('should differ for different parent refs', async () => {
      const quad: Quad = { subject: '<http://s>', predicate: '<http://p>', object: 'v' }
      const op: Operation = { type: 'insert', quad }
      
      const ref1 = await generateRef('parent1', op)
      const ref2 = await generateRef('parent2', op)
      
      expect(ref1).not.toBe(ref2)
    })
  })

  describe('generateRefChain', () => {
    it('should generate chain of refs', async () => {
      const ops: Operation[] = [
        { type: 'insert', quad: { subject: '<http://s1>', predicate: '<http://p>', object: '1' } },
        { type: 'insert', quad: { subject: '<http://s2>', predicate: '<http://p>', object: '2' } },
      ]
      
      const chain = await generateRefChain('root', ops)
      
      expect(chain).toHaveLength(2)
      
      const expected1 = await generateRef('root', ops[0])
      const expected2 = await generateRef(expected1, ops[1])
      
      expect(chain[0].ref).toBe(expected1)
      expect(chain[1].ref).toBe(expected2)
    })
  })

  describe('verifyRefChain', () => {
    it('should validate correct chain', async () => {
      const ops: Operation[] = [
        { type: 'insert', quad: { subject: '<http://s1>', predicate: '<http://p>', object: '1' } },
        { type: 'insert', quad: { subject: '<http://s2>', predicate: '<http://p>', object: '2' } },
      ]
      
      const chain = await generateRefChain('root', ops)
      const result = await verifyRefChain('root', chain)
      
      expect(result).toBeNull()
    })

    it('should detect mismatch', async () => {
      const quad: Quad = { subject: '<http://s>', predicate: '<http://p>', object: 'v' }
      const chain: OperationWithRef[] = [
        { operation: { type: 'insert', quad }, ref: 'wrongref12345678' },
      ]
      
      const result = await verifyRefChain('root', chain)
      
      expect(result).not.toBeNull()
      expect(result!.index).toBe(0)
      expect(result!.received).toBe('wrongref12345678')
    })
  })
})
