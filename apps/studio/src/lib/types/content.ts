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
      { ...this.generationConfig }
    )
  }

  /** Create a copy with updated blocks */
  withBlocks(blocks: ContentBlock[]): InputContent {
    return new InputContent(blocks, { ...this.generationConfig })
  }

  /** Create a copy with updated generation config */
  withGenerationConfig(config: Partial<InputGenerationConfig>): InputContent {
    return new InputContent(
      structuredClone(this.blocks),
      { ...this.generationConfig, ...config }
    )
  }

  toJSON() {
    return { blocks: this.blocks, generationConfig: this.generationConfig }
  }

  static fromJSON(data: { blocks: ContentBlock[]; generationConfig?: InputGenerationConfig }): InputContent {
    return new InputContent(data.blocks ?? [], data.generationConfig ?? {})
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
    public outputVfsId: string | null = null,
    /** Post-generation commit hash - recorded after file modifications are complete */
    public postGenerationCommit: string | null = null
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
      this.outputVfsId,
      this.postGenerationCommit
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
      this.outputVfsId,
      this.postGenerationCommit
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
      this.outputVfsId,
      this.postGenerationCommit
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
      vfsId,
      this.postGenerationCommit
    )
  }

  /** Create a copy with updated postGenerationCommit */
  withPostGenerationCommit(commit: string | null): GeneratedContent {
    return new GeneratedContent(
      structuredClone(this.blocks),
      { ...this.inputRef },
      this.promptRefs.map(ref => ({ ...ref })),
      this.indirectPromptRefs.map(ref => ({ ...ref })),
      this.inputVfsRef ? { ...this.inputVfsRef } : null,
      this.outputVfsId,
      commit
    )
  }

  toJSON() {
    return {
      blocks: this.blocks,
      inputRef: this.inputRef,
      promptRefs: this.promptRefs,
      indirectPromptRefs: this.indirectPromptRefs,
      inputVfsRef: this.inputVfsRef,
      outputVfsId: this.outputVfsId,
      postGenerationCommit: this.postGenerationCommit
    }
  }

  static fromJSON(data: {
    blocks?: MessageBlock[]
    inputRef: NodeRef
    promptRefs?: NodeRef[]
    indirectPromptRefs?: NodeRef[]
    inputVfsRef?: VfsRef | null
    outputVfsId?: string | null
    postGenerationCommit?: string | null
  }): GeneratedContent {
    return new GeneratedContent(
      data.blocks ?? [],
      data.inputRef,
      data.promptRefs ?? [],
      data.indirectPromptRefs ?? [],
      data.inputVfsRef ?? null,
      data.outputVfsId ?? null,
      data.postGenerationCommit ?? null
    )
  }
}

/**
 * VFS mount configuration - represents a mounted child VFS
 */
export interface VfsMountConfig {
  /** Unique mount ID for tracking */
  id: string
  /** Source VFS Node ID */
  sourceNodeId: string
  /** Mount path in the target VFS (where the source VFS will appear) */
  mountPath: string
  /** Source VFS commit hash (for version tracking) */
  sourceCommit?: string
}

/**
 * VFS node content - virtual file system reference
 * 
 * Includes:
 * - projectId: Project this VFS belongs to
 * - mounts: Child VFS mounts (VFS-to-VFS mounting)
 */
export class VFSContent implements NodeContent {
  constructor(
    public projectId: string,
    public mounts: VfsMountConfig[] = []
  ) {}

  getText(): string {
    return '' // VFS has no text representation
  }

  serialize(): string {
    return JSON.stringify({
      projectId: this.projectId,
      mounts: this.mounts
    })
  }

  clone(): VFSContent {
    return new VFSContent(
      this.projectId,
      structuredClone(this.mounts)
    )
  }

  /** Create a copy with a new mount added */
  addMount(mount: VfsMountConfig): VFSContent {
    return new VFSContent(
      this.projectId,
      [...this.mounts, mount]
    )
  }

  /** Create a copy with a mount removed */
  removeMount(mountId: string): VFSContent {
    return new VFSContent(
      this.projectId,
      this.mounts.filter(m => m.id !== mountId)
    )
  }

  /** Create a copy with a mount's path updated */
  updateMountPath(mountId: string, newPath: string): VFSContent {
    return new VFSContent(
      this.projectId,
      this.mounts.map(m =>
        m.id === mountId ? { ...m, mountPath: newPath } : m
      )
    )
  }

  /** Create a copy with a mount's source commit updated */
  updateMountCommit(mountId: string, sourceCommit: string): VFSContent {
    return new VFSContent(
      this.projectId,
      this.mounts.map(m =>
        m.id === mountId ? { ...m, sourceCommit } : m
      )
    )
  }

  toJSON() {
    return {
      projectId: this.projectId,
      mounts: this.mounts
    }
  }

  static fromJSON(data: { 
    projectId: string
    mounts?: VfsMountConfig[]
  }): VFSContent {
    return new VFSContent(
      data.projectId,
      data.mounts ?? []
    )
  }
}

/**
 * Sandbox node content - sandbox preview configuration
 */
export class SandboxContent implements NodeContent {
  constructor(
    public entryFile: string = 'index.html',
  ) {}

  getText(): string {
    return '' // Sandbox has no text representation
  }

  serialize(): string {
    return JSON.stringify({ entryFile: this.entryFile })
  }

  clone(): SandboxContent {
    return new SandboxContent(this.entryFile)
  }

  toJSON() {
    return { entryFile: this.entryFile }
  }

  static fromJSON(data: { entryFile?: string; sandboxOrigin?: string }): SandboxContent {
    return new SandboxContent(data.entryFile ?? 'index.html')
  }
}

/**
 * Loader node content - Lua VM service executor configuration
 * Note: VFS mounts are now configured through VFSContent.mounts, not here
 */
export class LoaderContent implements NodeContent {
  constructor() {}

  getText(): string {
    return '' // Loader has no text representation
  }

  serialize(): string {
    return '{}'
  }

  clone(): LoaderContent {
    return new LoaderContent()
  }

  toJSON() {
    return {}
  }

  static fromJSON(_data: Record<string, unknown>): LoaderContent {
    return new LoaderContent()
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
    /** Currently selected checkpoint ID */
    public checkpointId: string | null = null,
    /** Currently selected checkpoint ref (hash) */
    public checkpointRef: string | null = null,
    /** List of user's checkpoints (local cache) */
    public checkpoints: CheckpointInfo[] = []
  ) {}

  getText(): string {
    return ''
  }

  serialize(): string {
    return JSON.stringify({ saveId: this.saveId, checkpointId: this.checkpointId, checkpointRef: this.checkpointRef })
  }

  clone(): StateContent {
    return new StateContent(
      this.saveId,
      this.checkpointId,
      this.checkpointRef,
      structuredClone(this.checkpoints)
    )
  }

  /** Create a copy with updated saveId */
  withSaveId(saveId: string | null): StateContent {
    return new StateContent(saveId, this.checkpointId, this.checkpointRef, structuredClone(this.checkpoints))
  }

  /** Create a copy with updated checkpoint (both id and ref) */
  withCheckpoint(checkpointId: string | null, checkpointRef: string | null): StateContent {
    return new StateContent(this.saveId, checkpointId, checkpointRef, structuredClone(this.checkpoints))
  }

  /** Create a copy with updated checkpoints list */
  withCheckpoints(checkpoints: CheckpointInfo[]): StateContent {
    return new StateContent(this.saveId, this.checkpointId, this.checkpointRef, structuredClone(checkpoints))
  }

  /** Add a checkpoint to the list */
  addCheckpoint(checkpoint: CheckpointInfo): StateContent {
    return new StateContent(
      this.saveId,
      this.checkpointId,
      this.checkpointRef,
      [...this.checkpoints, checkpoint]
    )
  }

  /** Remove a checkpoint from the list by ID */
  removeCheckpoint(id: string): StateContent {
    const isSelected = this.checkpointId === id
    return new StateContent(
      this.saveId,
      // Clear checkpointId if it matches the removed checkpoint
      isSelected ? null : this.checkpointId,
      // Clear checkpointRef if it matches the removed checkpoint
      isSelected ? null : this.checkpointRef,
      this.checkpoints.filter(c => c.id !== id)
    )
  }

  toJSON() {
    return {
      saveId: this.saveId,
      checkpointId: this.checkpointId,
      checkpointRef: this.checkpointRef,
      checkpoints: this.checkpoints
    }
  }

  static fromJSON(data: {
    saveId?: string | null
    checkpointId?: string | null
    checkpointRef?: string | null
    checkpoints?: CheckpointInfo[]
  }): StateContent {
    return new StateContent(
      data.saveId ?? null,
      data.checkpointId ?? null,
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
      return InputContent.fromJSON(json as { blocks: ContentBlock[]; generationConfig?: InputGenerationConfig })
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
      return VFSContent.fromJSON(json as { 
        projectId: string
        displayName?: string
        mounts?: VfsMountConfig[]
      })
    case 'SANDBOX':
      return SandboxContent.fromJSON(json as { entryFile?: string; sandboxOrigin?: string })
    case 'LOADER':
      return LoaderContent.fromJSON(json as Record<string, unknown>)
    case 'STATE':
      return StateContent.fromJSON(json as {
        saveId?: string | null
        checkpointId?: string | null
        checkpointRef?: string | null
        checkpoints?: CheckpointInfo[]
      })
  }
}
