import type { VfsFile, VfsFolder, VfsCommit } from './types'

// ========== 事件类型定义 ==========

/** 事件基础信息 */
interface VfsEventBase {
  /** 事件时间戳 */
  timestamp: number
}

/** 文件创建事件 */
export interface FileCreatedEvent extends VfsEventBase {
  type: 'file:created'
  file: VfsFile
  path: string
}

/** 文件更新事件 */
export interface FileUpdatedEvent extends VfsEventBase {
  type: 'file:updated'
  file: VfsFile
  path: string
  /** 是否只更新了元数据 */
  metadataOnly?: boolean
}

/** 文件删除事件 */
export interface FileDeletedEvent extends VfsEventBase {
  type: 'file:deleted'
  path: string
}

/** 文件移动事件 */
export interface FileMovedEvent extends VfsEventBase {
  type: 'file:moved'
  fromPath: string
  toPath: string
  file: VfsFile
}

/** 文件夹创建事件 */
export interface FolderCreatedEvent extends VfsEventBase {
  type: 'folder:created'
  folder: VfsFolder
  path: string
}

/** 文件夹更新事件 */
export interface FolderUpdatedEvent extends VfsEventBase {
  type: 'folder:updated'
  path: string
  updates: Partial<VfsFolder>
}

/** 文件夹删除事件 */
export interface FolderDeletedEvent extends VfsEventBase {
  type: 'folder:deleted'
  path: string
  recursive: boolean
}

/** 文件夹移动事件 */
export interface FolderMovedEvent extends VfsEventBase {
  type: 'folder:moved'
  fromPath: string
  toPath: string
}

/** 版本提交事件 */
export interface VersionCommitEvent extends VfsEventBase {
  type: 'version:commit'
  commit: VfsCommit
}

/** 版本检出事件 */
export interface VersionCheckoutEvent extends VfsEventBase {
  type: 'version:checkout'
  ref: string
}

/** 版本硬重置事件 */
export interface VersionRevertEvent extends VfsEventBase {
  type: 'version:revert'
  ref: string
}

/** 挂载点添加事件 */
export interface MountAddedEvent extends VfsEventBase {
  type: 'mount:added'
  path: string
  /** Optional mount ID (e.g., node ID in studio) */
  mountedId?: string
}

/** 挂载点移动事件 */
export interface MountMovedEvent extends VfsEventBase {
  type: 'mount:moved'
  fromPath: string
  toPath: string
  /** Optional mount ID (e.g., node ID in studio) */
  mountedId?: string
}

/** 挂载点移除事件 */
export interface MountRemovedEvent extends VfsEventBase {
  type: 'mount:removed'
  path: string
  /** Optional mount ID (e.g., node ID in studio) */
  mountedId?: string
}

/** 所有 VFS 事件的联合类型 */
export type VfsEvent =
  | FileCreatedEvent
  | FileUpdatedEvent
  | FileDeletedEvent
  | FileMovedEvent
  | FolderCreatedEvent
  | FolderUpdatedEvent
  | FolderDeletedEvent
  | FolderMovedEvent
  | VersionCommitEvent
  | VersionCheckoutEvent
  | VersionRevertEvent
  | MountAddedEvent
  | MountMovedEvent
  | MountRemovedEvent

/** 事件类型字符串 */
export type VfsEventType = VfsEvent['type']

/** 根据事件类型获取事件数据类型 */
export type VfsEventData<T extends VfsEventType> = Extract<VfsEvent, { type: T }>

/** 事件处理函数类型 */
export type VfsEventHandler<T extends VfsEventType = VfsEventType> = (
  event: VfsEventData<T>
) => void | Promise<void>

// ========== VFS 事件总线 ==========

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = (event: any) => void | Promise<void>

/**
 * VFS 事件总线
 *
 * 提供文件系统事件的发布/订阅功能。
 */
export class VfsEventBus {
  private listeners = new Map<string, Set<AnyHandler>>()

  /**
   * 订阅特定类型的事件
   * @param eventType 事件类型
   * @param handler 事件处理函数
   * @returns 取消订阅函数
   */
  on<T extends VfsEventType>(
    eventType: T,
    handler: VfsEventHandler<T>
  ): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set())
    }

    this.listeners.get(eventType)!.add(handler as AnyHandler)

    return () => this.off(eventType, handler)
  }

  /**
   * 订阅一次性事件
   * @param eventType 事件类型
   * @param handler 事件处理函数
   * @returns 取消订阅函数
   */
  once<T extends VfsEventType>(
    eventType: T,
    handler: VfsEventHandler<T>
  ): () => void {
    const wrapper: VfsEventHandler<T> = async (event) => {
      this.off(eventType, wrapper)
      await handler(event)
    }
    return this.on(eventType, wrapper)
  }

  /**
   * 取消订阅
   * @param eventType 事件类型
   * @param handler 事件处理函数
   */
  off<T extends VfsEventType>(
    eventType: T,
    handler: VfsEventHandler<T>
  ): void {
    const handlers = this.listeners.get(eventType)
    if (handlers) {
      handlers.delete(handler as AnyHandler)
      if (handlers.size === 0) {
        this.listeners.delete(eventType)
      }
    }
  }

  /**
   * 订阅所有事件
   * @param handler 事件处理函数
   * @returns 取消订阅函数
   */
  onAny(handler: VfsEventHandler): () => void {
    const eventTypes: VfsEventType[] = [
      'file:created',
      'file:updated',
      'file:deleted',
      'file:moved',
      'folder:created',
      'folder:updated',
      'folder:deleted',
      'folder:moved',
    ]

    const unsubscribers = eventTypes.map((type) => this.on(type, handler))

    return () => unsubscribers.forEach((unsub) => unsub())
  }

  /**
   * 发射事件 (fire-and-forget，不阻塞等待监听器)
   * @param event 事件对象
   */
  emit<T extends VfsEventType>(event: VfsEventData<T>): void {
    const handlers = this.listeners.get(event.type)
    if (handlers && handlers.size > 0) {
      for (const handler of handlers) {
        Promise.resolve()
          .then(() => handler(event))
          .catch((err) => {
            console.error(
              `[VfsEventBus] Error in handler for "${event.type}":`,
              err
            )
          })
      }
    }
  }

  /**
   * 清除所有监听器
   */
  clear(): void {
    this.listeners.clear()
  }

  /**
   * 清理资源
   */
  dispose(): void {
    this.clear()
  }
}
