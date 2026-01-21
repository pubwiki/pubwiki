/**
 * RDF-based Message Store
 * 
 * Implements MessageStoreProvider using RDFStore for persistent chat history.
 * Stores messages in a named graph for isolation.
 */

import type { MessageStoreProvider, MessageNode } from '@pubwiki/chat'
import type { RDFStore, Quad } from '@pubwiki/rdfstore'
import { DataFactory } from 'n3'

const { namedNode, literal } = DataFactory

// ============================================================================
// Constants
// ============================================================================

export const CHAT_HISTORY_GRAPH_URI = 'https://pub.wiki/subgraph#chatHistory'

const PUBWIKI_NS = 'https://pub.wiki/ontology#'
const MSG_NS = 'https://pub.wiki/message#'

const PREDICATES = {
  TYPE: namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
  MESSAGE_NODE_TYPE: namedNode(`${PUBWIKI_NS}MessageNode`),
  PARENT_ID: namedNode(`${PUBWIKI_NS}parentId`),
  ROLE: namedNode(`${PUBWIKI_NS}role`),
  TIMESTAMP: namedNode(`${PUBWIKI_NS}timestamp`),
  MODEL: namedNode(`${PUBWIKI_NS}model`),
  BLOCKS: namedNode(`${PUBWIKI_NS}blocks`),
  METADATA: namedNode(`${PUBWIKI_NS}metadata`),
}

// ============================================================================
// RDFMessageStore
// ============================================================================

/**
 * RDF-based message store implementation
 */
export class RDFMessageStore implements MessageStoreProvider {
  private rdfStore: RDFStore
  private graph: ReturnType<typeof namedNode>
  
  constructor(
    rdfStore: RDFStore,
    graphUri: string = CHAT_HISTORY_GRAPH_URI
  ) {
    this.rdfStore = rdfStore
    this.graph = namedNode(graphUri)
  }
  
  private msgUri(id: string) {
    return namedNode(`${MSG_NS}${id}`)
  }
  
  async save(node: MessageNode): Promise<void> {
    const subject = this.msgUri(node.id)
    
    // Ensure parentId is a string - handle null, undefined, or object cases
    const parentIdStr = node.parentId == null || typeof node.parentId !== 'string' 
      ? 'null' 
      : node.parentId
    
    await this.rdfStore.insert(subject, PREDICATES.TYPE, PREDICATES.MESSAGE_NODE_TYPE, this.graph)
    await this.rdfStore.insert(subject, PREDICATES.PARENT_ID, literal(parentIdStr), this.graph)
    await this.rdfStore.insert(subject, PREDICATES.ROLE, literal(node.role), this.graph)
    await this.rdfStore.insert(subject, PREDICATES.TIMESTAMP, literal(String(node.timestamp)), this.graph)
    
    if (node.model) {
      await this.rdfStore.insert(subject, PREDICATES.MODEL, literal(node.model), this.graph)
    }
    
    await this.rdfStore.insert(subject, PREDICATES.BLOCKS, literal(JSON.stringify(node.blocks)), this.graph)
    
    if (node.metadata) {
      await this.rdfStore.insert(subject, PREDICATES.METADATA, literal(JSON.stringify(node.metadata)), this.graph)
    }
  }
  
  async saveBatch(nodes: MessageNode[]): Promise<void> {
    for (const node of nodes) {
      await this.save(node)
    }
  }
  
  async get(id: string): Promise<MessageNode | null> {
    const subject = this.msgUri(id)
    const quads = await this.rdfStore.query({ subject, graph: this.graph })
    
    if (quads.length === 0) return null
    
    return this.quadsToMessageNode(id, quads)
  }
  
  async getChildren(parentId: string): Promise<MessageNode[]> {
    const quads = await this.rdfStore.query({
      predicate: PREDICATES.PARENT_ID,
      object: literal(parentId),
      graph: this.graph
    })
    
    const childIds = quads.map(q => q.subject.value.replace(MSG_NS, ''))
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
    await this.rdfStore.delete(subject, undefined as unknown as ReturnType<typeof namedNode>, undefined, this.graph)
  }
  
  async listRoots(): Promise<MessageNode[]> {
    const quads = await this.rdfStore.query({
      predicate: PREDICATES.PARENT_ID,
      object: literal('null'),
      graph: this.graph
    })
    
    const rootIds = quads.map(q => q.subject.value.replace(MSG_NS, ''))
    const roots: MessageNode[] = []
    
    for (const rootId of rootIds) {
      const node = await this.get(rootId)
      if (node) roots.push(node)
    }
    
    return roots.sort((a, b) => b.timestamp - a.timestamp)
  }
  
  async clear(): Promise<void> {
    const quads = await this.rdfStore.query({ graph: this.graph })
    for (const quad of quads) {
      await this.rdfStore.delete(quad.subject, quad.predicate, quad.object, this.graph)
    }
  }
  
  private quadsToMessageNode(id: string, quads: Quad[]): MessageNode {
    const props: Record<string, string> = {}
    
    for (const quad of quads) {
      const predValue = quad.predicate.value
      const objValue = quad.object.value
      
      if (predValue === PREDICATES.PARENT_ID.value) props.parentId = objValue
      else if (predValue === PREDICATES.ROLE.value) props.role = objValue
      else if (predValue === PREDICATES.TIMESTAMP.value) props.timestamp = objValue
      else if (predValue === PREDICATES.MODEL.value) props.model = objValue
      else if (predValue === PREDICATES.BLOCKS.value) props.blocks = objValue
      else if (predValue === PREDICATES.METADATA.value) props.metadata = objValue
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
