/**
 * 规范化从 Lua 返回的数据
 * 
 * Lua 中空数组和空对象都返回 {}，这会导致 JS 中调用数组方法时出错。
 * 此函数递归处理对象，为空对象 {} 添加数组方法，使其既是对象又是 ArrayLike。
 * 
 * @param data - 需要规范化的数据
 * @returns 规范化后的数据
 */
export function normalizeLuaData(data: any): any {
  // 跳过 null、undefined
  if (data === null || data === undefined) {
    return data
  }
  
  // 跳过基本类型
  if (typeof data !== 'object') {
    return data
  }
  
  // 如果已经是数组，递归处理每个元素
  if (Array.isArray(data)) {
    return data.map(item => normalizeLuaData(item))
  }
  
  // 获取对象的所有键（不包括 Symbol）
  const keys = Object.keys(data)
  
  // 如果是空对象 {}，将其转化为 ArrayLike 对象
  // 这样既保留对象能力（Object.keys、设置新字段），又支持数组方法
  if (keys.length === 0) {
    return makeArrayLike(data)
  }
  
  // 递归处理对象的每个属性
  const result: any = {}
  for (const key of keys) {
    // 跳过以 _ 开头的字段（内部字段，不做转换）
    if (key.startsWith('_')) {
      result[key] = data[key]
      continue
    }
    
    // 递归处理属性值
    result[key] = normalizeLuaData(data[key])
  }
  
  return result
}

/**
 * 反规范化数据，用于将数据发送回 Lua 之前
 * 
 * 将 ArrayLike 对象转换回普通数组或对象：
 * - 如果 ArrayLike 对象使用了 push 等数组操作（_usedAsArray 标记），转为真正的数组
 * - 如果 ArrayLike 对象仍然为空，转为空数组 []（因为原本就是空数组）
 * - 如果 ArrayLike 对象被添加了属性（当作对象用），保留为普通对象
 * 
 * @param data - 需要反规范化的数据
 * @returns 反规范化后的数据
 */
export function denormalizeLuaData(data: any): any {
  // 跳过 null、undefined
  if (data === null || data === undefined) {
    return data
  }
  
  // 跳过基本类型
  if (typeof data !== 'object') {
    return data
  }
  
  // 如果是真正的数组，递归处理每个元素
  if (Array.isArray(data)) {
    return data.map(item => denormalizeLuaData(item))
  }
  
  // 检查是否是我们的 ArrayLike 对象
  if (data._isLuaArrayLike) {
    const keys = Object.keys(data)
    
    // 如果被标记为数组使用（用了 push 等方法），或者仍然是空的，转为数组
    if (data._usedAsArray || keys.length === 0) {
      // 获取内部数组并递归处理
      const internalArray = data._getInternalArray ? data._getInternalArray() : []
      return internalArray.map((item: any) => denormalizeLuaData(item))
    }
    
    // 否则被当作对象使用了，转为普通对象
    const result: any = {}
    for (const key of keys) {
      result[key] = denormalizeLuaData(data[key])
    }
    return result
  }
  
  // 普通对象，递归处理
  const result: any = {}
  for (const key of Object.keys(data)) {
    // 跳过以 _ 开头的字段
    if (key.startsWith('_')) {
      result[key] = data[key]
      continue
    }
    result[key] = denormalizeLuaData(data[key])
  }
  
  return result
}

/**
 * 将空对象转化为 ArrayLike 对象
 * 添加不可枚举的数组方法，使其同时具备对象和数组的能力
 */
function makeArrayLike<T extends object>(obj: T): T & ArrayLikeMethods {
  // 内部数组存储（用于 push/pop 等操作）
  let internalArray: any[] = []
  let usedAsArray = false
  
  // 定义数组方法（不可枚举，不影响 Object.keys）
  const arrayMethods: PropertyDescriptorMap = {
    // length 属性 - getter，动态返回当前元素数量
    length: {
      get() {
        return internalArray.length
      },
      enumerable: false,
      configurable: true
    },
    
    // 标记是否被当作数组使用
    _usedAsArray: {
      get() {
        return usedAsArray
      },
      enumerable: false,
      configurable: true
    },
    
    // 标记这是一个 ArrayLike 对象（用于调试和识别）
    _isLuaArrayLike: {
      value: true,
      enumerable: false,
      configurable: true,
      writable: false
    },
    
    // ==================== 修改方法（会标记 usedAsArray）====================
    
    // push 方法
    push: {
      value: function(...items: any[]): number {
        usedAsArray = true
        return internalArray.push(...items)
      },
      enumerable: false,
      configurable: true,
      writable: true
    },
    
    // pop 方法
    pop: {
      value: function(): any {
        usedAsArray = true
        return internalArray.pop()
      },
      enumerable: false,
      configurable: true,
      writable: true
    },
    
    // shift 方法
    shift: {
      value: function(): any {
        usedAsArray = true
        return internalArray.shift()
      },
      enumerable: false,
      configurable: true,
      writable: true
    },
    
    // unshift 方法
    unshift: {
      value: function(...items: any[]): number {
        usedAsArray = true
        return internalArray.unshift(...items)
      },
      enumerable: false,
      configurable: true,
      writable: true
    },
    
    // splice 方法
    splice: {
      value: function(start: number, deleteCount?: number, ...items: any[]): any[] {
        usedAsArray = true
        if (arguments.length === 1) {
          return internalArray.splice(start)
        } else if (arguments.length === 2) {
          return internalArray.splice(start, deleteCount)
        }
        return internalArray.splice(start, deleteCount!, ...items)
      },
      enumerable: false,
      configurable: true,
      writable: true
    },
    
    // sort 方法
    sort: {
      value: function(compareFn?: (a: any, b: any) => number): any {
        usedAsArray = true
        internalArray.sort(compareFn)
        return this
      },
      enumerable: false,
      configurable: true,
      writable: true
    },
    
    // reverse 方法
    reverse: {
      value: function(): any {
        usedAsArray = true
        internalArray.reverse()
        return this
      },
      enumerable: false,
      configurable: true,
      writable: true
    },
    
    // fill 方法
    fill: {
      value: function(value: any, start?: number, end?: number): any {
        usedAsArray = true
        internalArray.fill(value, start, end)
        return this
      },
      enumerable: false,
      configurable: true,
      writable: true
    },
    
    // ==================== 只读方法 ====================
    
    // forEach 方法
    forEach: {
      value: function<U>(callback: (item: U, index: number, array: U[]) => void, thisArg?: any) {
        internalArray.forEach((item, index) => callback.call(thisArg, item as U, index, internalArray as U[]))
      },
      enumerable: false,
      configurable: true,
      writable: true
    },
    
    // map 方法
    map: {
      value: function<U, V>(callback: (item: U, index: number, array: U[]) => V, thisArg?: any): V[] {
        return internalArray.map((item, index) => callback.call(thisArg, item as U, index, internalArray as U[]))
      },
      enumerable: false,
      configurable: true,
      writable: true
    },
    
    // filter 方法
    filter: {
      value: function<U>(callback: (item: U, index: number, array: U[]) => boolean, thisArg?: any): U[] {
        return internalArray.filter((item, index) => callback.call(thisArg, item as U, index, internalArray as U[])) as U[]
      },
      enumerable: false,
      configurable: true,
      writable: true
    },
    
    // find 方法
    find: {
      value: function<U>(callback: (item: U, index: number, array: U[]) => boolean, thisArg?: any): U | undefined {
        return internalArray.find((item, index) => callback.call(thisArg, item as U, index, internalArray as U[])) as U | undefined
      },
      enumerable: false,
      configurable: true,
      writable: true
    },
    
    // findIndex 方法
    findIndex: {
      value: function<U>(callback: (item: U, index: number, array: U[]) => boolean, thisArg?: any): number {
        return internalArray.findIndex((item, index) => callback.call(thisArg, item as U, index, internalArray as U[]))
      },
      enumerable: false,
      configurable: true,
      writable: true
    },
    
    // some 方法
    some: {
      value: function<U>(callback: (item: U, index: number, array: U[]) => boolean, thisArg?: any): boolean {
        return internalArray.some((item, index) => callback.call(thisArg, item as U, index, internalArray as U[]))
      },
      enumerable: false,
      configurable: true,
      writable: true
    },
    
    // every 方法
    every: {
      value: function<U>(callback: (item: U, index: number, array: U[]) => boolean, thisArg?: any): boolean {
        return internalArray.every((item, index) => callback.call(thisArg, item as U, index, internalArray as U[]))
      },
      enumerable: false,
      configurable: true,
      writable: true
    },
    
    // reduce 方法
    reduce: {
      value: function(callback: (acc: any, item: any, index: number, array: any[]) => any, initialValue?: any): any {
        if (arguments.length >= 2) {
          return internalArray.reduce((acc, item, index) => callback(acc, item, index, internalArray), initialValue)
        }
        return internalArray.reduce((acc, item, index) => callback(acc, item, index, internalArray))
      },
      enumerable: false,
      configurable: true,
      writable: true
    },
    
    // includes 方法
    includes: {
      value: function<U>(searchElement: U, fromIndex?: number): boolean {
        return internalArray.includes(searchElement, fromIndex)
      },
      enumerable: false,
      configurable: true,
      writable: true
    },
    
    // indexOf 方法
    indexOf: {
      value: function<U>(searchElement: U, fromIndex?: number): number {
        return internalArray.indexOf(searchElement, fromIndex)
      },
      enumerable: false,
      configurable: true,
      writable: true
    },
    
    // lastIndexOf 方法
    lastIndexOf: {
      value: function<U>(searchElement: U, fromIndex?: number): number {
        if (arguments.length >= 2) {
          return internalArray.lastIndexOf(searchElement, fromIndex)
        }
        return internalArray.lastIndexOf(searchElement)
      },
      enumerable: false,
      configurable: true,
      writable: true
    },
    
    // slice 方法
    slice: {
      value: function(start?: number, end?: number): any[] {
        return internalArray.slice(start, end)
      },
      enumerable: false,
      configurable: true,
      writable: true
    },
    
    // concat 方法
    concat: {
      value: function(...items: any[]): any[] {
        return internalArray.concat(...items)
      },
      enumerable: false,
      configurable: true,
      writable: true
    },
    
    // join 方法
    join: {
      value: function(separator?: string): string {
        return internalArray.join(separator)
      },
      enumerable: false,
      configurable: true,
      writable: true
    },
    
    // flat 方法
    flat: {
      value: function(depth?: number): any[] {
        return internalArray.flat(depth)
      },
      enumerable: false,
      configurable: true,
      writable: true
    },
    
    // flatMap 方法
    flatMap: {
      value: function<U, V>(callback: (item: U, index: number, array: U[]) => V | V[], thisArg?: any): V[] {
        return internalArray.flatMap((item, index) => callback.call(thisArg, item as U, index, internalArray as U[]))
      },
      enumerable: false,
      configurable: true,
      writable: true
    },
    
    // 获取内部数组（用于 denormalize）
    _getInternalArray: {
      value: function(): any[] {
        return internalArray
      },
      enumerable: false,
      configurable: true,
      writable: false
    },
    
    // 支持 for...of 迭代
    [Symbol.iterator]: {
      value: function* () {
        yield* internalArray
      },
      enumerable: false,
      configurable: true,
      writable: true
    }
  }
  
  Object.defineProperties(obj, arrayMethods)
  
  return obj as T & ArrayLikeMethods
}

/**
 * ArrayLike 方法的类型定义
 */
interface ArrayLikeMethods {
  readonly length: number
  readonly _usedAsArray: boolean
  readonly _isLuaArrayLike: true
  _getInternalArray(): any[]
  
  // 修改方法
  push(...items: any[]): number
  pop(): any
  shift(): any
  unshift(...items: any[]): number
  splice(start: number, deleteCount?: number, ...items: any[]): any[]
  sort(compareFn?: (a: any, b: any) => number): this
  reverse(): this
  fill(value: any, start?: number, end?: number): this
  
  // 只读方法
  forEach<U>(callback: (item: U, index: number, array: U[]) => void, thisArg?: any): void
  map<U, V>(callback: (item: U, index: number, array: U[]) => V, thisArg?: any): V[]
  filter<U>(callback: (item: U, index: number, array: U[]) => boolean, thisArg?: any): U[]
  find<U>(callback: (item: U, index: number, array: U[]) => boolean, thisArg?: any): U | undefined
  findIndex<U>(callback: (item: U, index: number, array: U[]) => boolean, thisArg?: any): number
  some<U>(callback: (item: U, index: number, array: U[]) => boolean, thisArg?: any): boolean
  every<U>(callback: (item: U, index: number, array: U[]) => boolean, thisArg?: any): boolean
  reduce<T>(callback: (acc: T, item: T, index: number, array: T[]) => T): T
  reduce<T, U>(callback: (acc: U, item: T, index: number, array: T[]) => U, initialValue: U): U
  includes<U>(searchElement: U, fromIndex?: number): boolean
  indexOf<U>(searchElement: U, fromIndex?: number): number
  lastIndexOf<U>(searchElement: U, fromIndex?: number): number
  slice(start?: number, end?: number): any[]
  concat(...items: any[]): any[]
  join(separator?: string): string
  flat(depth?: number): any[]
  flatMap<U, V>(callback: (item: U, index: number, array: U[]) => V | V[], thisArg?: any): V[]
  
  // 迭代器
  [Symbol.iterator](): IterableIterator<any>
}
