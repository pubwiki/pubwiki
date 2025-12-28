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
    self._desc = description
    return self
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
-- 序列化 / 反序列化
----------------------------------------------------------------

function Type.serialize(T)
    if not Type.isType(T) then return nil end
    
    local kind = T.kind
    local result = { kind = kind }
    if T._desc then result._desc = T._desc end
    
    if kind == "optional" or kind == "array" then
        result.inner = Type.serialize(T.inner)
    elseif kind == "object" then
        result.fields = {}
        for k, v in pairs(T.fields or {}) do
            result.fields[k] = Type.serialize(v)
        end
    elseif kind == "or" then
        result.types = {}
        for i, t in ipairs(T.types) do
            result.types[i] = Type.serialize(t)
        end
    elseif kind == "function" then
        if T.params then
            result.params = {}
            for k, v in pairs(T.params) do
                result.params[k] = Type.serialize(v)
            end
        end
        if T.returns then result.returns = Type.serialize(T.returns) end
    end
    
    return result
end

function Type.deserialize(spec)
    if not spec or type(spec) ~= "table" or not spec.kind then return nil end
    
    local kind = spec.kind
    local result
    
    if kind == "string" then result = Type.String
    elseif kind == "bool" then result = Type.Bool
    elseif kind == "int" then result = Type.Int
    elseif kind == "float" then result = Type.Float
    elseif kind == "any" then result = Type.Any
    elseif kind == "nil" then result = Type.Nil
    elseif kind == "void" then result = Type.Void
    elseif kind == "optional" and spec.inner then
        local inner = Type.deserialize(spec.inner)
        if inner then result = Type.Optional(inner) end
    elseif kind == "array" and spec.inner then
        local inner = Type.deserialize(spec.inner)
        if inner then result = Type.Array(inner) end
    elseif kind == "object" then
        local fields = {}
        for k, v in pairs(spec.fields or {}) do
            fields[k] = Type.deserialize(v)
        end
        result = Type.Object(fields)
    elseif kind == "or" and spec.types then
        local types = {}
        for _, t in ipairs(spec.types) do
            local converted = Type.deserialize(t)
            if converted then table.insert(types, converted) end
        end
        if #types >= 2 then result = Type.Or(table.unpack(types)) end
    elseif kind == "function" then
        local opts = {}
        if spec.params then
            opts.params = {}
            for k, v in pairs(spec.params) do
                opts.params[k] = Type.deserialize(v)
            end
        end
        if spec.returns then opts.returns = Type.deserialize(spec.returns) end
        result = Type.Function(opts)
    end
    
    if result and spec._desc then result._desc = spec._desc end
    return result
end

----------------------------------------------------------------
-- 格式化
----------------------------------------------------------------

function Type.format(T)
    if not Type.isType(T) then return "?" end
    
    local kind = T.kind
    
    if kind == "string" then return "String" end
    if kind == "bool" then return "Bool" end
    if kind == "int" then return "Int" end
    if kind == "float" then return "Float" end
    if kind == "any" then return "Any" end
    if kind == "nil" then return "Nil" end
    if kind == "void" then return "Void" end
    if kind == "function" then return "Function" end
    if kind == "optional" then return Type.format(T.inner) .. "?" end
    if kind == "array" then return Type.format(T.inner) .. "[]" end
    
    if kind == "object" then
        local parts = {}
        for k, v in pairs(T.fields or {}) do
            table.insert(parts, k .. ": " .. Type.format(v))
        end
        table.sort(parts)
        return "{ " .. table.concat(parts, ", ") .. " }"
    end
    
    if kind == "or" then
        local parts = {}
        for _, t in ipairs(T.types) do table.insert(parts, Type.format(t)) end
        return table.concat(parts, " | ")
    end
    
    return kind
end

function Type.clone(T)
    if not Type.isType(T) then return nil end
    return Type.deserialize(Type.serialize(T))
end

----------------------------------------------------------------
-- Metatable 操作符
----------------------------------------------------------------

function Type:__tostring() return Type.format(self) end
function Type:__mul(other) return Type.And(self, other) end
function Type:__add(other) return Type.Or(self, other) end
function Type:__call(value) return Type.instantiate(self, value) end
function Type:__eq(other) return Type.equals(self, other) end

return Type
