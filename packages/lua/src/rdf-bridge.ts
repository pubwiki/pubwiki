/**
 * RDF Bridge - 连接 Lua WASM 和 RDFStore
 * 
 * 职责：
 * 1. 接收 Rust 的同步 FFI 调用
 * 2. 转发给 RDFStore
 * 3. 处理同步/异步适配
 */

import type { RDFStore, Triple, TriplePattern } from './rdf-types'
import { Store, DataFactory, type Quad, type Term } from 'n3'

const { namedNode, literal, quad, defaultGraph } = DataFactory

/**
 * 将我们的 Triple 转换为 N3 Quad
 */
function tripleToQuad(triple: Triple): Quad {
  // Subject: 如果以 resource:// 开头，作为 NamedNode，否则也作为 NamedNode（主语通常是资源）
  const subject = namedNode(triple.subject)
  
  // Predicate: 总是 NamedNode（谓语总是属性/关系）
  const predicate = namedNode(triple.predicate)
  
  // Object: 只有 resource:// 开头的才是 NamedNode，其他都是 Literal
  let object: Term
  if (typeof triple.object === 'string' && triple.object.startsWith('resource://')) {
    object = namedNode(triple.object)
  } else if (typeof triple.object === 'string') {
    object = literal(triple.object)
  } else if (typeof triple.object === 'number') {
    object = literal(triple.object.toString())
  } else if (typeof triple.object === 'boolean') {
    object = literal(triple.object.toString())
  } else {
    // 其他类型转为 JSON 字符串
    object = literal(JSON.stringify(triple.object))
  }
  
  return quad(subject, predicate, object, defaultGraph())
}

/**
 * 将 N3 Quad 转换回我们的 Triple
 */
function quadToTriple(q: Quad): Triple {
  // 解析 object
  let object: any
  if (q.object.termType === 'NamedNode') {
    object = q.object.value
  } else if (q.object.termType === 'Literal') {
    const value = q.object.value
    // 尝试解析回原始类型
    if (value === 'true') {
      object = true
    } else if (value === 'false') {
      object = false
    } else if (/^-?\d+$/.test(value)) {
      object = parseInt(value, 10)
    } else if (/^-?\d+\.\d+$/.test(value)) {
      object = parseFloat(value)
    } else if (value.startsWith('{') || value.startsWith('[')) {
      // 尝试解析 JSON
      try {
        object = JSON.parse(value)
      } catch {
        object = value
      }
    } else {
      object = value
    }
  } else {
    object = q.object.value
  }
  
  return {
    subject: q.subject.value,
    predicate: q.predicate.value,
    object
  }
}

// 使用 Map 来存储多个并发的 RDFStore 上下文，避免竞态条件
const storeContexts = new Map<number, RDFStore>()
let nextContextId = 1

/**
 * 创建一个新的 RDFStore 上下文
 * 返回 context ID
 */
export function createRDFStoreContext(store: RDFStore): number {
  const contextId = nextContextId++
  storeContexts.set(contextId, store)
  return contextId
}

/**
 * 获取指定上下文的 RDFStore
 */
export function getRDFStore(contextId: number): RDFStore | null {
  return storeContexts.get(contextId) || null
}

/**
 * 清除指定上下文的 RDFStore
 */
export function clearRDFStoreContext(contextId: number): void {
  storeContexts.delete(contextId)
}
