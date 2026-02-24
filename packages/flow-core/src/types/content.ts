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
import type { NodeRef } from './version'

// ============================================================================
// ArtifactNodeContent - JSON representation for local storage
// ============================================================================

/**
 * Union type for all node content JSON representations.
 * Used for local storage and IndexedDB persistence.
 * 
 * Note: This is different from @pubwiki/api's ArtifactNodeContent which is
 * designed for API communication. Local storage uses projectId for VFS,
 * while API uses filesHash.
 */
export type ArtifactNodeContent =
  | { type: 'INPUT'; blocks?: ContentBlock[]; generationConfig?: InputGenerationConfig }
  | { type: 'PROMPT'; blocks?: ContentBlock[] }
  | { type: 'GENERATED'; blocks?: MessageBlock[]; inputRef: NodeRef; promptRefs?: NodeRef[]; indirectPromptRefs?: NodeRef[]; inputVfsRef?: VfsRef | null; outputVfsId?: string | null; postGenerationCommit?: string | null }
  | { type: 'VFS'; projectId: string; mounts?: VfsMountConfig[] }
  | { type: 'SANDBOX'; entryFile?: string }
  | { type: 'LOADER' }
  | { type: 'STATE' }

// ============================================================================
// JSON Type Aliases (for fromJSON parameters)
// ============================================================================

/** JSON representation for InputContent - used by fromJSON */
export type InputContentJSON = Extract<ArtifactNodeContent, { type: 'INPUT' }>
/** JSON representation for PromptContent - used by fromJSON */
export type PromptContentJSON = Extract<ArtifactNodeContent, { type: 'PROMPT' }>
/** JSON representation for GeneratedContent - used by fromJSON */
export type GeneratedContentJSON = Extract<ArtifactNodeContent, { type: 'GENERATED' }>
/** JSON representation for VFSContent - used by fromJSON */
export type VFSContentJSON = Extract<ArtifactNodeContent, { type: 'VFS' }>
/** JSON representation for SandboxContent - used by fromJSON */
export type SandboxContentJSON = Extract<ArtifactNodeContent, { type: 'SANDBOX' }>
/** JSON representation for LoaderContent - used by fromJSON */
export type LoaderContentJSON = Extract<ArtifactNodeContent, { type: 'LOADER' }>
/** JSON representation for StateContent - used by fromJSON */
export type StateContentJSON = Extract<ArtifactNodeContent, { type: 'STATE' }>

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
  
  /** 
   * Get raw data for persistence (JSON-serializable)
   * Must include 'type' field to match ArtifactNodeContent schema
   */
  toJSON(): ArtifactNodeContent
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
// ContentBlock Types
// ============================================================================

/**
 * A text block containing plain text
 */
export interface TextBlock {
  type: 'TextBlock'
  value: string
}

/**
 * A reftag block representing an @reference
 */
export interface RefTagBlock {
  type: 'RefTagBlock'
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
    if (block.type === 'TextBlock') {
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
    .filter((b): b is RefTagBlock => b.type === 'RefTagBlock')
    .map(b => b.name)
  return [...new Set(names)]
}

// ============================================================================
// VFS Reference Types
// ============================================================================

/**
 * VFS version reference - records the VFS state at a specific point in time.
 */
export interface VfsRef {
  /** VFS Node ID */
  nodeId: string
  /** Git commit hash - records the VFS state at generation time */
  commit: string
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

// ============================================================================
// Content Implementations
// ============================================================================

/**
 * Input node content - user input that triggers generation
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

  withBlocks(blocks: ContentBlock[]): InputContent {
    return new InputContent(blocks, { ...this.generationConfig })
  }

  withGenerationConfig(config: Partial<InputGenerationConfig>): InputContent {
    return new InputContent(
      structuredClone(this.blocks),
      { ...this.generationConfig, ...config }
    )
  }

  toJSON(): ArtifactNodeContent {
    return { 
      type: 'INPUT' as const,
      blocks: this.blocks,
      generationConfig: this.generationConfig 
    }
  }

  static fromJSON(data: { 
    type?: 'INPUT'
    blocks?: ContentBlock[]
    generationConfig?: InputGenerationConfig 
  }): InputContent {
    return new InputContent(data.blocks ?? [], data.generationConfig ?? {})
  }
}

/**
 * Prompt node content - user-edited prompts/system prompts
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

  withBlocks(blocks: ContentBlock[]): PromptContent {
    return new PromptContent(blocks)
  }

  toJSON(): ArtifactNodeContent {
    return { 
      type: 'PROMPT' as const,
      blocks: this.blocks
    }
  }

  static fromJSON(data: { 
    type?: 'PROMPT'
    blocks?: ContentBlock[]
  }): PromptContent {
    return new PromptContent(data.blocks ?? [])
  }

  static fromText(text: string): PromptContent {
    if (!text) {
      return new PromptContent([])
    }
    return new PromptContent([{ type: 'TextBlock', value: text }])
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
    public indirectPromptRefs: NodeRef[] = [],
    public inputVfsRef: VfsRef | null = null,
    public outputVfsId: string | null = null,
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

  toJSON(): ArtifactNodeContent {
    return {
      type: 'GENERATED' as const,
      blocks: this.blocks,
      inputRef: this.inputRef,
      promptRefs: this.promptRefs,
      indirectPromptRefs: this.indirectPromptRefs,
      inputVfsRef: this.inputVfsRef ?? undefined,
      outputVfsId: this.outputVfsId ?? undefined,
      postGenerationCommit: this.postGenerationCommit ?? undefined
    }
  }

  static fromJSON(data: {
    type?: 'GENERATED'
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
 * VFS node content - virtual file system reference
 */
export class VFSContent implements NodeContent {
  constructor(
    public projectId: string,
    public mounts: VfsMountConfig[] = []
  ) {}

  getText(): string {
    return ''
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

  addMount(mount: VfsMountConfig): VFSContent {
    return new VFSContent(
      this.projectId,
      [...this.mounts, mount]
    )
  }

  removeMount(mountId: string): VFSContent {
    return new VFSContent(
      this.projectId,
      this.mounts.filter(m => m.id !== mountId)
    )
  }

  updateMountPath(mountId: string, newPath: string): VFSContent {
    return new VFSContent(
      this.projectId,
      this.mounts.map(m =>
        m.id === mountId ? { ...m, mountPath: newPath } : m
      )
    )
  }

  updateMountCommit(mountId: string, sourceCommit: string): VFSContent {
    return new VFSContent(
      this.projectId,
      this.mounts.map(m =>
        m.id === mountId ? { ...m, sourceCommit } : m
      )
    )
  }

  toJSON(): ArtifactNodeContent {
    return {
      type: 'VFS' as const,
      projectId: this.projectId,
      mounts: this.mounts
    }
  }

  static fromJSON(data: { 
    type?: 'VFS'
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
    return ''
  }

  serialize(): string {
    return JSON.stringify({ entryFile: this.entryFile })
  }

  clone(): SandboxContent {
    return new SandboxContent(this.entryFile)
  }

  toJSON(): ArtifactNodeContent {
    return { type: 'SANDBOX' as const, entryFile: this.entryFile }
  }

  static fromJSON(data: { type?: 'SANDBOX'; entryFile?: string }): SandboxContent {
    return new SandboxContent(data.entryFile ?? 'index.html')
  }
}

/**
 * Loader node content - Lua VM service executor configuration
 */
export class LoaderContent implements NodeContent {
  constructor() {}

  getText(): string {
    return ''
  }

  serialize(): string {
    return '{}'
  }

  clone(): LoaderContent {
    return new LoaderContent()
  }

  toJSON(): ArtifactNodeContent {
    return { type: 'LOADER' as const }
  }

  static fromJSON(data: { type?: 'LOADER' }): LoaderContent {
    void data
    return new LoaderContent()
  }
}

/**
 * State node content - RDF triple store
 */
export class StateContent implements NodeContent {
  constructor() {}

  getText(): string {
    return ''
  }

  serialize(): string {
    return JSON.stringify({})
  }

  clone(): StateContent {
    return new StateContent()
  }

  toJSON(): ArtifactNodeContent {
    return { type: 'STATE' as const }
  }

  static fromJSON(data: { type?: 'STATE' }): StateContent {
    void data
    return new StateContent()
  }
}

// ============================================================================
// Content Factory & Restoration
// ============================================================================

export type NodeType = 'INPUT' | 'PROMPT' | 'GENERATED' | 'VFS' | 'SANDBOX' | 'LOADER' | 'STATE'

/**
 * Restore content class instance from ArtifactNodeContent JSON data.
 */
export function restoreContent(type: NodeType, data: unknown): NodeContent {
  const json = data as ArtifactNodeContent
  switch (type) {
    case 'INPUT':
      return InputContent.fromJSON(json as Parameters<typeof InputContent.fromJSON>[0])
    case 'PROMPT':
      return PromptContent.fromJSON(json as Parameters<typeof PromptContent.fromJSON>[0])
    case 'GENERATED':
      return GeneratedContent.fromJSON(json as Parameters<typeof GeneratedContent.fromJSON>[0])
    case 'VFS':
      return VFSContent.fromJSON(json as Parameters<typeof VFSContent.fromJSON>[0])
    case 'SANDBOX':
      return SandboxContent.fromJSON(json as Parameters<typeof SandboxContent.fromJSON>[0])
    case 'LOADER':
      return LoaderContent.fromJSON(json as Parameters<typeof LoaderContent.fromJSON>[0])
    case 'STATE':
      return StateContent.fromJSON(json as Parameters<typeof StateContent.fromJSON>[0])
  }
}
