/**
 * TripleStore-based Message Store
 * 
 * Implements MessageStoreProvider using TripleStore for persistent chat history.
 * Stores messages in a named graph for isolation.
 */

import type { MessageStoreProvider, MessageNode } from '@pubwiki/chat'
import type { TripleStore } from '@pubwiki/rdfstore'

// ============================================================================
// Constants
// ============================================================================

export const CHAT_HISTORY_GRAPH_URI = 'https://pub.wiki/subgraph#chatHistory'

const PUBWIKI_NS = 'https://pub.wiki/ontology#'
const MSG_NS = 'https://pub.wiki/message#'

const PREDICATES = {
  TYPE: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
  MESSAGE_NODE_TYPE: `${PUBWIKI_NS}MessageNode`,
  PARENT_ID: `${PUBWIKI_NS}parentId`,
  ROLE: `${PUBWIKI_NS}role`,
  TIMESTAMP: `${PUBWIKI_NS}timestamp`,
  MODEL: `${PUBWIKI_NS}model`,
  BLOCKS: `${PUBWIKI_NS}blocks`,
  METADATA: `${PUBWIKI_NS}metadata`,
}

// ============================================================================
// RDFMessageStore
// ============================================================================

export class RDFMessageStore implements MessageStoreProvider {
  private store: TripleStore
  private graph: string
  
  constructor(
    store: TripleStore,
    graphUri: string = CHAT_HISTORY_GRAPH_URI
  ) {
    this.store = store
    this.graph = graphUri
  }
  
  private msgUri(id: string) {
    return `${MSG_NS}${id}`
  }
  
  async save(node: MessageNode): Promise<void> {
    const subject = this.msgUri(node.id)
    const g = this.graph
    
    const parentIdStr = node.parentId == null || typeof node.parentId !== 'string' 
      ? 'null' 
      : node.parentId
    
    this.store.insert(subject, PREDICATES.TYPE, PREDICATES.MESSAGE_NODE_TYPE, g)
    this.store.insert(subject, PREDICATES.PARENT_ID, parentIdStr, g)
    this.store.insert(subject, PREDICATES.ROLE, node.role, g)
    this.store.insert(subject, PREDICATES.TIMESTAMP, String(node.timestamp), g)
    
    if (node.model) {
      this.store.insert(subject, PREDICATES.MODEL, node.model, g)
    }
    
    this.store.insert(subject, PREDICATES.BLOCKS, JSON.stringify(node.blocks), g)
    
    if (node.metadata) {
      this.store.insert(subject, PREDICATES.METADATA, JSON.stringify(node.metadata), g)
    }
  }
  
  async saveBatch(nodes: MessageNode[]): Promise<void> {
    for (const node of nodes) {
      await this.save(node)
    }
  }
  
  async get(id: string): Promise<MessageNode | null> {
    const subject = this.msgUri(id)
    const triples = this.store.match({ subject, graph: this.graph })
    
    if (triples.length === 0) return null
    
    return this.triplesToMessageNode(id, triples)
  }
  
  async getChildren(parentId: string): Promise<MessageNode[]> {
    const triples = this.store.match({
      predicate: PREDICATES.PARENT_ID,
      object: parentId,
      graph: this.graph
    })
    
    const childIds = triples.map(t => t.subject.replace(MSG_NS, ''))
    const children: MessageNode[] = []
    
    for (const childId of childIds) {
      const node = await this.get(childId)
      if (node) children.push(node)
    }
    
    return children.sort((a, b) => a.timestamp - b.timestamp)
  }
  
  async getPath(leafId: string): Promise<MessageNode[]> {
    const path: MessageNode[] = []
    let current = await this.get(leafId)
    
    while (current) {
      path.unshift(current)
      if (!current.parentId) break
      current = await this.get(current.parentId)
    }
    
    return path
  }
  
  async delete(id: string, deleteDescendants: boolean = true): Promise<void> {
    if (deleteDescendants) {
      const children = await this.getChildren(id)
      for (const child of children) {
        await this.delete(child.id, true)
      }
    }
    
    const subject = this.msgUri(id)
    // Delete all triples for this subject in the graph
    const triples = this.store.match({ subject, graph: this.graph })
    for (const t of triples) {
      this.store.delete(t.subject, t.predicate, t.object, t.graph)
    }
  }
  
  async listRoots(): Promise<MessageNode[]> {
    const triples = this.store.match({
      predicate: PREDICATES.PARENT_ID,
      object: 'null',
      graph: this.graph
    })
    
    const rootIds = triples.map(t => t.subject.replace(MSG_NS, ''))
    const roots: MessageNode[] = []
    
    for (const rootId of rootIds) {
      const node = await this.get(rootId)
      if (node) roots.push(node)
    }
    
    return roots.sort((a, b) => b.timestamp - a.timestamp)
  }
  
  async clear(): Promise<void> {
    const triples = this.store.match({ graph: this.graph })
    for (const t of triples) {
      this.store.delete(t.subject, t.predicate, t.object, this.graph)
    }
  }
  
  private triplesToMessageNode(id: string, triples: { predicate: string; object: unknown }[]): MessageNode {
    const props: Record<string, string> = {}
    
    for (const t of triples) {
      const pred = t.predicate
      const obj = String(t.object)
      
      if (pred === PREDICATES.PARENT_ID) props.parentId = obj
      else if (pred === PREDICATES.ROLE) props.role = obj
      else if (pred === PREDICATES.TIMESTAMP) props.timestamp = obj
      else if (pred === PREDICATES.MODEL) props.model = obj
      else if (pred === PREDICATES.BLOCKS) props.blocks = obj
      else if (pred === PREDICATES.METADATA) props.metadata = obj
    }
    
    return {
      id,
      parentId: props.parentId === 'null' ? null : props.parentId,
      role: props.role as 'user' | 'assistant' | 'system',
      timestamp: parseInt(props.timestamp, 10),
      model: props.model,
      blocks: JSON.parse(props.blocks || '[]'),
      metadata: props.metadata ? JSON.parse(props.metadata) : undefined
    }
  }
}
