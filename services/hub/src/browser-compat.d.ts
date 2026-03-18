/**
 * Browser API type stubs for cross-environment compatibility.
 *
 * Some workspace packages (@pubwiki/lua, @pubwiki/rdfstore) export raw .ts
 * source files that reference browser-only APIs. When these are type-checked
 * under the Workers tsconfig (which lacks DOM types), TypeScript reports
 * missing type errors. This file provides minimal type stubs for those APIs.
 *
 * All consumer packages have `skipLibCheck: true`, so when these packages are
 * compiled with their own DOM-enabled tsconfigs, any `.d.ts` conflicts are
 * suppressed.
 */

// --------------------------------------------------------------------------
// Browser globals used by @pubwiki/lua for environment detection
// --------------------------------------------------------------------------
declare var window: unknown
declare var document: { baseURI: string } | undefined

// --------------------------------------------------------------------------
// WebAssembly APIs missing from Workers types (used by @pubwiki/lua)
// --------------------------------------------------------------------------
declare namespace WebAssembly {
  function compile(bytes: BufferSource): Promise<WebAssembly.Module>
  function instantiateStreaming(
    source: Response | PromiseLike<Response>,
    importObject?: WebAssembly.Imports
  ): Promise<{ instance: WebAssembly.Instance; module: WebAssembly.Module }>
}

// --------------------------------------------------------------------------
// IndexedDB API types used by @pubwiki/rdfstore (browser-only module)
// --------------------------------------------------------------------------
declare var indexedDB: {
  open(name: string, version?: number): IDBOpenDBRequest
}

declare interface IDBRequest<T = unknown> {
  readonly result: T
  readonly error: unknown
  onsuccess: (() => void) | null
  onerror: (() => void) | null
}

declare interface IDBOpenDBRequest extends IDBRequest<IDBDatabase> {
  onupgradeneeded: (() => void) | null
}

declare interface IDBDatabase {
  readonly objectStoreNames: { contains(name: string): boolean }
  createObjectStore(name: string): IDBObjectStore
  transaction(storeNames: string | string[], mode?: string): IDBTransaction
}

declare interface IDBTransaction {
  objectStore(name: string): IDBObjectStore
}

declare interface IDBObjectStore {
  put(value: unknown, key?: string): IDBRequest
  get(key: string): IDBRequest
  delete(key: string): IDBRequest
  getAllKeys(): IDBRequest<string[]>
  getAll(): IDBRequest<unknown[]>
}
