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
// Input Generation Config
// ============================================================================

/**
 * Generation configuration for Input nodes
 * Allows per-node override of global generation settings
 */
export interface InputGenerationConfig {
  /** Model to use for generation (empty = use global setting) */
  model?: string
  /** Temperature for generation (0-2) */
  temperature?: number
  /** JSON Schema for structured output */
  schema?: string
}

// ============================================================================
// Content Implementations
// ============================================================================

/**
 * Input node content - user input that triggers generation
 * Uses ContentBlock[] for structured storage (same as PromptContent)
 */
export class InputContent implements NodeContent {
  constructor(
    public blocks: ContentBlock[] = [],
    public mountpoints: Mountpoint[] = [],
    public generationConfig: InputGenerationConfig = {}
  ) {}

  getText(): string {
    return blocksToText(this.blocks)
  }

  serialize(): string {
    return blocksToText(this.blocks)
  }

  clone(): InputContent {
    return new InputContent(
      structuredClone(this.blocks),
      this.mountpoints.map(mp => ({ ...mp })),
      { ...this.generationConfig }
    )
  }

  /** Create a copy with updated blocks */
  withBlocks(blocks: ContentBlock[]): InputContent {
    return new InputContent(blocks, this.mountpoints.map(mp => ({ ...mp })), { ...this.generationConfig })
  }

  /** Create a copy with updated mountpoints */
  withMountpoints(mountpoints: Mountpoint[]): InputContent {
    return new InputContent(this.blocks, mountpoints, { ...this.generationConfig })
  }

  /** Create a copy with updated generation config */
  withGenerationConfig(config: Partial<InputGenerationConfig>): InputContent {
    return new InputContent(
      structuredClone(this.blocks),
      this.mountpoints.map(mp => ({ ...mp })),
      { ...this.generationConfig, ...config }
    )
  }

  /** Create a copy with a new mountpoint added */
  addMountpoint(mountpoint: Mountpoint): InputContent {
    return new InputContent(structuredClone(this.blocks), [...this.mountpoints, mountpoint], { ...this.generationConfig })
  }

  /** Create a copy with a mountpoint removed */
  removeMountpoint(mountpointId: string): InputContent {
    return new InputContent(
      structuredClone(this.blocks), 
      this.mountpoints.filter(mp => mp.id !== mountpointId),
      { ...this.generationConfig }
    )
  }

  /** Create a copy with a mountpoint's path updated */
  updateMountpointPath(mountpointId: string, newPath: string): InputContent {
    return new InputContent(
      structuredClone(this.blocks),
      this.mountpoints.map(mp => 
        mp.id === mountpointId ? { ...mp, path: newPath } : mp
      ),
      { ...this.generationConfig }
    )
  }

  toJSON() {
    return { blocks: this.blocks, mountpoints: this.mountpoints, generationConfig: this.generationConfig }
  }

  static fromJSON(data: { blocks: ContentBlock[]; mountpoints?: Mountpoint[]; generationConfig?: InputGenerationConfig }): InputContent {
    return new InputContent(data.blocks ?? [], data.mountpoints ?? [], data.generationConfig ?? {})
  }
}

// ============================================================================
// ContentBlock Types (for structured reftag storage)
// ============================================================================

/**
 * A text block containing plain text
 */
export interface TextBlock {
  type: 'text'
  value: string
}

/**
 * A reftag block representing an @reference
 */
export interface RefTagBlock {
  type: 'reftag'
  name: string
}

/**
 * Union type for all content blocks
 */
export type ContentBlock = TextBlock | RefTagBlock

/**
 * Convert ContentBlock array to plain text
 */
export function blocksToText(blocks: ContentBlock[]): string {
  return blocks.map(block => {
    if (block.type === 'text') {
      return block.value
    } else {
      return `@${block.name}`
    }
  }).join('')
}

/**
 * Extract unique reftag names from blocks
 */
export function getRefTagNamesFromBlocks(blocks: ContentBlock[]): string[] {
  const names = blocks
    .filter((b): b is RefTagBlock => b.type === 'reftag')
    .map(b => b.name)
  return [...new Set(names)]
}

/**
 * Prompt node content - user-edited prompts/system prompts
 * Uses ContentBlock[] for structured storage to avoid @ character conflicts
 */
export class PromptContent implements NodeContent {
  constructor(public blocks: ContentBlock[] = []) {}

  getText(): string {
    return blocksToText(this.blocks)
  }

  serialize(): string {
    return blocksToText(this.blocks)
  }

  clone(): PromptContent {
    return new PromptContent(structuredClone(this.blocks))
  }

  /** Create a copy with updated blocks */
  withBlocks(blocks: ContentBlock[]): PromptContent {
    return new PromptContent(blocks)
  }

  toJSON() {
    return { blocks: this.blocks }
  }

  static fromJSON(data: { blocks: ContentBlock[] }): PromptContent {
    return new PromptContent(data.blocks ?? [])
  }

  /**
   * Create PromptContent from plain text.
   * Converts the text to a single text block.
   */
  static fromText(text: string): PromptContent {
    if (!text) {
      return new PromptContent([])
    }
    return new PromptContent([{ type: 'text', value: text }])
  }
}

// ============================================================================
// VFS Reference Types
// ============================================================================

/**
 * VFS version reference - records the VFS state at a specific point in time.
 * Used to track the base state before file modifications.
 */
export interface VfsRef {
  /** VFS Node ID */
  nodeId: string
  /** Git commit hash - records the VFS state at generation time */
  commit: string
}

/**
 * Generated node content - AI-generated content with references
 */
export class GeneratedContent implements NodeContent {
  constructor(
    public blocks: MessageBlock[] = [],
    public inputRef: NodeRef,
    public promptRefs: NodeRef[] = [],
    public indirectPromptRefs: NodeRef[] = [],
    /** Input VFS version reference - for file modification scenarios */
    public inputVfsRef: VfsRef | null = null,
    /** Output VFS node ID - for file creation scenarios or modification output */
    public outputVfsId: string | null = null
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
      this.indirectPromptRefs.map(ref => ({ ...ref })),
      this.inputVfsRef ? { ...this.inputVfsRef } : null,
      this.outputVfsId
    )
  }

  /** Create a copy with updated blocks */
  withBlocks(blocks: MessageBlock[]): GeneratedContent {
    return new GeneratedContent(
      blocks,
      { ...this.inputRef },
      this.promptRefs.map(ref => ({ ...ref })),
      this.indirectPromptRefs.map(ref => ({ ...ref })),
      this.inputVfsRef ? { ...this.inputVfsRef } : null,
      this.outputVfsId
    )
  }

  /** Create a copy with updated inputVfsRef */
  withInputVfsRef(ref: VfsRef | null): GeneratedContent {
    return new GeneratedContent(
      structuredClone(this.blocks),
      { ...this.inputRef },
      this.promptRefs.map(ref => ({ ...ref })),
      this.indirectPromptRefs.map(ref => ({ ...ref })),
      ref,
      this.outputVfsId
    )
  }

  /** Create a copy with updated outputVfsId */
  withOutputVfs(vfsId: string | null): GeneratedContent {
    return new GeneratedContent(
      structuredClone(this.blocks),
      { ...this.inputRef },
      this.promptRefs.map(ref => ({ ...ref })),
      this.indirectPromptRefs.map(ref => ({ ...ref })),
      this.inputVfsRef ? { ...this.inputVfsRef } : null,
      vfsId
    )
  }

  toJSON() {
    return {
      blocks: this.blocks,
      inputRef: this.inputRef,
      promptRefs: this.promptRefs,
      indirectPromptRefs: this.indirectPromptRefs,
      inputVfsRef: this.inputVfsRef,
      outputVfsId: this.outputVfsId
    }
  }

  static fromJSON(data: {
    blocks?: MessageBlock[]
    inputRef: NodeRef
    promptRefs?: NodeRef[]
    indirectPromptRefs?: NodeRef[]
    inputVfsRef?: VfsRef | null
    outputVfsId?: string | null
  }): GeneratedContent {
    return new GeneratedContent(
      data.blocks ?? [],
      data.inputRef,
      data.promptRefs ?? [],
      data.indirectPromptRefs ?? [],
      data.inputVfsRef ?? null,
      data.outputVfsId ?? null
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
 * Checkpoint visibility type
 */
export type CheckpointVisibility = 'PRIVATE' | 'UNLISTED' | 'PUBLIC'

/**
 * Checkpoint information
 */
export interface CheckpointInfo {
  /** Checkpoint unique ID */
  id: string
  /** Version ref (hash) */
  ref: string
  /** User-defined checkpoint name */
  name: string
  /** Optional description */
  description?: string
  /** Creation timestamp */
  createdAt: number
  /** Visibility level */
  visibility: CheckpointVisibility
}

/**
 * State node content - RDF triple store with GameSave integration
 * 
 * The actual RDF data is stored in GameSave service (Durable Object).
 * This content stores the reference to the save and selected checkpoint.
 */
export class StateContent implements NodeContent {
  constructor(
    /** GameSave service save ID */
    public saveId: string | null = null,
    /** Currently selected checkpoint ref */
    public checkpointRef: string | null = null,
    /** List of user's checkpoints (local cache) */
    public checkpoints: CheckpointInfo[] = []
  ) {}

  getText(): string {
    return ''
  }

  serialize(): string {
    return JSON.stringify({ saveId: this.saveId, checkpointRef: this.checkpointRef })
  }

  clone(): StateContent {
    return new StateContent(
      this.saveId,
      this.checkpointRef,
      structuredClone(this.checkpoints)
    )
  }

  /** Create a copy with updated saveId */
  withSaveId(saveId: string | null): StateContent {
    return new StateContent(saveId, this.checkpointRef, structuredClone(this.checkpoints))
  }

  /** Create a copy with updated checkpointRef */
  withCheckpointRef(checkpointRef: string | null): StateContent {
    return new StateContent(this.saveId, checkpointRef, structuredClone(this.checkpoints))
  }

  /** Create a copy with updated checkpoints list */
  withCheckpoints(checkpoints: CheckpointInfo[]): StateContent {
    return new StateContent(this.saveId, this.checkpointRef, structuredClone(checkpoints))
  }

  /** Add a checkpoint to the list */
  addCheckpoint(checkpoint: CheckpointInfo): StateContent {
    return new StateContent(
      this.saveId,
      this.checkpointRef,
      [...this.checkpoints, checkpoint]
    )
  }

  /** Remove a checkpoint from the list by ID */
  removeCheckpoint(id: string): StateContent {
    const checkpoint = this.checkpoints.find(c => c.id === id)
    return new StateContent(
      this.saveId,
      // Clear checkpointRef if it matches the removed checkpoint's ref
      checkpoint && this.checkpointRef === checkpoint.ref ? null : this.checkpointRef,
      this.checkpoints.filter(c => c.id !== id)
    )
  }

  toJSON() {
    return {
      saveId: this.saveId,
      checkpointRef: this.checkpointRef,
      checkpoints: this.checkpoints
    }
  }

  static fromJSON(data: {
    saveId?: string | null
    checkpointRef?: string | null
    checkpoints?: CheckpointInfo[]
  }): StateContent {
    return new StateContent(
      data.saveId ?? null,
      data.checkpointRef ?? null,
      data.checkpoints ?? []
    )
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
      return InputContent.fromJSON(json as { blocks: ContentBlock[]; mountpoints?: Mountpoint[] })
    case 'PROMPT':
      return PromptContent.fromJSON(json as { blocks: ContentBlock[] })
    case 'GENERATED':
      return GeneratedContent.fromJSON(json as {
        blocks?: MessageBlock[]
        inputRef: NodeRef
        promptRefs?: NodeRef[]
        indirectPromptRefs?: NodeRef[]
        inputVfsRef?: VfsRef | null
        outputVfsId?: string | null
      })
    case 'VFS':
      return VFSContent.fromJSON(json as { projectId: string })
    case 'SANDBOX':
      return SandboxContent.fromJSON(json as { entryFile?: string; sandboxOrigin?: string })
    case 'LOADER':
      return LoaderContent.fromJSON(json as { mountpoints?: Mountpoint[] })
    case 'STATE':
      return StateContent.fromJSON(json as {
        saveId?: string | null
        checkpointRef?: string | null
        checkpoints?: CheckpointInfo[]
      })
  }
}
