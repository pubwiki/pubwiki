/**
 * Node Content Types - Interface-driven polymorphic design
 * 
 * Core design:
 * - NodeContent interface defines common behaviors
 * - Each content type implements the interface via class
 * - BaseNodeData<T extends NodeContent> uses generic constraint
 * - All operations use polymorphic method calls, no type guards
 */

import { blocksToContent, type MessageBlock } from '@pubwiki/chat'
import type { NodeRef } from '../version'

// ============================================================================
// Shared Types
// ============================================================================

/**
 * Mountpoint definition with stable ID for handle identification
 */
export interface Mountpoint {
  id: string
  path: string
}

// ============================================================================
// NodeContent Interface
// ============================================================================

/**
 * Base interface for all node content types.
 * Defines polymorphic behaviors for:
 * - Serialization (for commit hash generation)
 * - Display text (for UI preview)
 * - Cloning (for snapshots)
 */
export interface NodeContent {
  /** Get text representation for display/preview */
  getText(): string
  
  /** Serialize content for commit hash computation */
  serialize(): string
  
  /** Create a deep clone for snapshotting */
  clone(): NodeContent
  
  /** Get raw data for persistence (JSON-serializable) */
  toJSON(): unknown
}

// ============================================================================
// Content Implementations
// ============================================================================

/**
 * Input node content - user input that triggers generation
 */
export class InputContent implements NodeContent {
  constructor(
    public text: string = '',
    public mountpoints: Mountpoint[] = []
  ) {}

  getText(): string {
    return this.text
  }

  serialize(): string {
    return this.text
  }

  clone(): InputContent {
    return new InputContent(
      this.text,
      this.mountpoints.map(mp => ({ ...mp }))
    )
  }

  /** Create a copy with updated text */
  withText(text: string): InputContent {
    return new InputContent(text, this.mountpoints.map(mp => ({ ...mp })))
  }

  /** Create a copy with updated mountpoints */
  withMountpoints(mountpoints: Mountpoint[]): InputContent {
    return new InputContent(this.text, mountpoints)
  }

  /** Create a copy with a new mountpoint added */
  addMountpoint(mountpoint: Mountpoint): InputContent {
    return new InputContent(this.text, [...this.mountpoints, mountpoint])
  }

  /** Create a copy with a mountpoint removed */
  removeMountpoint(mountpointId: string): InputContent {
    return new InputContent(
      this.text, 
      this.mountpoints.filter(mp => mp.id !== mountpointId)
    )
  }

  /** Create a copy with a mountpoint's path updated */
  updateMountpointPath(mountpointId: string, newPath: string): InputContent {
    return new InputContent(
      this.text,
      this.mountpoints.map(mp => 
        mp.id === mountpointId ? { ...mp, path: newPath } : mp
      )
    )
  }

  toJSON() {
    return { text: this.text, mountpoints: this.mountpoints }
  }

  static fromJSON(data: { text?: string; mountpoints?: Mountpoint[] }): InputContent {
    return new InputContent(data.text ?? '', data.mountpoints ?? [])
  }
}

/**
 * Prompt node content - user-edited prompts/system prompts
 */
export class PromptContent implements NodeContent {
  constructor(public text: string = '') {}

  getText(): string {
    return this.text
  }

  serialize(): string {
    return this.text
  }

  clone(): PromptContent {
    return new PromptContent(this.text)
  }

  /** Create a copy with updated text */
  withText(text: string): PromptContent {
    return new PromptContent(text)
  }

  toJSON() {
    return { text: this.text }
  }

  static fromJSON(data: { text?: string }): PromptContent {
    return new PromptContent(data.text ?? '')
  }
}

/**
 * Generated node content - AI-generated content with references
 */
export class GeneratedContent implements NodeContent {
  constructor(
    public blocks: MessageBlock[] = [],
    public inputRef: NodeRef,
    public promptRefs: NodeRef[] = [],
    public indirectPromptRefs: NodeRef[] = []
  ) {}

  getText(): string {
    return blocksToContent(this.blocks)
  }

  serialize(): string {
    return blocksToContent(this.blocks)
  }

  clone(): GeneratedContent {
    return new GeneratedContent(
      structuredClone(this.blocks),
      { ...this.inputRef },
      this.promptRefs.map(ref => ({ ...ref })),
      this.indirectPromptRefs.map(ref => ({ ...ref }))
    )
  }

  /** Create a copy with updated blocks */
  withBlocks(blocks: MessageBlock[]): GeneratedContent {
    return new GeneratedContent(
      blocks,
      { ...this.inputRef },
      this.promptRefs.map(ref => ({ ...ref })),
      this.indirectPromptRefs.map(ref => ({ ...ref }))
    )
  }

  toJSON() {
    return {
      blocks: this.blocks,
      inputRef: this.inputRef,
      promptRefs: this.promptRefs,
      indirectPromptRefs: this.indirectPromptRefs
    }
  }

  static fromJSON(data: {
    blocks?: MessageBlock[]
    inputRef: NodeRef
    promptRefs?: NodeRef[]
    indirectPromptRefs?: NodeRef[]
  }): GeneratedContent {
    return new GeneratedContent(
      data.blocks ?? [],
      data.inputRef,
      data.promptRefs ?? [],
      data.indirectPromptRefs ?? []
    )
  }
}

/**
 * VFS node content - virtual file system reference
 */
export class VFSContent implements NodeContent {
  constructor(public projectId: string) {}

  getText(): string {
    return '' // VFS has no text representation
  }

  serialize(): string {
    return this.projectId
  }

  clone(): VFSContent {
    return new VFSContent(this.projectId)
  }

  toJSON() {
    return { projectId: this.projectId }
  }

  static fromJSON(data: { projectId: string }): VFSContent {
    return new VFSContent(data.projectId)
  }
}

/**
 * Sandbox node content - sandbox preview configuration
 */
export class SandboxContent implements NodeContent {
  constructor(
    public entryFile: string = 'index.html',
    public sandboxOrigin: string = 'http://localhost:4001'
  ) {}

  getText(): string {
    return '' // Sandbox has no text representation
  }

  serialize(): string {
    return JSON.stringify({ entryFile: this.entryFile, sandboxOrigin: this.sandboxOrigin })
  }

  clone(): SandboxContent {
    return new SandboxContent(this.entryFile, this.sandboxOrigin)
  }

  toJSON() {
    return { entryFile: this.entryFile, sandboxOrigin: this.sandboxOrigin }
  }

  static fromJSON(data: { entryFile?: string; sandboxOrigin?: string }): SandboxContent {
    return new SandboxContent(data.entryFile ?? 'index.html', data.sandboxOrigin ?? 'http://localhost:4001')
  }
}

/**
 * Loader node content - Lua VM service executor configuration
 */
export class LoaderContent implements NodeContent {
  constructor(public mountpoints: Mountpoint[] = []) {}

  getText(): string {
    return '' // Loader has no text representation
  }

  serialize(): string {
    return JSON.stringify(this.mountpoints)
  }

  clone(): LoaderContent {
    return new LoaderContent(this.mountpoints.map(mp => ({ ...mp })))
  }

  /** Create a copy with updated mountpoints */
  withMountpoints(mountpoints: Mountpoint[]): LoaderContent {
    return new LoaderContent(mountpoints)
  }

  /** Create a copy with a new mountpoint added */
  addMountpoint(mountpoint: Mountpoint): LoaderContent {
    return new LoaderContent([...this.mountpoints, mountpoint])
  }

  /** Create a copy with a mountpoint removed */
  removeMountpoint(mountpointId: string): LoaderContent {
    return new LoaderContent(
      this.mountpoints.filter(mp => mp.id !== mountpointId)
    )
  }

  /** Create a copy with a mountpoint's path updated */
  updateMountpointPath(mountpointId: string, newPath: string): LoaderContent {
    return new LoaderContent(
      this.mountpoints.map(mp => 
        mp.id === mountpointId ? { ...mp, path: newPath } : mp
      )
    )
  }

  toJSON() {
    return { mountpoints: this.mountpoints }
  }

  static fromJSON(data: { mountpoints?: Mountpoint[] }): LoaderContent {
    return new LoaderContent(data.mountpoints ?? [])
  }
}

/**
 * State node content - RDF triple store (empty, state managed externally)
 */
export class StateContent implements NodeContent {
  getText(): string {
    return ''
  }

  serialize(): string {
    return ''
  }

  clone(): StateContent {
    return new StateContent()
  }

  toJSON() {
    return {}
  }

  static fromJSON(_data: Record<string, never>): StateContent {
    return new StateContent()
  }
}

// ============================================================================
// Content Factory & Restoration
// ============================================================================

export type NodeType = 'INPUT' | 'PROMPT' | 'GENERATED' | 'VFS' | 'SANDBOX' | 'LOADER' | 'STATE'

/**
 * Restore content class instance from JSON data
 * Used when loading from IndexedDB/storage
 */
export function restoreContent(type: NodeType, data: unknown): NodeContent {
  const json = data as Record<string, unknown>
  switch (type) {
    case 'INPUT':
      return InputContent.fromJSON(json as { text?: string; mountpoints?: Mountpoint[] })
    case 'PROMPT':
      return PromptContent.fromJSON(json as { text?: string })
    case 'GENERATED':
      return GeneratedContent.fromJSON(json as {
        blocks?: MessageBlock[]
        inputRef: NodeRef
        promptRefs?: NodeRef[]
        indirectPromptRefs?: NodeRef[]
      })
    case 'VFS':
      return VFSContent.fromJSON(json as { projectId: string })
    case 'SANDBOX':
      return SandboxContent.fromJSON(json as { entryFile?: string; sandboxOrigin?: string })
    case 'LOADER':
      return LoaderContent.fromJSON(json as { mountpoints?: Mountpoint[] })
    case 'STATE':
      return StateContent.fromJSON({})
  }
}
