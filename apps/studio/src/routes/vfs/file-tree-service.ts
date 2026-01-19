/**
 * VfsFileTreeService - Manages file tree state and operations for VFS
 * 
 * This service encapsulates all file tree logic that was duplicated across
 * VFSNode and VFSProperties components:
 * - Loading folder contents from VFS
 * - Converting VFS items to FileItem format
 * - Incremental updates via VFS events
 * - Tree manipulation utilities
 */

import type { FileItem } from '@pubwiki/ui/components';
import type { VfsFile, VfsFolder } from '@pubwiki/vfs';
import type { VersionedVfs } from './store';

/**
 * Check if a VFS item is a folder
 */
export function isVfsFolder(item: VfsFile | VfsFolder): item is VfsFolder {
  return 'parentFolderId' in item && !('size' in item);
}

/**
 * Count files in a tree
 */
export function countFiles(items: FileItem[]): number {
  let count = 0;
  for (const item of items) {
    if (item.type === 'file') count++;
    if (item.files) count += countFiles(item.files);
  }
  return count;
}

/**
 * Count folders in a tree
 */
export function countFolders(items: FileItem[]): number {
  let count = 0;
  for (const item of items) {
    if (item.type === 'folder') {
      count++;
      if (item.files) count += countFolders(item.files);
    }
  }
  return count;
}

/**
 * Get parent path from a path
 */
export function getParentPath(path: string): string {
  const lastSlash = path.lastIndexOf('/');
  return lastSlash <= 0 ? '/' : path.substring(0, lastSlash);
}

/**
 * Get file/folder name from path
 */
export function getFileName(path: string): string {
  return path.substring(path.lastIndexOf('/') + 1);
}

/**
 * VfsFileTreeService - Manages file tree state for a VFS instance
 */
export class VfsFileTreeService {
  private vfs: VersionedVfs;
  private eventUnsubscribers: (() => void)[] = [];
  private onTreeChange: (tree: FileItem[]) => void;
  private tree: FileItem[] = [];
  
  // Debounce state for full refresh
  private refreshDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingRefresh = false;
  
  // Debounce state for incremental updates
  private updateDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingAddFiles: string[] = [];
  private pendingAddFolders: string[] = [];
  private pendingRemoves: string[] = [];
  private treeModified = false;
  
  constructor(vfs: VersionedVfs, onTreeChange: (tree: FileItem[]) => void) {
    this.vfs = vfs;
    this.onTreeChange = onTreeChange;
  }
  
  /**
   * Initialize the service - load initial tree and setup event listeners
   */
  async initialize(): Promise<void> {
    await this.loadFullTree();
    this.setupEventListeners();
  }
  
  /**
   * Dispose the service - cleanup event listeners
   */
  dispose(): void {
    for (const unsubscribe of this.eventUnsubscribers) {
      unsubscribe();
    }
    this.eventUnsubscribers = [];
    
    if (this.refreshDebounceTimer) {
      clearTimeout(this.refreshDebounceTimer);
      this.refreshDebounceTimer = null;
    }
    if (this.updateDebounceTimer) {
      clearTimeout(this.updateDebounceTimer);
      this.updateDebounceTimer = null;
    }
  }
  
  /**
   * Get current tree
   */
  getTree(): FileItem[] {
    return this.tree;
  }
  
  // ========== Event Handling ==========
  
  private setupEventListeners(): void {
    const events = this.vfs.events;
    
    this.eventUnsubscribers.push(
      events.on('file:created', (e) => {
        this.queueAddFile(e.path);
      }),
      events.on('file:updated', () => { /* No tree change needed */ }),
      events.on('file:deleted', (e) => {
        this.queueRemove(e.path);
      }),
      events.on('file:moved', (e) => {
        this.queueRemove(e.fromPath);
        this.queueAddFile(e.toPath);
      }),
      events.on('folder:created', (e) => {
        this.queueAddFolder(e.path);
      }),
      events.on('folder:deleted', (e) => {
        this.queueRemove(e.path);
      }),
      events.on('folder:moved', (e) => {
        this.queueRemove(e.fromPath);
        this.queueAddFolder(e.toPath);
      }),
      events.on('version:checkout', () => {
        this.scheduleRefresh();
      })
    );
  }
  
  // ========== Batched Updates ==========
  
  /**
   * Check if a path should be filtered (root .git directory)
   */
  private shouldFilter(path: string): boolean {
    return path === '/.git' || path.startsWith('/.git/');
  }
  
  private queueAddFile(path: string): void {
    if (this.shouldFilter(path)) return;
    this.pendingAddFiles.push(path);
    this.scheduleUpdate();
  }
  
  private queueAddFolder(path: string): void {
    if (this.shouldFilter(path)) return;
    this.pendingAddFolders.push(path);
    this.scheduleUpdate();
  }
  
  private queueRemove(path: string): void {
    if (this.shouldFilter(path)) return;
    this.pendingRemoves.push(path);
    this.scheduleUpdate();
  }
  
  private scheduleUpdate(): void {
    if (this.updateDebounceTimer) {
      return; // Already scheduled
    }
    this.updateDebounceTimer = setTimeout(() => {
      this.updateDebounceTimer = null;
      this.processPendingUpdates();
    }, 50); // 50ms debounce for batching updates
  }
  
  private processPendingUpdates(): void {
    const addFiles = this.pendingAddFiles;
    const addFolders = this.pendingAddFolders;
    const removes = this.pendingRemoves;
    
    // Clear queues
    this.pendingAddFiles = [];
    this.pendingAddFolders = [];
    this.pendingRemoves = [];
    this.treeModified = false;
    
    const totalOps = addFiles.length + addFolders.length + removes.length;
    if (totalOps === 0) {
      return;
    }
    
    // Process removes first (in case of move operations)
    for (const path of removes) {
      this.removeItemFromTreeInternal(path);
    }
    
    // Process folder adds (sorted by depth so parents come first)
    const sortedFolders = addFolders.sort((a, b) => 
      a.split('/').length - b.split('/').length
    );
    for (const path of sortedFolders) {
      this.addFolderToTreeInternal(path);
    }
    
    // Process file adds
    for (const path of addFiles) {
      this.addFileToTreeInternal(path);
    }
    
    // Only notify once for the entire batch
    if (this.treeModified) {
      this.onTreeChange([...this.tree]);
    }
  }
  
  // ========== Full Tree Loading ==========
  
  private scheduleRefresh(): void {
    this.pendingRefresh = true;
    if (this.refreshDebounceTimer) {
      clearTimeout(this.refreshDebounceTimer);
    }
    this.refreshDebounceTimer = setTimeout(() => {
      this.refreshDebounceTimer = null;
      if (this.pendingRefresh) {
        this.pendingRefresh = false;
        this.loadFullTree();
      }
    }, 100);
  }
  
  async loadFullTree(): Promise<void> {
    try {
      const items = await this.loadFolderContents('/', 0);
      this.tree = items;
      this.onTreeChange(items);
    } catch (err) {
      console.error('[VFS Tree] Failed to load:', err);
    }
  }
  
  private async loadFolderContents(folderPath: string, depth: number): Promise<FileItem[]> {
    const entries = await this.vfs.listFolder(folderPath);
    
    // Filter out root .git directory
    const filteredEntries = entries.filter(e => !this.shouldFilter(e.path));
    
    // Separate folders and files
    const folders = filteredEntries.filter(isVfsFolder);
    const files = filteredEntries.filter(e => !isVfsFolder(e));
    
    // Parallel load all folder contents
    const folderItems = await Promise.all(
      folders.map(async (folder) => {
        const children = await this.loadFolderContents(folder.path, depth + 1);
        return {
          type: 'folder' as const,
          name: folder.name,
          path: folder.path,
          files: children
        };
      })
    );
    
    // Map files
    const fileItems: FileItem[] = files.map(file => ({
      type: 'file' as const,
      name: file.name,
      path: file.path
    }));
    
    // Combine and sort
    const items = [...folderItems, ...fileItems];
    items.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    
    return items;
  }
  
  // ========== Incremental Updates (Internal - no notification) ==========
  
  private findParentItems(items: FileItem[], parentPath: string): FileItem[] | null {
    if (parentPath === '/') {
      return items;
    }
    
    for (const item of items) {
      if (item.type === 'folder') {
        if (item.path === parentPath) {
          return item.files ?? [];
        }
        if (parentPath.startsWith(item.path + '/') && item.files) {
          const result = this.findParentItems(item.files, parentPath);
          if (result) return result;
        }
      }
    }
    return null;
  }
  
  /**
   * Ensure parent directory exists in tree, creating missing ancestors if needed.
   * Returns the parent's files array.
   */
  private ensureParentExists(parentPath: string): FileItem[] {
    if (parentPath === '/') {
      return this.tree;
    }
    
    // Check if parent already exists
    const existing = this.findParentItems(this.tree, parentPath);
    if (existing) {
      return existing;
    }
    
    // Parent doesn't exist, recursively ensure grandparent exists first
    const grandparentPath = getParentPath(parentPath);
    const grandparentItems = this.ensureParentExists(grandparentPath);
    
    // Create the missing parent folder
    const parentName = getFileName(parentPath);
    const newFolder: FileItem = { type: 'folder', name: parentName, path: parentPath, files: [] };
    grandparentItems.push(newFolder);
    this.sortItems(grandparentItems);
    this.treeModified = true;
    
    return newFolder.files!;
  }
  
  private addFileToTreeInternal(path: string): void {
    const parentPath = getParentPath(path);
    const fileName = getFileName(path);
    
    // Ensure parent exists (creates missing ancestors automatically)
    const parentItems = this.ensureParentExists(parentPath);
    
    // Check if file already exists
    if (!parentItems.some(item => item.path === path)) {
      const newFile: FileItem = { type: 'file', name: fileName, path };
      parentItems.push(newFile);
      this.sortItems(parentItems);
      this.treeModified = true;
    }
  }
  
  private addFolderToTreeInternal(path: string): void {
    const parentPath = getParentPath(path);
    const folderName = getFileName(path);
    
    // Ensure parent exists (creates missing ancestors automatically)
    const parentItems = this.ensureParentExists(parentPath);
    
    // Check if folder already exists
    if (!parentItems.some(item => item.path === path)) {
      const newFolder: FileItem = { type: 'folder', name: folderName, path, files: [] };
      parentItems.push(newFolder);
      this.sortItems(parentItems);
      this.treeModified = true;
    }
  }
  
  private removeItemFromTreeInternal(path: string): void {
    const parentPath = getParentPath(path);
    
    if (parentPath === '/') {
      const index = this.tree.findIndex(item => item.path === path);
      if (index !== -1) {
        this.tree.splice(index, 1);
        this.treeModified = true;
      }
      return;
    }
    
    const parentItems = this.findParentItems(this.tree, parentPath);
    if (parentItems) {
      const index = parentItems.findIndex(item => item.path === path);
      if (index !== -1) {
        parentItems.splice(index, 1);
        this.treeModified = true;
      }
    }
  }
  
  private sortItems(items: FileItem[]): void {
    items.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }
}
