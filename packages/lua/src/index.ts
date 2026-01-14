/**
 * pubwiki-lua - RDF-based Lua Script Runner
 * 
 * 完全基于 RDF 四元组的 Lua 执行引擎
 * 调用者需要提供 RDFStore 实现
 */

import type { RDFStore } from '@pubwiki/rdfstore'
import { DataFactory } from 'n3'
import {
  createRDFStoreContext,
  clearRDFStoreContext,
  getRDFStore
} from './rdf-context'
import type { Vfs, VfsProvider } from '@pubwiki/vfs'
import { isVfsFile } from '@pubwiki/vfs'
import {
  createVfsContext,
  createVfsContextWithId,
  clearVfsContext,
  getVfs
} from './vfs-bridge'

// ============= 文件系统支持 =============
// 使用 @pubwiki/vfs 的 Vfs 类作为文件系统接口
// Vfs 实例通过 runLua 或 createLuaInstance 的 options 参数传递

/**
 * Lua 执行结果
 */
export interface LuaExecutionResult {
  /** Lua 返回值（已解析为 JavaScript 值） */
  result: any
  /** print() 和 io.write() 的输出 */
  output: string
  /** 错误信息（如果有） */
  error: string | null
}

// ============= 导出类型 =============
export type { RDFStore, Ref, QuadPattern, Quad } from '@pubwiki/rdfstore'

// ============= 环境检测 =============

const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined'
const isNode = typeof process !== 'undefined' && process.versions != null && process.versions.node != null

// ============= WASM 模块管理 =============

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder('utf-8')

// JS 模块注册表：instanceId -> moduleName -> module definition
type JsModuleFunction = (...args: any[]) => any | Promise<any>
export interface JsModuleDefinition {
  [functionName: string]: JsModuleFunction
}
const jsModuleRegistry = new Map<number, Map<string, JsModuleDefinition>>()

// Async Iterator 存储：iteratorId -> AsyncIterator
const asyncIteratorRegistry = new Map<number, AsyncIterator<unknown>>()
let nextAsyncIteratorId = 1

/**
 * 检测一个值是否是 AsyncIterator
 */
function isAsyncIterator(value: unknown): value is AsyncIterator<unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as any).next === 'function'
  )
}

/**
 * 检测一个值是否是 AsyncIterable（可以获取 AsyncIterator）
 */
function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as any)[Symbol.asyncIterator] === 'function'
  )
}

// 默认 glue 路径：尝试相对于当前模块解析
// 在浏览器中，让用户显式提供路径更可靠
const DEFAULT_GLUE_PATH = (() => {
  try {
    return new URL('../wasm/lua_runner_glue.js', import.meta.url).href
  } catch {
    // 如果构造失败（某些打包环境），返回相对路径
    return '@pubwiki/pubwiki-lua/wasm/lua_runner_glue.js'
  }
})()

const DEFAULT_WASM_PATH = (() => {
  try {
    return new URL('../wasm/lua_runner_wasm.wasm', import.meta.url).href
  } catch {
    // 如果构造失败（某些打包环境），返回相对路径
    return '@pubwiki/pubwiki-lua/wasm/lua_runner_wasm.wasm'
  }
})()

let gluePath = DEFAULT_GLUE_PATH
let moduleInstance: LuaModule | null = null
let modulePromise: Promise<void> | null = null
let heapU8: Uint8Array | null = null
let heapU32: Uint32Array | null = null

interface LuaModule {
  HEAPU8: Uint8Array
  UTF8ToString(ptr: number): string
  _malloc(size: number): number
  _free(ptr: number): void
  
  // 异步执行接口
  _lua_run_async(codePtr: number, contextId: number, workingDirPtr: number): number
  _lua_executor_tick(): number
  _lua_has_pending_tasks(): number
  
  // 持久实例接口
  _lua_create_instance(contextId: number, workingDirPtr: number): number
  _lua_destroy_instance(instanceId: number): number
  _lua_run_on_instance_async(instanceId: number, codePtr: number, argsHandle: number): number
  
  // JS 模块注册接口
  _lua_register_js_module(instanceId: number, namePtr: number): void
  
  // 统一的 Promise 回调接口
  // handle: EM_VAL handle，0 表示 undefined/void
  _lua_callback_resolve(callbackId: number, handle: number): void
  _lua_callback_reject(callbackId: number, errorPtr: number): void
}

type LuaModuleFactory = (options: Record<string, unknown>) => LuaModule | Promise<LuaModule>

function ensureModule(): LuaModule {
  if (!moduleInstance) {
    throw new Error('Lua runner has not been loaded. Call loadRunner() first.')
  }
  return moduleInstance
}

function setHeapViews(module: LuaModule) {
  if (heapU8 !== module.HEAPU8) {
    heapU8 = module.HEAPU8
    heapU32 = new Uint32Array(heapU8.buffer)
  }
  if (!heapU8) {
    throw new Error('Lua runtime did not expose HEAPU8')
  }
}

// 辅助函数：分配字节到 WASM 内存
function allocateImportBytes(bytes: Uint8Array, module: LuaModule) {
  const length = bytes.length
  const ptr = module._malloc(length > 0 ? length : 1)
  if (length > 0) {
    module.HEAPU8.set(bytes, ptr)
  } else {
    module.HEAPU8[ptr] = 0
  }
  return { ptr, length }
}

// ============= Path Resolution =============
function resolveResourcePath(baseHref: string, file: string): string {
  if (!baseHref) return file
  if (!baseHref.endsWith('/')) {
    return `${baseHref}/${file}`
  }
  return `${baseHref}${file}`
}

// 辅助函数：从资源 URL 中提取基础路径
function deriveBasePath(resource: string): string {
  try {
    // 在 Node.js 中，如果是文件路径，使用 file:// 协议
    const baseURI = isBrowser && typeof document !== 'undefined' 
      ? document.baseURI 
      : isNode 
        ? import.meta.url 
        : undefined
    
    const url = new URL(resource, baseURI)
    url.hash = ''
    url.search = ''
    const pathname = url.pathname.replace(/[^/]*$/, '')
    return `${url.origin}${pathname}`
  } catch {
    const sanitized = resource.split(/[?#]/)[0]
    const idx = sanitized.lastIndexOf('/')
    return idx === -1 ? '' : sanitized.slice(0, idx + 1)
  }
}

// ============= 异步执行器支持 =============

// 存储 Lua 执行回调
const luaExecutionCallbacks = new Map<number, {
  resolve: (result: any) => void
  reject: (error: Error) => void
}>()

// 辅助函数：分配 UTF8 字符串到 WASM 内存
function allocateUTF8(str: string, module: LuaModule): number {
  const encoded = textEncoder.encode(str + '\0')
  const ptr = module._malloc(encoded.length)
  if (heapU8) {
    heapU8.set(encoded, ptr)
  }
  return ptr
}

/**
 * 加载 Lua WASM 模块
 * 
 * @param customGluePath 可选：自定义 glue.js 文件路径
 * @param customWasmPath 可选：自定义 .wasm 文件路径（如果未指定，将从 glue 路径推导）
 */
export async function loadRunner(customGluePath?: string, customWasmPath?: string): Promise<void> {
  if (moduleInstance) {
    return
  }
  
  if (customGluePath && customGluePath !== gluePath) {
    gluePath = customGluePath
  }
  
  // 保存自定义 WASM 路径，如果没有提供则使用默认值
  let wasmPath = customWasmPath || DEFAULT_WASM_PATH

  if (modulePromise) {
    return modulePromise
  }

  modulePromise = (async () => {
    try {
      const glueHref = gluePath
      
      let basePath: string
      let factoryModule: any
      
      if (isNode) {
        // Node.js 环境：直接导入文件（避免 data URL 导致的环境检测问题）
        const { pathToFileURL, fileURLToPath } = await import('node:url')
        const path = await import('node:path')
        
        // 处理 file:// URL 或相对路径
        const fileUrl = glueHref.startsWith('file://') 
          ? glueHref
          : pathToFileURL(path.resolve(glueHref)).href
        
        const filePath = fileURLToPath(fileUrl)
        basePath = 'file://' + path.dirname(filePath) + '/'
        
        // 直接导入模块
        factoryModule = await import(/* @vite-ignore */ fileUrl)
      } else {
        // 浏览器环境：使用 fetch + blob URL
        const response = await fetch(glueHref)
        if (!response.ok) {
          throw new Error(`Failed to fetch ${glueHref}: ${response.status}`)
        }
        const source = await response.text()
        basePath = deriveBasePath(glueHref)
        
        // 使用 blob URL 导入
        const blobUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
        factoryModule = await import(/* @vite-ignore */ blobUrl)
      }
      
      const factory = (factoryModule.default ?? factoryModule) as LuaModuleFactory

      let localModule: LuaModule | null = null

      // Emscripten 模块配置
      const moduleConfig: any = {
        // 资源定位函数
        locateFile: (path: string, _scriptDirectory: string) => {
          // 如果用户显式提供了 WASM 路径，使用它
          if (wasmPath && path.endsWith('.wasm')) {
            return wasmPath
          }
          
          // 否则使用 basePath + filename（默认行为）
          return basePath + path
        },        // instantiateWasm 回调，用于注入自定义导入函数
        instantiateWasm: async (imports: WebAssembly.Imports, successCallback: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void) => {
          // 添加 RDF bridge 函数到 env
          const env = (imports.env as Record<string, any>) || {}
          
          // 辅助函数：通过 callback 返回 EM_VAL handle（直接作为立即数）
          const resolveWithHandle = (callbackId: number, value: any, module: LuaModule) => {
            const Emval = (module as any).Emval
            if (!Emval) {
              const errorMsg = 'Emval not available'
              const errorPtr = allocateUTF8(errorMsg, module)
              module._lua_callback_reject(callbackId, errorPtr)
              module._free(errorPtr)
              module._lua_executor_tick()
              return
            }
            
            const resultHandle = Emval.toHandle(value)
            module._lua_callback_resolve(callbackId, resultHandle)
            module._lua_executor_tick()
          }
          
          // 注入 RDF 异步函数（使用 EM_VAL handles）
          // 新 API：所有变更操作返回 Ref，支持 graph 参数
          env.js_rdf_insert_async = (contextId: number, subjectPtr: number, predicatePtr: number, objectHandle: number, graphPtr: number, callbackId: number) => {
            const module = localModule
            if (!module) return
            
            const subject = module.UTF8ToString(subjectPtr)
            const predicate = module.UTF8ToString(predicatePtr)
            const graphStr = graphPtr ? module.UTF8ToString(graphPtr) : null
            
            // 获取 Emval
            const Emval = (module as any).Emval
            if (!Emval) {
              const errorMsg = 'Emval not available'
              const errorPtr = allocateUTF8(errorMsg, module)
              module._lua_callback_reject(callbackId, errorPtr)
              module._free(errorPtr)
              module._lua_executor_tick()
              return
            }
            
            // 获取 RDFStore
            const store = getRDFStore(contextId)
            if (!store) {
              const errorMsg = `RDFStore not found for context ${contextId}`
              const errorPtr = allocateUTF8(errorMsg, module)
              module._lua_callback_reject(callbackId, errorPtr)
              module._free(errorPtr)
              module._lua_executor_tick()
              return
            }
            
            // 从 EM_VAL handle 获取 object 值并转换为 RDF.js Term
            let objectValue: any
            try {
              objectValue = Emval.toValue(objectHandle)
            } catch (error) {
              const errorMsg = `Invalid object handle: ${error}`
              const errorPtr = allocateUTF8(errorMsg, module)
              module._lua_callback_reject(callbackId, errorPtr)
              module._free(errorPtr)
              module._lua_executor_tick()
              return
            }
            
            // 转换为 RDF.js Terms
            const subjectTerm = DataFactory.namedNode(subject)
            const predicateTerm = DataFactory.namedNode(predicate)
            const objectTerm = typeof objectValue === 'string' && objectValue.startsWith('resource://')
              ? DataFactory.namedNode(objectValue)
              : DataFactory.literal(String(objectValue))
            const graphTerm = graphStr ? DataFactory.namedNode(graphStr) : DataFactory.defaultGraph()
            
            // 异步执行插入操作 - 返回 Ref
            store.insert(subjectTerm, predicateTerm, objectTerm, graphTerm)
              .then((ref: string) => {
                // 返回 ref 字符串
                resolveWithHandle(callbackId, ref, module)
              })
              .catch((error: Error) => {
                const errorMsg = String(error)
                const errorPtr = allocateUTF8(errorMsg, module)
                module._lua_callback_reject(callbackId, errorPtr)
                module._free(errorPtr)
                module._lua_executor_tick()
              })
          }
          
          env.js_rdf_delete_async = (contextId: number, subjectPtr: number, predicatePtr: number, objectHandle: number, graphPtr: number, callbackId: number) => {
            const module = localModule
            if (!module) return
            
            const subject = module.UTF8ToString(subjectPtr)
            const predicate = module.UTF8ToString(predicatePtr)
            const graphStr = graphPtr ? module.UTF8ToString(graphPtr) : null
            
            const Emval = (module as any).Emval
            if (!Emval) {
              const errorMsg = 'Emval not available'
              const errorPtr = allocateUTF8(errorMsg, module)
              module._lua_callback_reject(callbackId, errorPtr)
              module._free(errorPtr)
              module._lua_executor_tick()
              return
            }
            
            const store = getRDFStore(contextId)
            if (!store) {
              const errorMsg = `RDFStore not found for context ${contextId}`
              const errorPtr = allocateUTF8(errorMsg, module)
              module._lua_callback_reject(callbackId, errorPtr)
              module._free(errorPtr)
              module._lua_executor_tick()
              return
            }
            
            // 从 EM_VAL handle 获取 object 值（可能为 null/undefined）
            let objectValue: any = undefined
            try {
              objectValue = Emval.toValue(objectHandle)
              if (objectValue === null) objectValue = undefined
            } catch (error) {
              const errorMsg = `Invalid object handle: ${error}`
              const errorPtr = allocateUTF8(errorMsg, module)
              module._lua_callback_reject(callbackId, errorPtr)
              module._free(errorPtr)
              module._lua_executor_tick()
              return
            }
            
            // 转换为 RDF.js Terms
            const subjectTerm = DataFactory.namedNode(subject)
            const predicateTerm = DataFactory.namedNode(predicate)
            const objectTerm = objectValue !== undefined
              ? (typeof objectValue === 'string' && objectValue.startsWith('resource://')
                ? DataFactory.namedNode(objectValue)
                : DataFactory.literal(String(objectValue)))
              : null
            const graphTerm = graphStr ? DataFactory.namedNode(graphStr) : null
            
            // 异步执行删除操作 - 返回 Ref
            store.delete(subjectTerm, predicateTerm, objectTerm, graphTerm)
              .then((ref: string) => {
                // 返回 ref 字符串
                resolveWithHandle(callbackId, ref, module)
              })
              .catch((error: Error) => {
                const errorMsg = String(error)
                const errorPtr = allocateUTF8(errorMsg, module)
                module._lua_callback_reject(callbackId, errorPtr)
                module._free(errorPtr)
                module._lua_executor_tick()
              })
          }
          
          env.js_rdf_query_async = (contextId: number, patternHandle: number, callbackId: number) => {
            const module = localModule
            if (!module) return
            
            const Emval = (module as any).Emval
            if (!Emval) {
              const errorMsg = 'Emval not available'
              const errorPtr = allocateUTF8(errorMsg, module)
              module._lua_callback_reject(callbackId, errorPtr)
              module._free(errorPtr)
              module._lua_executor_tick()
              return
            }
            
            const store = getRDFStore(contextId)
            if (!store) {
              const errorMsg = `RDFStore not found for context ${contextId}`
              const errorPtr = allocateUTF8(errorMsg, module)
              module._lua_callback_reject(callbackId, errorPtr)
              module._free(errorPtr)
              module._lua_executor_tick()
              return
            }
            
            // 从 EM_VAL handle 获取 pattern
            let patternRaw: any
            try {
              patternRaw = Emval.toValue(patternHandle)
            } catch (error) {
              const errorMsg = `Invalid pattern handle: ${error}`
              const errorPtr = allocateUTF8(errorMsg, module)
              module._lua_callback_reject(callbackId, errorPtr)
              module._free(errorPtr)
              module._lua_executor_tick()
              return
            }
            
            // 转换为 QuadPattern 格式
            const pattern: any = {}
            if (patternRaw.subject) {
              pattern.subject = DataFactory.namedNode(patternRaw.subject)
            }
            if (patternRaw.predicate) {
              pattern.predicate = DataFactory.namedNode(patternRaw.predicate)
            }
            if (patternRaw.object !== undefined && patternRaw.object !== null) {
              const obj = patternRaw.object
              pattern.object = typeof obj === 'string' && obj.startsWith('resource://')
                ? DataFactory.namedNode(obj)
                : DataFactory.literal(String(obj))
            }
            if (patternRaw.graph) {
              pattern.graph = DataFactory.namedNode(patternRaw.graph)
            }
            
            // 异步执行查询操作 - 返回 Quad[]
            store.query(pattern)
              .then((quads) => {
                // 转换 Quad[] 为 Lua 可用的对象数组
                const results = quads.map(q => ({
                  subject: q.subject.value,
                  predicate: q.predicate.value,
                  object: q.object.termType === 'Literal' ? q.object.value : q.object.value,
                  graph: q.graph.termType === 'DefaultGraph' ? null : q.graph.value
                }))
                resolveWithHandle(callbackId, results, module)
              })
              .catch((error: Error) => {
                const errorMsg = String(error)
                const errorPtr = allocateUTF8(errorMsg, module)
                module._lua_callback_reject(callbackId, errorPtr)
                module._free(errorPtr)
                module._lua_executor_tick()
              })
          }
          
          env.js_rdf_batch_insert_async = (contextId: number, quadsHandle: number, callbackId: number) => {
            const module = localModule
            if (!module) return
            
            const Emval = (module as any).Emval
            if (!Emval) {
              const errorMsg = 'Emval not available'
              const errorPtr = allocateUTF8(errorMsg, module)
              module._lua_callback_reject(callbackId, errorPtr)
              module._free(errorPtr)
              module._lua_executor_tick()
              return
            }
            
            const store = getRDFStore(contextId)
            if (!store) {
              const errorMsg = `RDFStore not found for context ${contextId}`
              const errorPtr = allocateUTF8(errorMsg, module)
              module._lua_callback_reject(callbackId, errorPtr)
              module._free(errorPtr)
              module._lua_executor_tick()
              return
            }
            
            // 从 EM_VAL handle 获取 quads 数组
            let quadsRaw: any[]
            try {
              quadsRaw = Emval.toValue(quadsHandle)
            } catch (error) {
              const errorMsg = `Invalid quads handle: ${error}`
              const errorPtr = allocateUTF8(errorMsg, module)
              module._lua_callback_reject(callbackId, errorPtr)
              module._free(errorPtr)
              module._lua_executor_tick()
              return
            }
            
            // 转换为 RDF.js Quad[]
            const quads = quadsRaw.map(q => {
              const subject = DataFactory.namedNode(q.subject)
              const predicate = DataFactory.namedNode(q.predicate)
              const object = typeof q.object === 'string' && q.object.startsWith('resource://')
                ? DataFactory.namedNode(q.object)
                : DataFactory.literal(String(q.object))
              const graph = q.graph ? DataFactory.namedNode(q.graph) : DataFactory.defaultGraph()
              return DataFactory.quad(subject, predicate, object, graph)
            })
            
            // 异步执行批量插入操作 - 返回 Ref
            store.batchInsert(quads)
              .then((ref: string) => {
                // 返回 ref 字符串
                resolveWithHandle(callbackId, ref, module)
              })
              .catch((error: Error) => {
                const errorMsg = String(error)
                const errorPtr = allocateUTF8(errorMsg, module)
                module._lua_callback_reject(callbackId, errorPtr)
                module._free(errorPtr)
                module._lua_executor_tick()
              })
          }

          // 版本控制 FFI 函数
          env.js_rdf_current_ref = (contextId: number) => {
            const module = localModule
            if (!module) return 0
            
            const store = getRDFStore(contextId)
            if (!store) {
              return 0
            }
            
            const Emval = (module as any).Emval
            if (!Emval) {
              return 0
            }
            
            // currentRef 是同步属性
            const ref = store.currentRef
            return Emval.toHandle(ref)
          }
          
          env.js_rdf_checkout_async = (contextId: number, refPtr: number, callbackId: number) => {
            const module = localModule
            if (!module) return
            
            const ref = module.UTF8ToString(refPtr)
            
            const store = getRDFStore(contextId)
            if (!store) {
              const errorMsg = `RDFStore not found for context ${contextId}`
              const errorPtr = allocateUTF8(errorMsg, module)
              module._lua_callback_reject(callbackId, errorPtr)
              module._free(errorPtr)
              module._lua_executor_tick()
              return
            }
            
            // 异步执行 checkout
            store.checkout(ref)
              .then(() => {
                module._lua_callback_resolve(callbackId, 0)
                module._lua_executor_tick()
              })
              .catch((error: Error) => {
                const errorMsg = String(error)
                const errorPtr = allocateUTF8(errorMsg, module)
                module._lua_callback_reject(callbackId, errorPtr)
                module._free(errorPtr)
                module._lua_executor_tick()
              })
          }
          
          env.js_rdf_checkpoint_async = (contextId: number, callbackId: number) => {
            const module = localModule
            if (!module) return
            
            const store = getRDFStore(contextId)
            if (!store) {
              const errorMsg = `RDFStore not found for context ${contextId}`
              const errorPtr = allocateUTF8(errorMsg, module)
              module._lua_callback_reject(callbackId, errorPtr)
              module._free(errorPtr)
              module._lua_executor_tick()
              return
            }
            
            // 异步执行 checkpoint - 返回 Ref
            store.checkpoint()
              .then((ref: string) => {
                resolveWithHandle(callbackId, ref, module)
              })
              .catch((error: Error) => {
                const errorMsg = String(error)
                const errorPtr = allocateUTF8(errorMsg, module)
                module._lua_callback_reject(callbackId, errorPtr)
                module._free(errorPtr)
                module._lua_executor_tick()
              })
          }

          // SPARQL 流式查询管理
          const activeSparqlQueries = new Map<number, AsyncIterator<any>>()
          let nextSparqlQueryId = 1

          env.js_rdf_sparql_query_start = (contextId: number, sparqlPtr: number, callbackId: number) => {
            const module = localModule
            if (!module) return 0
            
            const sparql = module.UTF8ToString(sparqlPtr)
            
            const store = getRDFStore(contextId)
            if (!store) {
              const errorMsg = `RDFStore not found for context ${contextId}`
              const errorPtr = allocateUTF8(errorMsg, module)
              module._lua_callback_reject(callbackId, errorPtr)
              module._free(errorPtr)
              module._lua_executor_tick()
              return 0
            }
            
            // 检查 store 是否支持 SPARQL 查询
            if (!store.sparqlQuery || typeof store.sparqlQuery !== 'function') {
              const errorMsg = 'RDFStore does not support SPARQL queries'
              const errorPtr = allocateUTF8(errorMsg, module)
              module._lua_callback_reject(callbackId, errorPtr)
              module._free(errorPtr)
              module._lua_executor_tick()
              return
            }
            
            try {
              // 执行 SPARQL 查询，获取异步迭代器
              const iterator = store.sparqlQuery(sparql)
              
              // 分配查询 ID
              const queryId = nextSparqlQueryId++
              activeSparqlQueries.set(queryId, iterator)
              
              // 返回 query_id 通过 emval
              resolveWithHandle(callbackId, queryId, module)
            } catch (error) {
              const errorMsg = `Failed to start SPARQL query: ${error}`
              const errorPtr = allocateUTF8(errorMsg, module)
              module._lua_callback_reject(callbackId, errorPtr)
              module._free(errorPtr)
              module._lua_executor_tick()
            }
          }

          env.js_rdf_sparql_query_next = (queryId: number, callbackId: number) => {
            const module = localModule
            if (!module) return
            
            const iterator = activeSparqlQueries.get(queryId)
            if (!iterator) {
              const errorMsg = `SPARQL query ${queryId} not found`
              const errorPtr = allocateUTF8(errorMsg, module)
              module._lua_callback_reject(callbackId, errorPtr)
              module._free(errorPtr)
              module._lua_executor_tick()
              return
            }
            
            // 异步获取下一个结果
            iterator.next()
              .then((result) => {
                if (result.done) {
                  // 查询结束，返回 0 表示 done
                  module._lua_callback_resolve(callbackId, 0)
                  // 自动清理查询
                  activeSparqlQueries.delete(queryId)
                } else {
                  // 返回当前结果通过 emval
                  resolveWithHandle(callbackId, { value: result.value, done: false }, module)
                }
              })
              .catch((error: Error) => {
                const errorMsg = `SPARQL query error: ${error}`
                const errorPtr = allocateUTF8(errorMsg, module)
                module._lua_callback_reject(callbackId, errorPtr)
                module._free(errorPtr)
                module._lua_executor_tick()
                // 清理查询
                activeSparqlQueries.delete(queryId)
              })
          }

          env.js_rdf_sparql_query_close = (queryId: number) => {
            // 清理查询资源
            activeSparqlQueries.delete(queryId)
          }

          // 注入文件系统函数
          // exists 也改为异步
          env.js_fs_exists_async = (contextId: number, pathPtr: number, callbackId: number) => {
            const module = localModule
            if (!module) return 0
            const path = module.UTF8ToString(pathPtr)
            
            const vfs = getVfs(contextId)
            if (!vfs) {
              const errorMsg = `VFS not found for context ${contextId}`
              const errorPtr = allocateUTF8(errorMsg, module)
              module._lua_callback_reject(callbackId, errorPtr)
              module._free(errorPtr)
              return 0
            }
            
            vfs.exists(path)
              .then((exists: boolean) => {
                // 使用 0 表示存在（undefined/void）
                if (exists) {
                  module._lua_callback_resolve(callbackId, 0)
                } else {
                  const errorMsg = 'File does not exist'
                  const errorPtr = allocateUTF8(errorMsg, module)
                  module._lua_callback_reject(callbackId, errorPtr)
                  module._free(errorPtr)
                }
                module._lua_executor_tick()
              })
              .catch((error: Error) => {
                const errorMsg = String(error)
                const errorPtr = allocateUTF8(errorMsg, module)
                module._lua_callback_reject(callbackId, errorPtr)
                module._free(errorPtr)
                module._lua_executor_tick()
              })
            
            return 1
          }
          
          // 异步文件系统 FFI 函数
          env.js_fs_read_async = (contextId: number, pathPtr: number, callbackId: number) => {
            const module = localModule
            if (!module) return 0
            const path = module.UTF8ToString(pathPtr)
            
            const vfs = getVfs(contextId)
            if (!vfs) {
              const errorMsg = `VFS not found for context ${contextId}`
              const errorPtr = allocateUTF8(errorMsg, module)
              module._lua_callback_reject(callbackId, errorPtr)
              module._free(errorPtr)
              return 0
            }
            
            vfs.readFile(path)
              .then((file) => {
                // VFS readFile returns a VfsFile object, get its content
                const content = file.content
                // 通过 emval 返回文件内容
                resolveWithHandle(callbackId, content, module)
              })
              .catch((error: Error) => {
                const errorMsg = String(error)
                const errorPtr = allocateUTF8(errorMsg, module)
                module._lua_callback_reject(callbackId, errorPtr)
                module._free(errorPtr)
                
                // 驱动 executor 处理回调
                module._lua_executor_tick()
              })
            
            return 1
          }
          
          env.js_fs_write_async = (contextId: number, pathPtr: number, contentPtr: number, callbackId: number) => {
            const module = localModule
            if (!module) return 0
            const path = module.UTF8ToString(pathPtr)
            const content = module.UTF8ToString(contentPtr)
            
            const vfs = getVfs(contextId)
            if (!vfs) {
              const errorMsg = `VFS not found for context ${contextId}`
              const errorPtr = allocateUTF8(errorMsg, module)
              module._lua_callback_reject(callbackId, errorPtr)
              module._free(errorPtr)
              return 0
            }
            
            // VFS uses createFile for new files and updateFile for existing
            // We'll use a pattern that creates or updates
            vfs.exists(path)
              .then(async (exists) => {
                if (exists) {
                  await vfs.updateFile(path, content)
                } else {
                  await vfs.createFile(path, content)
                }
                module._lua_callback_resolve(callbackId, 0)
                module._lua_executor_tick()
              })
              .catch((error: Error) => {
                const errorMsg = String(error)
                const errorPtr = allocateUTF8(errorMsg, module)
                module._lua_callback_reject(callbackId, errorPtr)
                module._free(errorPtr)
                module._lua_executor_tick()
              })
            
            return 1
          }
          
          env.js_fs_unlink_async = (contextId: number, pathPtr: number, callbackId: number) => {
            const module = localModule
            if (!module) return 0
            const path = module.UTF8ToString(pathPtr)
            
            const vfs = getVfs(contextId)
            if (!vfs) {
              const errorMsg = `VFS not found for context ${contextId}`
              const errorPtr = allocateUTF8(errorMsg, module)
              module._lua_callback_reject(callbackId, errorPtr)
              module._free(errorPtr)
              return 0
            }
            
            vfs.deleteFile(path)
              .then(() => {
                module._lua_callback_resolve(callbackId, 0)
                module._lua_executor_tick()
              })
              .catch((error: Error) => {
                const errorMsg = String(error)
                const errorPtr = allocateUTF8(errorMsg, module)
                module._lua_callback_reject(callbackId, errorPtr)
                module._free(errorPtr)
                module._lua_executor_tick()
              })
            
            return 1
          }
          
          env.js_fs_mkdir_async = (contextId: number, pathPtr: number, callbackId: number) => {
            const module = localModule
            if (!module) return 0
            const path = module.UTF8ToString(pathPtr)
            
            const vfs = getVfs(contextId)
            if (!vfs) {
              const errorMsg = `VFS not found for context ${contextId}`
              const errorPtr = allocateUTF8(errorMsg, module)
              module._lua_callback_reject(callbackId, errorPtr)
              module._free(errorPtr)
              return 0
            }
            
            vfs.createFolder(path)
              .then(() => {
                module._lua_callback_resolve(callbackId, 0)
                module._lua_executor_tick()
              })
              .catch((error: Error) => {
                const errorMsg = String(error)
                const errorPtr = allocateUTF8(errorMsg, module)
                module._lua_callback_reject(callbackId, errorPtr)
                module._free(errorPtr)
                module._lua_executor_tick()
              })
            
            return 1
          }
          
          env.js_fs_rmdir_async = (contextId: number, pathPtr: number, callbackId: number) => {
            const module = localModule
            if (!module) return 0
            const path = module.UTF8ToString(pathPtr)
            
            const vfs = getVfs(contextId)
            if (!vfs) {
              const errorMsg = `VFS not found for context ${contextId}`
              const errorPtr = allocateUTF8(errorMsg, module)
              module._lua_callback_reject(callbackId, errorPtr)
              module._free(errorPtr)
              return 0
            }
            
            vfs.deleteFolder(path)
              .then(() => {
                module._lua_callback_resolve(callbackId, 0)
                module._lua_executor_tick()
              })
              .catch((error: Error) => {
                const errorMsg = String(error)
                const errorPtr = allocateUTF8(errorMsg, module)
                module._lua_callback_reject(callbackId, errorPtr)
                module._free(errorPtr)
                module._lua_executor_tick()
              })
            
            return 1
          }
          
          env.js_fs_stat_async = (contextId: number, pathPtr: number, callbackId: number) => {
            const module = localModule
            if (!module) return 0
            const path = module.UTF8ToString(pathPtr)
            
            const vfs = getVfs(contextId)
            if (!vfs) {
              const errorMsg = `VFS not found for context ${contextId}`
              const errorPtr = allocateUTF8(errorMsg, module)
              module._lua_callback_reject(callbackId, errorPtr)
              module._free(errorPtr)
              return 0
            }
            
            vfs.stat(path)
              .then((stat) => {
                // 通过 emval 返回 VfsStat 对象
                const statObj = {
                  size: stat.size,
                  isDirectory: stat.isDirectory,
                  createdAt: stat.createdAt.toISOString(),
                  updatedAt: stat.updatedAt.toISOString()
                }
                resolveWithHandle(callbackId, statObj, module)
              })
              .catch((error: Error) => {
                const errorMsg = String(error)
                const errorPtr = allocateUTF8(errorMsg, module)
                module._lua_callback_reject(callbackId, errorPtr)
                module._free(errorPtr)
                module._lua_executor_tick()
              })
            
            return 1
          }
          
          env.js_fs_readdir_async = (contextId: number, pathPtr: number, callbackId: number) => {
            const module = localModule
            if (!module) return 0
            const path = module.UTF8ToString(pathPtr)
            
            const vfs = getVfs(contextId)
            if (!vfs) {
              const errorMsg = `VFS not found for context ${contextId}`
              const errorPtr = allocateUTF8(errorMsg, module)
              module._lua_callback_reject(callbackId, errorPtr)
              module._free(errorPtr)
              return 0
            }
            
            vfs.listFolder(path)
              .then((items) => {
                // 构建包含 stat 信息的条目列表
                const entries = items.map(item => ({
                  name: item.name,
                  path: item.path,
                  size: isVfsFile(item) ? item.size : 0,
                  isDirectory: !isVfsFile(item),
                  createdAt: item.createdAt,
                  updatedAt: item.updatedAt
                }))
                
                // 通过 emval 返回 entries 数组
                resolveWithHandle(callbackId, entries, module)
              })
              .catch((error: Error) => {
                const errorMsg = String(error)
                const errorPtr = allocateUTF8(errorMsg, module)
                module._lua_callback_reject(callbackId, errorPtr)
                module._free(errorPtr)
                module._lua_executor_tick()
              })
            
            return 1
          }
          
          // JS 模块调用函数（使用 EM_VAL handles）
          env.js_call_js_module = (
            instanceId: number,
            moduleNamePtr: number,
            functionNamePtr: number,
            argsHandlesPtr: number,
            argsCount: number,
            callbackId: number
          ) => {
            const module = localModule
            if (!module) return
            
            const moduleName = module.UTF8ToString(moduleNamePtr)
            const functionName = module.UTF8ToString(functionNamePtr)
            
            // 获取 Emval
            const Emval = (module as any).Emval
            if (!Emval) {
              const errorMsg = 'Emval not available'
              const errorPtr = allocateUTF8(errorMsg, module)
              module._lua_callback_reject(callbackId, errorPtr)
              module._free(errorPtr)
              module._lua_executor_tick()
              return
            }
            
            // 获取模块和函数
            const instanceModules = jsModuleRegistry.get(instanceId)
            if (!instanceModules) {
              const errorMsg = `Instance ${instanceId} not found`
              const errorPtr = allocateUTF8(errorMsg, module)
              module._lua_callback_reject(callbackId, errorPtr)
              module._free(errorPtr)
              module._lua_executor_tick()
              return
            }
            
            const moduleDefinition = instanceModules.get(moduleName)
            if (!moduleDefinition) {
              const errorMsg = `Module "${moduleName}" not registered`
              const errorPtr = allocateUTF8(errorMsg, module)
              module._lua_callback_reject(callbackId, errorPtr)
              module._free(errorPtr)
              module._lua_executor_tick()
              return
            }
            
            const func = moduleDefinition[functionName]
            if (!func || typeof func !== 'function') {
              const errorMsg = `Function "${functionName}" not found in module "${moduleName}"`
              const errorPtr = allocateUTF8(errorMsg, module)
              module._lua_callback_reject(callbackId, errorPtr)
              module._free(errorPtr)
              module._lua_executor_tick()
              return
            }
            
            // 从内存读取参数 handles 并转换为 JS 值
            const args: any[] = []
            setHeapViews(module)
            for (let i = 0; i < argsCount; i++) {
              // EM_VAL 是指针类型，在 32 位 WASM 中是 4 字节
              const handleOffset = argsHandlesPtr + i * 4
              const handle = heapU32![handleOffset / 4]
              try {
                const value = Emval.toValue(handle)
                args.push(value)
              } catch (error) {
                const errorMsg = `Invalid argument handle at index ${i}: ${error}`
                const errorPtr = allocateUTF8(errorMsg, module)
                module._lua_callback_reject(callbackId, errorPtr)
                module._free(errorPtr)
                module._lua_executor_tick()
                return
              }
            }
            
            // 调用函数（可能是同步或异步）
            Promise.resolve(func(...args))
              .then((result) => {
                // 检测是否是 AsyncIterable 或 AsyncIterator
                let actualResult: unknown
                
                if (isAsyncIterable(result)) {
                  // 获取 AsyncIterator 并存储
                  const iterator = (result as AsyncIterable<unknown>)[Symbol.asyncIterator]()
                  const iteratorId = nextAsyncIteratorId++
                  asyncIteratorRegistry.set(iteratorId, iterator)
                  actualResult = { __async_iterator_id: iteratorId }
                } else if (isAsyncIterator(result)) {
                  // 直接存储 AsyncIterator
                  const iteratorId = nextAsyncIteratorId++
                  asyncIteratorRegistry.set(iteratorId, result)
                  actualResult = { __async_iterator_id: iteratorId }
                } else {
                  actualResult = result
                }
                
                // 将结果转换为 EM_VAL handle 并直接传递
                const resultHandle = Emval.toHandle(actualResult)
                module._lua_callback_resolve(callbackId, resultHandle)
                module._lua_executor_tick()
              })
              .catch((error: Error) => {
                const errorMsg = error.message || String(error)
                const errorPtr = allocateUTF8(errorMsg, module)
                module._lua_callback_reject(callbackId, errorPtr)
                module._free(errorPtr)
                module._lua_executor_tick()
              })
          }
          
          // JsProxy 函数调用（使用 EM_VAL handles）
          // 直接通过 EM_VAL handles 传递参数，避免 JSON 序列化
          env.js_jsproxy_call = (
            funcHandle: number,
            argsHandlesPtr: number,
            argsCount: number,
            callbackId: number
          ) => {
            const module = localModule
            if (!module) return
            
            // 从 Emval 获取函数和参数
            const Emval = (module as any).Emval
            if (!Emval) {
              const errorMsg = 'Emval not available'
              const errorPtr = allocateUTF8(errorMsg, module)
              module._lua_callback_reject(callbackId, errorPtr)
              module._free(errorPtr)
              module._lua_executor_tick()
              return
            }
            
            let func: Function
            try {
              func = Emval.toValue(funcHandle)
            } catch (error) {
              const errorMsg = `Invalid function handle: ${error}`
              const errorPtr = allocateUTF8(errorMsg, module)
              module._lua_callback_reject(callbackId, errorPtr)
              module._free(errorPtr)
              module._lua_executor_tick()
              return
            }
            
            if (typeof func !== 'function') {
              const errorMsg = `Handle does not reference a function, got: ${typeof func}`
              const errorPtr = allocateUTF8(errorMsg, module)
              module._lua_callback_reject(callbackId, errorPtr)
              module._free(errorPtr)
              module._lua_executor_tick()
              return
            }
            
            // 从内存读取参数 handles 并转换为 JS 值
            const args: any[] = []
            setHeapViews(module)
            for (let i = 0; i < argsCount; i++) {
              // EM_VAL 是指针类型，在 32 位 WASM 中是 4 字节
              const handleOffset = argsHandlesPtr + i * 4
              const handle = heapU32![handleOffset / 4]
              try {
                const value = Emval.toValue(handle)
                args.push(value)
              } catch (error) {
                const errorMsg = `Invalid argument handle at index ${i}: ${error}`
                const errorPtr = allocateUTF8(errorMsg, module)
                module._lua_callback_reject(callbackId, errorPtr)
                module._free(errorPtr)
                module._lua_executor_tick()
                return
              }
            }
            
            // 调用函数（可能是同步或异步）
            // 使用 try-catch 包装以捕获同步异常
            let resultPromise: Promise<any>
            try {
              resultPromise = Promise.resolve(func(...args))
            } catch (error: any) {
              // 同步异常
              const errorMsg = error?.message || String(error)
              const errorPtr = allocateUTF8(errorMsg, module)
              module._lua_callback_reject(callbackId, errorPtr)
              module._free(errorPtr)
              module._lua_executor_tick()
              return
            }
            
            resultPromise
              .then((result) => {
                // 将结果转换为 EM_VAL handle 并直接传递
                const resultHandle = Emval.toHandle(result)
                module._lua_callback_resolve(callbackId, resultHandle)
                module._lua_executor_tick()
              })
              .catch((error: Error) => {
                const errorMsg = error.message || String(error)
                const errorPtr = allocateUTF8(errorMsg, module)
                module._lua_callback_reject(callbackId, errorPtr)
                module._free(errorPtr)
                module._lua_executor_tick()
              })
          }
          
          // Async Iterator: 获取下一个值（使用 EM_VAL handles）
          env.js_async_iterator_next = (iteratorId: number, callbackId: number) => {
            const module = localModule
            if (!module) return
            
            const Emval = (module as any).Emval
            if (!Emval) {
              const errorMsg = 'Emval not available'
              const errorPtr = allocateUTF8(errorMsg, module)
              module._lua_callback_reject(callbackId, errorPtr)
              module._free(errorPtr)
              module._lua_executor_tick()
              return
            }
            
            const iterator = asyncIteratorRegistry.get(iteratorId)
            if (!iterator) {
              // Iterator 不存在，返回 done: true
              const result = { value: undefined, done: true }
              const resultHandle = Emval.toHandle(result)
              module._lua_callback_resolve(callbackId, resultHandle)
              module._lua_executor_tick()
              return
            }
            
            // 调用 iterator.next()
            iterator.next()
              .then((iterResult) => {
                const result = {
                  value: iterResult.value,
                  done: iterResult.done ?? false
                }
                const resultHandle = Emval.toHandle(result)
                module._lua_callback_resolve(callbackId, resultHandle)
                module._lua_executor_tick()
              })
              .catch((error: Error) => {
                const errorMsg = error.message || String(error)
                const errorPtr = allocateUTF8(errorMsg, module)
                module._lua_callback_reject(callbackId, errorPtr)
                module._free(errorPtr)
                module._lua_executor_tick()
              })
          }
          
          // Async Iterator: 关闭迭代器
          env.js_async_iterator_close = (iteratorId: number) => {
            const iterator = asyncIteratorRegistry.get(iteratorId)
            if (iterator) {
              // 如果 iterator 有 return 方法，调用它来清理资源
              if (typeof iterator.return === 'function') {
                iterator.return()
              }
              asyncIteratorRegistry.delete(iteratorId)
            }
          }
          
          // Lua 执行完成回调
          env.js_lua_execution_callback = (executionId: number, resultJsonPtr: number) => {
            const callbacks = luaExecutionCallbacks.get(executionId)
            const module = localModule
            if (!callbacks || !module) {
              console.error(`No callback found for execution ${executionId}`)
              return
            }
            
            try {
              // 读取 JSON 结果
              const resultJson = module.UTF8ToString(resultJsonPtr)
              const result = JSON.parse(resultJson)
              // 始终返回完整的 LuaExecutionResult 对象，包括 error 情况
              // 这样调用者可以获取错误发生前的输出
              callbacks.resolve({
                result: result.result ?? null,
                output: result.output ?? '',
                error: result.error ?? null
              })
            } catch (error) {
              callbacks.reject(error as Error)
            } finally {
              // 清理回调
              luaExecutionCallbacks.delete(executionId)
            }
          }
          
          imports.env = env
          
          // 手动加载和实例化 WASM
          // 如果用户提供了自定义 WASM 路径（或使用默认值），优先使用；否则从 basePath 推导
          const finalWasmPath = wasmPath || resolveResourcePath(basePath, 'lua_runner_wasm.wasm')
          let result: WebAssembly.WebAssemblyInstantiatedSource
          
          if (isNode) {
            // Node.js：使用 fs 读取 WASM 文件
            const fs = await import('node:fs/promises')
            const { fileURLToPath } = await import('node:url')
            
            const wasmFilePath = finalWasmPath.startsWith('file://')
              ? fileURLToPath(finalWasmPath)
              : finalWasmPath
            
            const wasmBuffer = await fs.readFile(wasmFilePath)
            result = await WebAssembly.instantiate(wasmBuffer, imports)
          } else {
            // 浏览器：使用 fetch
            const fetchWasm = () => fetch(finalWasmPath, { credentials: 'same-origin' })
            
            const instantiateFromResponse = async (responsePromise: Promise<Response>) => {
              const wasmResponse = await responsePromise
              if (!wasmResponse.ok) {
                throw new Error(`Failed to fetch WASM: ${wasmResponse.status}`)
              }
              const bytes = await wasmResponse.arrayBuffer()
              return WebAssembly.instantiate(bytes, imports)
            }
            
            if (WebAssembly.instantiateStreaming) {
              try {
                result = await WebAssembly.instantiateStreaming(fetchWasm(), imports)
              } catch (_error) {
                result = await instantiateFromResponse(fetchWasm())
              }
            } else {
              result = await instantiateFromResponse(fetchWasm())
            }
          }
          
          const wasmExports = result.instance.exports
          
          // 调用 successCallback 完成实例化
          if (successCallback) {
            return successCallback(result.instance, result.module)
          }
          return wasmExports
        }
      }

      const module = await factory(moduleConfig)
      
      localModule = module
      moduleInstance = module
      setHeapViews(module)
    } catch (error) {
      modulePromise = null
      throw error
    }
  })()

  return modulePromise
}

/**
 * Lua 执行选项
 */
export interface LuaRunOptions {
  /** RDF 存储实现（可选，如果 Lua 代码需要 RDF 功能） */
  rdfStore?: RDFStore
  /** 虚拟文件系统实例（可选，如果 Lua 代码需要文件系统功能） */
  vfs?: Vfs<VfsProvider>
  /** 工作目录（用于 require 相对路径解析），默认为 "/" */
  workingDirectory?: string
  /** 
   * 传递给 Lua 代码的参数对象
   * 在 Lua 中可以直接访问参数名作为变量
   */
  args?: Record<string, unknown>
}

/**
 * 运行 Lua 代码
 * 
 * @param code Lua 源代码
 * @param options 执行选项（包含 rdfStore、vfs、workingDirectory 和 args）
 * @returns Lua 执行结果（包含返回值、输出和错误）
 */
export async function runLua(code: string, options: LuaRunOptions = {}): Promise<LuaExecutionResult> {
  const { args, ...restOptions } = options
  const instance = createLuaInstance(restOptions)
  try {
    return await instance.run(code, args)
  } finally {
    instance.destroy()
  }
}

/**
 * 设置 WASM glue 文件路径
 */
export function setGluePath(path: string) {
  if (moduleInstance) {
    throw new Error('Cannot change glue path after module is loaded')
  }
  gluePath = path
}

/**
 * 获取当前 glue 文件路径
 */
export function getGluePath() {
  return gluePath
}

/**
 * 获取默认 glue 文件路径
 */
export function getDefaultGluePath() {
  return DEFAULT_GLUE_PATH
}

/**
 * 检查 runner 是否已加载
 */
export function isRunnerLoaded() {
  return moduleInstance !== null
}

/**
 * 重置 runner 状态
 */
export function resetRunnerState() {
  moduleInstance = null
  modulePromise = null
  heapU8 = null
}

// ============= 持久 Lua 实例 API =============

/**
 * Lua 实例句柄
 */
export interface LuaInstance {
  /** 实例 ID */
  readonly id: number
  
  /** 
   * 运行 Lua 代码
   * @param code Lua 代码
   * @param args 可选的参数对象，会通过 JsProxy 传递给 Lua
   *             在 Lua 中可以直接访问参数，例如 args = {name: "test"} 
   *             在 Lua 代码中可以使用 name 变量
   */
  run(code: string, args?: Record<string, unknown>): Promise<LuaExecutionResult>
  
  /** 注册 JavaScript 模块供 Lua 调用 */
  registerJsModule(name: string, module: JsModuleDefinition): void
  
  /** 销毁实例 */
  destroy(): void
}

/**
 * Lua 实例创建选项
 */
export interface LuaInstanceOptions {
  /** RDF 存储实现（可选，如果 Lua 代码需要 RDF 功能） */
  rdfStore?: RDFStore
  /** 虚拟文件系统实例（可选，如果 Lua 代码需要文件系统功能） */
  vfs?: Vfs<VfsProvider>
  /** 工作目录（用于 require 相对路径解析），默认为 "/" */
  workingDirectory?: string
}

/**
 * 创建持久的 Lua 实例
 * 
 * @param options 实例选项（包含 rdfStore、vfs 和 workingDirectory）
 * @returns Lua 实例句柄
 */
export function createLuaInstance(options: LuaInstanceOptions = {}): LuaInstance {
  const module = ensureModule()
  const { rdfStore, vfs, workingDirectory = '/' } = options
  
  // 创建执行上下文 - 只在提供了 RDFStore 时才创建上下文
  // 如果没有提供 RDFStore，contextId 只用于 VFS
  let contextId: number
  if (rdfStore) {
    contextId = createRDFStoreContext(rdfStore)
  } else {
    // 生成一个新的 contextId 但不创建 RDF 上下文
    // 这样 Lua 代码尝试使用 State API 时会得到明确的错误
    contextId = Date.now() % 1000000
  }
  
  // 如果提供了 VFS，也创建上下文（使用相同的 contextId）
  if (vfs) {
    createVfsContextWithId(contextId, vfs)
  }
  
  // 编码工作目录
  const workingDirBytes = textEncoder.encode(workingDirectory)
  const workingDirPtr = module._malloc(workingDirBytes.length + 1)
  if (!heapU8) throw new Error('HEAPU8 not initialized')
  
  heapU8.set(workingDirBytes, workingDirPtr)
  heapU8[workingDirPtr + workingDirBytes.length] = 0
  
  // 创建实例
  const instanceId = module._lua_create_instance(contextId, workingDirPtr)
  module._free(workingDirPtr)
  
  if (instanceId < 0) {
    clearRDFStoreContext(contextId)
    if (vfs) clearVfsContext(contextId)
    throw new Error('Failed to create Lua instance')
  }
  
  let destroyed = false
  
  // 初始化该实例的模块注册表
  jsModuleRegistry.set(instanceId, new Map())
  
  return {
    id: instanceId,
    
    async run(code: string, args?: Record<string, unknown>): Promise<LuaExecutionResult> {
      if (destroyed) {
        throw new Error('Lua instance has been destroyed')
      }
      
      // 如果有 args，生成变量解包代码
      let finalCode = code
      if (args && Object.keys(args).length > 0) {
        const varNames = Object.keys(args)
        const unpackCode = `local ${varNames.join(', ')} = ${varNames.map(n => `__args__.${n}`).join(', ')}\n`
        finalCode = unpackCode + code
      }
      
      // 编码 Lua 代码
      const codeBytes = textEncoder.encode(finalCode)
      const codePtr = module._malloc(codeBytes.length + 1)
      if (!heapU8) throw new Error('HEAPU8 not initialized')
      
      heapU8.set(codeBytes, codePtr)
      heapU8[codePtr + codeBytes.length] = 0
      
      // 获取 args 的 EM_VAL handle（如果有的话）
      let argsHandle = 0
      if (args && Object.keys(args).length > 0) {
        // 使用 Emval API 将 JS 对象转换为 handle
        // @ts-ignore - Emval is available on the module
        argsHandle = module.Emval.toHandle(args)
      }
      
      // 在实例上执行代码
      const executionId = module._lua_run_on_instance_async(instanceId, codePtr, argsHandle)
      module._free(codePtr)
      
      if (executionId === 0) {
        throw new Error('Failed to start async Lua execution on instance')
      }
      
      // 返回 Promise，等待执行完成
      return new Promise((resolve, reject) => {
        luaExecutionCallbacks.set(executionId, { resolve, reject })
        
        // 手动 tick 一次，启动执行
        module._lua_executor_tick()
      })
    },
    
    registerJsModule(name: string, moduleDefinition: JsModuleDefinition): void {
      if (destroyed) {
        throw new Error('Lua instance has been destroyed')
      }
      
      // 存储模块定义
      const instanceModules = jsModuleRegistry.get(instanceId)!
      instanceModules.set(name, moduleDefinition)
      
      // 通知 Rust 层注册模块名
      const nameBytes = textEncoder.encode(name)
      const namePtr = module._malloc(nameBytes.length + 1)
      if (!heapU8) throw new Error('HEAPU8 not initialized')
      
      heapU8.set(nameBytes, namePtr)
      heapU8[namePtr + nameBytes.length] = 0
      
      module._lua_register_js_module(instanceId, namePtr)
      module._free(namePtr)
    },
    
    destroy() {
      if (destroyed) return
      
      // 清理模块注册表
      jsModuleRegistry.delete(instanceId)
      
      module._lua_destroy_instance(instanceId)
      clearRDFStoreContext(contextId)
      if (vfs) clearVfsContext(contextId)
      destroyed = true
    }
  }
}
