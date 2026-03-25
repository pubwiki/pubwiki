# pubwiki-lua

本项目的后端文件夹(lua) 运行时会自动加载init.lua，并提供以下内部特性：

#### RDF Store Interface

Implement the `RDFStore` interface for custom storage backends (all methods are async):

```typescript
interface RDFStore {
  insert(subject: string, predicate: string, object: any): Promise<void>
  delete(subject: string, predicate: string, object?: any): Promise<void>
  query(pattern: {
    subject?: string
    predicate?: string
    object?: any
  }): Promise<Array<{ subject: string; predicate: string; object: any }>>
  batchInsert?(triples: Array<{ subject: string; predicate: string; object: any }>): Promise<void>
}
```

Example implementation with Quadstore:

```typescript
class QuadstoreRDFStore implements RDFStore {
  private store: Quadstore

  static async create(): Promise<QuadstoreRDFStore> {
    const backend = new BrowserLevel('my-db')
    const store = new Quadstore({ backend, dataFactory: DataFactory })
    await store.open()
    return new QuadstoreRDFStore(store)
  }

  async insert(subject: string, predicate: string, object: any): Promise<void> {
    const quad = this.createQuad(subject, predicate, object)
    await this.store.put(quad)
  }

  async delete(subject: string, predicate: string, object?: any): Promise<void> {
    const pattern = this.createPattern(subject, predicate, object)
    const { items } = await this.store.get(pattern)
    if (items.length > 0) {
      await this.store.multiDel(items)
    }
  }

  async query(pattern: TriplePattern): Promise<Triple[]> {
    const queryPattern = this.createPattern(pattern.subject, pattern.predicate, pattern.object)
    const { items } = await this.store.get(queryPattern)
    return items.map(quad => this.quadToTriple(quad))
  }
}
```

#### File System Interface

Implement the `FileSystem` interface for custom file storage (all async except `exists`):

```typescript
interface FileSystem {
  readFile(path: string): Promise<string | Uint8Array>
  writeFile(path: string, content: string | Uint8Array): Promise<void>
  deleteFile(path: string): Promise<void>
  exists(path: string): Promise<boolean>
  mkdir(path: string): Promise<void>
  rmdir(path: string): Promise<void>
}
```

Example setup with file system:

```typescript
import { loadRunner, runLua, setFileSystem } from 'pubwiki-lua'
import { OPFSFileSystem } from './OPFSFileSystem'

await loadRunner()

// Register file system
const fs = new OPFSFileSystem()
await fs.initialize()
setFileSystem(fs)

// Now Lua can use fs.* functions
await runLua(`
  fs.write('/test.txt', 'Hello World')
  local content = fs.read('/test.txt')
  print(content)
`, store)
```

#### Context Management

The library automatically manages execution contexts to prevent race conditions:

```typescript
// Multiple concurrent executions are safe - each has isolated RDF store
const store1 = await QuadstoreRDFStore.create()
const store2 = await QuadstoreRDFStore.create()

const [result1, result2] = await Promise.all([
  runLua('State.insert("a", "b", "c") return "done1"', store1),
  runLua('State.insert("x", "y", "z") return "done2"', store2)
])
```

#### Module Loading

Upload modules for `require()`:

```typescript
import { uploadFileModule } from 'pubwiki-lua'

// Upload a module
uploadFileModule('file://mymodule.lua', `
  local M = {}
  function M.hello() return "Hello!" end
  return M
`)

// Use in Lua
await runLua(`
  local mymodule = require('file://mymodule.lua')
  print(mymodule.hello())
`, store)
```

### Lua API

#### RDF Triple Store (State API)

All RDF operations in Lua are **asynchronous** and automatically awaited:

```lua
-- Insert a triple (async)
State.insert(subject, predicate, object)

-- Batch insert multiple triples at once (async)
State.batchInsert({
  {subject = 'book:1984', predicate = 'title', object = '1984'},
  {subject = 'book:1984', predicate = 'author', object = 'George Orwell'},
  {subject = 'book:1984', predicate = 'year', object = 1949}
})

-- Delete triples (async)
State.delete(subject, predicate)           -- Delete all with subject+predicate
State.delete(subject, predicate, object)   -- Delete specific triple

-- Set (delete then insert - async)
State.set(subject, predicate, object)  -- Replaces all values for subject+predicate

-- Query triples with pattern matching (async)
local results = State.query({
  subject = 'book:1984',      -- Optional
  predicate = 'author',       -- Optional
  object = 'George Orwell'    -- Optional
})

-- Results is an array of triples:
for i, triple in ipairs(results) do
  print(triple.subject, triple.predicate, triple.object)
end

-- Get single value (async)
local title = State.get('book:1984', 'title')  -- Returns the object value
```

#### Working with Async Operations

All State operations are async, but Lua code looks synchronous:

```lua
-- These all work seamlessly
State.insert('user:alice', 'name', 'Alice')
State.insert('user:alice', 'age', 30)

local users = State.query({predicate = 'name'})
print('Found ' .. #users .. ' users')

-- Even in loops
for i = 1, 10 do
  State.insert('item:' .. i, 'value', i * 10)
end

local items = State.query({predicate = 'value'})
for _, item in ipairs(items) do
  print(item.subject, item.object)
end
```

#### File System API

All file system operations are **asynchronous**:

```lua
-- Write file (async)
fs.write(path, content)

-- Read file (async)
local content = fs.read(path)
print(content)

-- Check if file exists (async)
if fs.exists(path) then
  print("File exists")
end

-- Delete file (async)
fs.unlink(path)

-- Create directory (async)
fs.mkdir(path)

-- Remove directory (async)
fs.rmdir(path)

-- Example: Read, modify, write
local data = fs.read('/config.json')
local config = require('json').decode(data)
config.version = config.version + 1
fs.write('/config.json', require('json').encode(config))
```

#### Standard Lua Libraries

All standard Lua 5.4 libraries are available:
Note: all string inner method are ``regex pattern`` not ``lua pattern``

```lua
-- String manipulation
local upper = string.upper("hello")

-- Table operations
table.insert(t, value)
table.sort(t)

-- Math functions
local result = math.sqrt(16)

-- OS functions (limited in browser)
local time = os.time()
local date = os.date("%Y-%m-%d")
```

本项目的lua 运行时还注入了以下文件作为模块：

#### service.lua
-- service.lua
-- Service System - 服务定义与调用
--
-- 核心理念:
--   - ServiceRegistry:define() / ServiceRegistry:definePure() - 定义并注册服务
--   - ServiceRegistry.call() - 统一的服务调用入口
--   - namespace: 服务命名空间（避免命名冲突）
--
-- 服务类型:
--   - ACTION (默认): 有副作用的服务
--   - PURE: 纯计算，无副作用

local Type = require("core/types")

----------------------------------------------------------------
-- ServiceRegistry
----------------------------------------------------------------

local ServiceRegistry = {
    _services = {},  -- identifier -> service spec
    Type = Type,     -- 导出 Type 供外部使用
}

----------------------------------------------------------------
-- ServiceBuilder - 链式构建器
----------------------------------------------------------------

local function createBuilder(registry, kind)
    local builder = {
        _registry = registry,
        _kind = kind,
        _inputs = {},
        _outputs = {},
    }
    
    function builder:namespace(ns)
        self._namespace = ns
        return self
    end
    
    function builder:name(n)
        self._name = n
        return self
    end
    
    function builder:desc(description)
        self._description = description
        return self
    end
    
    function builder:inputs(typeOrObject)
        assert(Type.isType(typeOrObject), "inputs must be a Type")
        self._inputs = typeOrObject
        return self
    end
    
    function builder:outputs(typeOrObject)
        assert(Type.isType(typeOrObject), "outputs must be a Type")
        self._outputs = typeOrObject
        return self
    end
    
    function builder:staticData(data)
        self._staticData = data
        return self
    end
    
    function builder:usage(usageText)
        self._usage = usageText
        return self
    end

    function builder:impl(fn)
        self._impl = fn
        -- impl 是最后一步，自动注册
        return self:_register()
    end
    
    function builder:_register()
        assert(self._name, "Service must have a name")
        assert(self._namespace, "Service must have a namespace")
        assert(self._impl, "Service must have an impl")
        
        local name = self._name
        local namespace = self._namespace
        local identifier = namespace .. ":" .. name
        
        -- 克隆 inputs/outputs Type（如果存在）
        local inputs = self._inputs and Type.clone(self._inputs) or Type.Nil
        local outputs = self._outputs and Type.clone(self._outputs) or Type.Nil
        
        local spec = {
            name = name,
            namespace = namespace,
            identifier = identifier,
            kind = self._kind,
            description = self._description,
            inputs = inputs,
            usage = self._usage,
            outputs = outputs,
            staticData = self._staticData,
            impl = self._impl,
        }
        
        if self._registry._services[identifier] then
            error("Service already exists: " .. identifier)
        end
        
        self._registry._services[identifier] = spec
        return spec
    end
    
    return builder
end

----------------------------------------------------------------
-- ServiceRegistry:define() / ServiceRegistry:definePure()
----------------------------------------------------------------

-- 定义 ACTION 服务（默认，有副作用）
function ServiceRegistry:define()
    return createBuilder(self, "ACTION")
end

-- 定义 PURE 服务（纯计算，无副作用）
function ServiceRegistry:definePure()
    return createBuilder(self, "PURE")
end

----------------------------------------------------------------
-- 服务查询
----------------------------------------------------------------

function ServiceRegistry.get(identifier)
    return ServiceRegistry._services[identifier]
end

function ServiceRegistry.has(identifier)
    return ServiceRegistry._services[identifier] ~= nil
end

function ServiceRegistry.unregister(identifier)
    ServiceRegistry._services[identifier] = nil
end

function ServiceRegistry.isPure(identifier)
    local spec = ServiceRegistry.get(identifier)
    return spec and spec.kind == "PURE"
end

function ServiceRegistry.isAction(identifier)
    local spec = ServiceRegistry.get(identifier)
    return spec and spec.kind == "ACTION"
end

function ServiceRegistry.listServices()
    local services = {}
    for identifier in pairs(ServiceRegistry._services) do
        table.insert(services, identifier)
    end
    table.sort(services)
    return services
end

function ServiceRegistry.listByNamespace(namespace)
    local services = {}
    for identifier, spec in pairs(ServiceRegistry._services) do
        if spec.namespace == namespace then
            table.insert(services, identifier)
        end
    end
    table.sort(services)
    return services
end

function ServiceRegistry.getNamespaces()
    local nsSet = {}
    for _, spec in pairs(ServiceRegistry._services) do
        nsSet[spec.namespace] = true
    end
    local namespaces = {}
    for ns in pairs(nsSet) do
        table.insert(namespaces, ns)
    end
    table.sort(namespaces)
    return namespaces
end

----------------------------------------------------------------
-- 服务执行
----------------------------------------------------------------

--[[
  ServiceRegistry.call() / ServiceRegistry.execute()
  
  参数:
    identifier: string - 服务标识符 (namespace:name)
    inputs: table - 输入值，结构需符合服务定义的 inputs Type
  
  返回值: table - impl 函数的返回值
    若失败返回 { _error = "错误信息" }
  
  impl 函数接口:
    function(self, inputs)
      local a = inputs.a           -- 读取输入
      local x = self.someData      -- 访问 staticData
      return { result = a + x }    -- 返回输出
    end
]]
function ServiceRegistry.execute(identifier, inputs)
    local spec = ServiceRegistry.get(identifier)
    if not spec then
        return { _error = "Service not found: " .. tostring(identifier) }
    end
    
    -- 使用 staticData 作为 self，通过冒号语法调用 impl
    local status, result
    if spec.staticData ~= nil then
        status, result = pcall(spec.impl, spec.staticData, inputs)
    else
        status, result = pcall(spec.impl, inputs)
    end
    
    if not status then
        return { _error = tostring(result) }
    end
    
    return result
end

-- 别名
ServiceRegistry.call = ServiceRegistry.execute

----------------------------------------------------------------
-- 序列化导出
----------------------------------------------------------------

local function serializeService(spec)
    return {
        name = spec.name,
        namespace = spec.namespace,
        identifier = spec.identifier,
        kind = spec.kind,
        description = spec.description,
        inputs = Type.serialize(spec.inputs),
        outputs = Type.serialize(spec.outputs),
        staticData = spec.staticData,
    }
end

-- 导出所有服务
function ServiceRegistry.export()
    local result = {}
    for identifier, spec in pairs(ServiceRegistry._services) do
        result[identifier] = serializeService(spec)
    end
    return result
end

-- 按 kind 分组导出
function ServiceRegistry.exportByKind()
    local byKind = { PURE = {}, ACTION = {} }
    for identifier, spec in pairs(ServiceRegistry._services) do
        byKind[spec.kind][identifier] = serializeService(spec)
    end
    return byKind
end

-- 按 namespace 分组导出
function ServiceRegistry.exportByNamespace()
    local result = {}
    for identifier, spec in pairs(ServiceRegistry._services) do
        local ns = spec.namespace
        if not result[ns] then
            result[ns] = {}
        end
        result[ns][spec.name] = serializeService(spec)
    end
    return result
end

-- 完整导出
function ServiceRegistry.exportDetailed()
    return {
        services = ServiceRegistry.export(),
        byKind = ServiceRegistry.exportByKind(),
        byNamespace = ServiceRegistry.exportByNamespace(),
    }
end

-- 导出指定命名空间的服务文档（人类可读）
-- 返回: Array<{ name: string, doc: string }>
function ServiceRegistry.exportDocByNamespace(namespace)
    local services = {}
    for identifier, spec in pairs(ServiceRegistry._services) do
        if spec.namespace == namespace then
            table.insert(services, spec)
        end
    end
    
    if #services == 0 then
        return {}
    end
    
    -- 按名称排序
    table.sort(services, function(a, b)
        return a.name < b.name
    end)
    
    local result = {}
    
    for _, spec in ipairs(services) do
        local lines = {}
        
        table.insert(lines, "## " .. spec.identifier)
        table.insert(lines, "")
        
        -- 服务类型
        table.insert(lines, "**Type**: " .. spec.kind)
        table.insert(lines, "")
        
        -- 描述
        if spec.description then
            table.insert(lines, "**Description**: " .. spec.description)
            table.insert(lines, "")
        end
        
        -- 使用方式
        if spec.usage then
            table.insert(lines, "**Usage**:")
            table.insert(lines, "```lua")
            table.insert(lines, spec.usage)
            table.insert(lines, "```")
            table.insert(lines, "")
        end
        
        -- 输入参数
        table.insert(lines, "**Inputs**:")
        table.insert(lines, "```")
        table.insert(lines, Type.format(spec.inputs, 0, true))
        table.insert(lines, "```")
        table.insert(lines, "")
        
        -- 输出参数
        table.insert(lines, "**Outputs**:")
        table.insert(lines, "```")
        table.insert(lines, Type.format(spec.outputs, 0, true))
        table.insert(lines, "```")
        table.insert(lines, "")
        
        -- 静态数据（如果有）
        if spec.staticData and next(spec.staticData) ~= nil then
            table.insert(lines, "**Static Data**: Available")
            table.insert(lines, "")
        end
        
        table.insert(result, {
            name = spec.identifier,
            doc = table.concat(lines, "\n")
        })
    end
    
    return result
end

----------------------------------------------------------------
-- 清空（用于测试）
----------------------------------------------------------------

function ServiceRegistry.clear()
    ServiceRegistry._services = {}
end


Service = ServiceRegistry  -- 全局别名
ServiceRegistry = ServiceRegistry  -- 全局别名

return ServiceRegistry

#### types.lua
-- types.lua
-- 类型系统 - 扁平 Metatable 设计
--
-- 核心：
--   - Type 是所有类型对象的 metatable
--   - 类型信息直接存在类型对象本身（kind, fields 等）
--   - 乘法 = 合并字段到新表

local Type = {}
Type.__index = Type

----------------------------------------------------------------
-- 创建类型对象
----------------------------------------------------------------

local function new_type(kind, data)
    data = data or {}
    if (data.kind ~= nil) then
        error("The field `kind` is reserved")
    end

    data.kind = kind
    return setmetatable(data, Type)
end

----------------------------------------------------------------
-- Type.isType
----------------------------------------------------------------

function Type.isType(v)
    return getmetatable(v) == Type
end

----------------------------------------------------------------
-- 基础类型（单例）
----------------------------------------------------------------

Type.String = new_type("string")
Type.Bool   = new_type("bool")
Type.Int    = new_type("int")
Type.Float  = new_type("float")
Type.Any    = new_type("any")
Type.Nil    = new_type("nil")
Type.Void   = new_type("void")

----------------------------------------------------------------
-- 复合类型
----------------------------------------------------------------

function Type.Optional(inner)
    assert(Type.isType(inner), "Optional requires a Type")
    return new_type("optional", { inner = inner })
end

Type.optional = setmetatable({}, {
    __index = function(_, key)
        local baseType = Type[key]
        if Type.isType(baseType) then
            return Type.Optional(baseType)
        end
    end
})

function Type.Array(inner)
    assert(Type.isType(inner), "Array requires a Type")
    return new_type("array", { inner = inner })
end

function Type.Object(fields)
    fields = fields or {}
    for k, v in pairs(fields) do
        assert(Type.isType(v), "Object field '" .. tostring(k) .. "' must be a Type")
    end
    return new_type("object", { fields = fields })
end

function Type.Function(opts)
    opts = opts or {}
    return new_type("function", { params = opts.params or {}, returns = opts.returns })
end

function Type.Record(valueType)
    assert(Type.isType(valueType), "Record requires a Type for value")
    return new_type("record", { valueType = valueType })
end

----------------------------------------------------------------
-- 类型代数
----------------------------------------------------------------

function Type.Or(...)
    local types = {...}
    assert(#types >= 2, "Type.Or requires at least 2 types")
    for i, t in ipairs(types) do
        assert(Type.isType(t), "Type.Or argument " .. i .. " must be a Type")
    end
    return new_type("or", { types = types })
end

function Type.And(...)
    local types = {...}
    assert(#types >= 2, "Type.And requires at least 2 types")
    local merged = {}
    for _, t in ipairs(types) do
        assert(Type.isType(t) and t.kind == "object", "Type.And only works with Object")
        for k, v in pairs(t.fields or {}) do
            merged[k] = v
        end
    end
    return Type.Object(merged)
end

----------------------------------------------------------------
-- 链式方法
----------------------------------------------------------------

function Type:desc(description)
    -- 克隆当前类型，避免污染单例
    local clone = Type.clone(self)
    clone._desc = description
    return clone
end

function Type:extend(fields)
    assert(self.kind == "object", "extend only works with Object")
    local merged = {}
    for k, v in pairs(self.fields or {}) do merged[k] = v end
    for k, v in pairs(fields or {}) do merged[k] = v end
    return Type.Object(merged)
end

----------------------------------------------------------------
-- 类型操作
----------------------------------------------------------------

function Type.is(value, T)
    return Type._check(value, T)
end

function Type.assert(value, T, message)
    if not Type.is(value, T) then
        error(message or ("Type assertion failed: expected " .. Type.format(T)), 2)
    end
    return value
end

function Type.instantiate(T, value)
    local ok, err = Type._checkWithError(value, T)
    if not ok then return nil, err end
    return value
end

----------------------------------------------------------------
-- 类型工具
----------------------------------------------------------------

function Type.partial(T)
    assert(T.kind == "object", "partial requires Object")
    local newFields = {}
    for k, v in pairs(T.fields or {}) do
        newFields[k] = Type.Optional(v)
    end
    return Type.Object(newFields)
end

function Type.required(T)
    assert(T.kind == "object", "required requires Object")
    local newFields = {}
    for k, v in pairs(T.fields or {}) do
        newFields[k] = (v.kind == "optional") and v.inner or v
    end
    return Type.Object(newFields)
end

function Type.pick(T, keys)
    assert(T.kind == "object", "pick requires Object")
    local keySet = {}
    for _, k in ipairs(keys) do keySet[k] = true end
    local newFields = {}
    for k, v in pairs(T.fields or {}) do
        if keySet[k] then newFields[k] = v end
    end
    return Type.Object(newFields)
end

function Type.omit(T, keys)
    assert(T.kind == "object", "omit requires Object")
    local keySet = {}
    for _, k in ipairs(keys) do keySet[k] = true end
    local newFields = {}
    for k, v in pairs(T.fields or {}) do
        if not keySet[k] then newFields[k] = v end
    end
    return Type.Object(newFields)
end

function Type.keyof(T)
    assert(T.kind == "object", "keyof requires Object")
    local keys = {}
    for k in pairs(T.fields or {}) do table.insert(keys, k) end
    table.sort(keys)
    return keys
end

----------------------------------------------------------------
-- Type.equals
----------------------------------------------------------------

function Type.equals(a, b)
    if not Type.isType(a) or not Type.isType(b) then return false end
    if a.kind ~= b.kind then return false end
    
    local kind = a.kind
    
    if kind == "string" or kind == "bool" or kind == "int" or
       kind == "float" or kind == "any" or kind == "nil" or kind == "void" then
        return true
    end
    
    if kind == "optional" or kind == "array" then
        return Type.equals(a.inner, b.inner)
    end
    
    if kind == "record" then
        return Type.equals(a.valueType, b.valueType)
    end
    
    if kind == "object" then
        local af, bf = a.fields or {}, b.fields or {}
        local ac, bc = 0, 0
        for _ in pairs(af) do ac = ac + 1 end
        for _ in pairs(bf) do bc = bc + 1 end
        if ac ~= bc then return false end
        for k, v in pairs(af) do
            if not Type.equals(v, bf[k]) then return false end
        end
        return true
    end
    
    if kind == "or" then
        if #a.types ~= #b.types then return false end
        for i, t in ipairs(a.types) do
            if not Type.equals(t, b.types[i]) then return false end
        end
        return true
    end
    
    if kind == "function" then
        if (a.returns ~= nil) ~= (b.returns ~= nil) then return false end
        if a.returns and not Type.equals(a.returns, b.returns) then return false end
        local ap, bp = a.params or {}, b.params or {}
        local ac, bc = 0, 0
        for _ in pairs(ap) do ac = ac + 1 end
        for _ in pairs(bp) do bc = bc + 1 end
        if ac ~= bc then return false end
        for k, v in pairs(ap) do
            if not Type.equals(v, bp[k]) then return false end
        end
        return true
    end
    
    return false
end

----------------------------------------------------------------
-- Type._check
----------------------------------------------------------------

function Type._check(value, T)
    local kind = T.kind
    
    if kind == "any" then return true end
    if kind == "nil" or kind == "void" then return value == nil end
    if kind == "string" then return type(value) == "string" end
    if kind == "bool" then return type(value) == "boolean" end
    if kind == "int" then return type(value) == "number" and math.floor(value) == value end
    if kind == "float" then return type(value) == "number" end
    if kind == "function" then return type(value) == "function" end
    
    if kind == "optional" then
        return value == nil or Type._check(value, T.inner)
    end
    
    if kind == "array" then
        if type(value) ~= "table" then return false end
        for _, v in ipairs(value) do
            if not Type._check(v, T.inner) then return false end
        end
        return true
    end
    
    if kind == "record" then
        if type(value) ~= "table" then return false end
        for k, v in pairs(value) do
            if type(k) ~= "string" then return false end
            if not Type._check(v, T.valueType) then return false end
        end
        return true
    end
    
    if kind == "object" then
        if type(value) ~= "table" then return false end
        for k, fieldType in pairs(T.fields or {}) do
            if not Type._check(value[k], fieldType) then return false end
        end
        return true
    end
    
    if kind == "or" then
        for _, t in ipairs(T.types) do
            if Type._check(value, t) then return true end
        end
        return false
    end
    
    return true
end

function Type._checkWithError(value, T, path)
    path = path or ""
    local kind = T.kind
    
    if kind == "any" then return true end
    if kind == "nil" or kind == "void" then
        if value ~= nil then return false, path .. ": expected nil" end
        return true
    end
    if kind == "string" then
        if type(value) ~= "string" then return false, path .. ": expected String" end
        return true
    end
    if kind == "bool" then
        if type(value) ~= "boolean" then return false, path .. ": expected Bool" end
        return true
    end
    if kind == "int" then
        if type(value) ~= "number" or math.floor(value) ~= value then
            return false, path .. ": expected Int"
        end
        return true
    end
    if kind == "float" then
        if type(value) ~= "number" then return false, path .. ": expected Float" end
        return true
    end
    if kind == "function" then
        if type(value) ~= "function" then return false, path .. ": expected Function" end
        return true
    end
    if kind == "optional" then
        if value == nil then return true end
        return Type._checkWithError(value, T.inner, path)
    end
    if kind == "array" then
        if type(value) ~= "table" then return false, path .. ": expected Array" end
        for i, v in ipairs(value) do
            local ok, err = Type._checkWithError(v, T.inner, path .. "[" .. i .. "]")
            if not ok then return false, err end
        end
        return true
    end
    if kind == "record" then
        if type(value) ~= "table" then return false, path .. ": expected Record" end
        for k, v in pairs(value) do
            if type(k) ~= "string" then return false, path .. ": record key must be string" end
            local ok, err = Type._checkWithError(v, T.valueType, path .. "[\"" .. k .. "\"]")
            if not ok then return false, err end
        end
        return true
    end
    if kind == "object" then
        if type(value) ~= "table" then return false, path .. ": expected Object" end
        for k, fieldType in pairs(T.fields or {}) do
            local fieldPath = path == "" and k or (path .. "." .. k)
            local ok, err = Type._checkWithError(value[k], fieldType, fieldPath)
            if not ok then return false, err end
        end
        return true
    end
    if kind == "or" then
        for _, t in ipairs(T.types) do
            if Type._check(value, t) then return true end
        end
        return false, path .. ": value does not match union"
    end
    return true
end

----------------------------------------------------------------
-- 序列化 / 反序列化 (JSON Schema 格式)
----------------------------------------------------------------

--[[
  Type.serialize(T) -> JSON Schema
  
  将 Type 对象序列化为标准 JSON Schema 格式
  
  映射规则:
    Type.String   -> { type = "string" }
    Type.Int      -> { type = "integer" }
    Type.Float    -> { type = "number" }
    Type.Bool     -> { type = "boolean" }
    Type.Nil      -> { type = "null" }
    Type.Any      -> {} (无约束)
    Type.Void     -> { type = "null" }
    Type.Optional(T) -> oneOf: [T, { type = "null" }]
    Type.Array(T) -> { type = "array", items = T }
    Type.Object({...}) -> { type = "object", properties = {...}, required = [...] }
    Type.Record(T) -> { type = "object", additionalProperties = T }
    Type.Or(A, B) -> { oneOf = [A, B] }
    Type.Function -> { type = "object", x-function = true }
]]
function Type.serialize(T, includeDesc)
    if not Type.isType(T) then return nil end
    
    includeDesc = includeDesc == nil and true or includeDesc
    local kind = T.kind
    local result = {}
    
    -- 添加描述
    if includeDesc and T._desc then 
        result.description = T._desc 
    end
    
    -- 基础类型映射
    if kind == "string" then
        result.type = "string"
    elseif kind == "int" then
        result.type = "integer"
    elseif kind == "float" then
        result.type = "number"
    elseif kind == "bool" then
        result.type = "boolean"
    elseif kind == "nil" or kind == "void" then
        result.type = "null"
    elseif kind == "any" then
        -- Any 类型不添加约束，空 schema 接受任何值
        -- result 保持为空或只有 description
    elseif kind == "optional" then
        -- Optional<T> = T | null
        local innerSchema = Type.serialize(T.inner, includeDesc)
        result.oneOf = {
            innerSchema,
            { type = "null" }
        }
    elseif kind == "array" then
        result.type = "array"
        result.items = Type.serialize(T.inner, includeDesc)
    elseif kind == "record" then
        result.type = "object"
        result.additionalProperties = Type.serialize(T.valueType, includeDesc)
    elseif kind == "object" then
        result.type = "object"
        result.properties = {}
        result.required = {}
        
        for k, v in pairs(T.fields or {}) do
            result.properties[k] = Type.serialize(v, includeDesc)
            -- 非 Optional 字段为必填
            if v.kind ~= "optional" then
                table.insert(result.required, k)
            end
        end
        
        -- 排序 required 数组保证稳定输出
        table.sort(result.required)
        
        -- 如果没有必填字段，移除 required
        if #result.required == 0 then
            result.required = nil
        end
        
        result.additionalProperties = false
    elseif kind == "or" then
        result.oneOf = {}
        for _, t in ipairs(T.types) do
            table.insert(result.oneOf, Type.serialize(t, includeDesc))
        end
    elseif kind == "function" then
        -- Function 类型使用扩展标记
        result.type = "object"
        result["x-function"] = true
        if T.params then
            result["x-params"] = {}
            for k, v in pairs(T.params) do
                result["x-params"][k] = Type.serialize(v, includeDesc)
            end
        end
        if T.returns then
            result["x-returns"] = Type.serialize(T.returns, includeDesc)
        end
    end
    
    return result
end

--[[
  Type.deserialize(schema) -> Type
  
  从 JSON Schema 反序列化为 Type 对象
]]
function Type.deserialize(schema)
    if not schema or type(schema) ~= "table" then return nil end
    
    local result
    local schemaType = schema.type
    
    -- 处理 oneOf (Or 或 Optional)
    if schema.oneOf then
        local types = {}
        local hasNull = false
        local nonNullType = nil
        
        for _, subSchema in ipairs(schema.oneOf) do
            if subSchema.type == "null" then
                hasNull = true
            else
                local t = Type.deserialize(subSchema)
                if t then 
                    table.insert(types, t)
                    nonNullType = t
                end
            end
        end
        
        -- 如果是 [T, null] 模式，转为 Optional
        if hasNull and #types == 1 then
            result = Type.Optional(nonNullType)
        elseif #types >= 2 then
            result = Type.Or(table.unpack(types))
        elseif #types == 1 then
            result = types[1]
        end
    -- 处理 anyOf (也当作 Or)
    elseif schema.anyOf then
        local types = {}
        for _, subSchema in ipairs(schema.anyOf) do
            local t = Type.deserialize(subSchema)
            if t then table.insert(types, t) end
        end
        if #types >= 2 then
            result = Type.Or(table.unpack(types))
        elseif #types == 1 then
            result = types[1]
        end
    -- 基础类型
    elseif schemaType == "string" then
        result = Type.String
    elseif schemaType == "integer" then
        result = Type.Int
    elseif schemaType == "number" then
        result = Type.Float
    elseif schemaType == "boolean" then
        result = Type.Bool
    elseif schemaType == "null" then
        result = Type.Nil
    elseif schemaType == "array" then
        if schema.items then
            local inner = Type.deserialize(schema.items)
            if inner then result = Type.Array(inner) end
        else
            result = Type.Array(Type.Any)
        end
    elseif schemaType == "object" then
        -- 检查是否是 Function 类型
        if schema["x-function"] then
            local opts = {}
            if schema["x-params"] then
                opts.params = {}
                for k, v in pairs(schema["x-params"]) do
                    opts.params[k] = Type.deserialize(v)
                end
            end
            if schema["x-returns"] then
                opts.returns = Type.deserialize(schema["x-returns"])
            end
            result = Type.Function(opts)
        -- 检查是否是 Record 类型 (additionalProperties 为 schema 而非 false)
        elseif schema.additionalProperties and type(schema.additionalProperties) == "table" and not schema.properties then
            local valueType = Type.deserialize(schema.additionalProperties)
            if valueType then result = Type.Record(valueType) end
        -- 普通 Object 类型
        else
            local fields = {}
            local required = {}
            
            -- 构建 required 集合
            if schema.required then
                for _, k in ipairs(schema.required) do
                    required[k] = true
                end
            end
            
            -- 解析 properties
            if schema.properties then
                for k, v in pairs(schema.properties) do
                    local fieldType = Type.deserialize(v)
                    if fieldType then
                        -- 如果字段不在 required 中且不是 Optional，包装为 Optional
                        if not required[k] and fieldType.kind ~= "optional" then
                            fieldType = Type.Optional(fieldType)
                        end
                        fields[k] = fieldType
                    end
                end
            end
            
            result = Type.Object(fields)
        end
    -- 空 schema = Any
    elseif schemaType == nil and not schema.oneOf and not schema.anyOf then
        result = Type.Any
    end
    
    -- 恢复描述（需要克隆以避免污染单例）
    if result and schema.description then
        result = Type.clone(result)
        result._desc = schema.description
    end
    
    return result
end

----------------------------------------------------------------
-- 格式化
----------------------------------------------------------------

function Type.format(T, indent, includeDesc)
    if not Type.isType(T) then return "?" end
    
    indent = indent or 0
    includeDesc = includeDesc == nil and true or includeDesc  -- 默认包含描述
    local indentStr = string.rep("  ", indent)
    
    local kind = T.kind
    local result = ""
    
    -- 基础类型
    if kind == "string" then result = "String"
    elseif kind == "bool" then result = "Bool"
    elseif kind == "int" then result = "Int"
    elseif kind == "float" then result = "Float"
    elseif kind == "any" then result = "Any"
    elseif kind == "nil" then result = "Nil"
    elseif kind == "void" then result = "Void"
    elseif kind == "function" then result = "Function"
    elseif kind == "optional" then 
        result = Type.format(T.inner, indent, includeDesc) .. "?"
    elseif kind == "array" then 
        result = Type.format(T.inner, indent, includeDesc) .. "[]"
    elseif kind == "record" then 
        result = "Record<" .. Type.format(T.valueType, indent, includeDesc) .. ">"
    elseif kind == "object" then
        local lines = {"{"}
        local fieldNames = {}
        for k in pairs(T.fields or {}) do
            table.insert(fieldNames, k)
        end
        table.sort(fieldNames)
        
        for _, k in ipairs(fieldNames) do
            local v = T.fields[k]
            local fieldType = Type.format(v, indent + 1, includeDesc)
            local line = string.rep("  ", indent + 1) .. k .. ": " .. fieldType
            if includeDesc and v._desc then
                line = line .. "  // " .. v._desc
            end
            table.insert(lines, line)
        end
        table.insert(lines, indentStr .. "}")
        result = table.concat(lines, "\n")
    elseif kind == "or" then
        local parts = {}
        for _, t in ipairs(T.types) do 
            table.insert(parts, Type.format(t, indent, includeDesc)) 
        end
        result = table.concat(parts, " | ")
    else
        result = kind
    end
    
    -- 添加当前类型的描述（如果需要且存在）
    if includeDesc and T._desc and kind ~= "object" then
        result = result .. "  // " .. T._desc
    end
    
    return result
end

function Type.clone(T)
    if not Type.isType(T) then return nil end
    
    -- 深拷贝创建新对象
    local clone = {}
    for k, v in pairs(T) do
        if Type.isType(v) then
            -- 递归克隆嵌套的 Type
            clone[k] = Type.clone(v)
        elseif type(v) == "table" then
            -- 深拷贝容器 table（如 fields, types, params），其中值都是 Type
            local tblClone = {}
            for tk, tv in pairs(v) do
                tblClone[tk] = Type.isType(tv) and Type.clone(tv) or tv
            end
            clone[k] = tblClone
        else
            clone[k] = v
        end
    end
    return setmetatable(clone, Type)
end

----------------------------------------------------------------
-- Metatable 操作符
----------------------------------------------------------------

function Type:__tostring() return Type.format(self) end
function Type:__mul(other) return Type.And(self, other) end
function Type:__add(other) return Type.Or(self, other) end
function Type:__call(value) return Type.instantiate(self, value) end
function Type:__eq(other) return Type.equals(self, other) end


Type = Type -- 全局别名
return Type
