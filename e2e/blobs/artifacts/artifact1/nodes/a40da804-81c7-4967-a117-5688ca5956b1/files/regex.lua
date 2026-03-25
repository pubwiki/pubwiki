-- regex.lua
-- 正则表达式操作库
-- 
-- ⚠️ 重要提示：
-- 本运行时中的 string.find/gsub/match/gmatch 已被重载为使用 **正则表达式** 而非 Lua pattern。
-- 请使用本库提供的 API，以明确表达正则表达式的意图。
--
-- 正则表达式语法参考：
-- - .       任意字符
-- - *       零次或多次
-- - +       一次或多次
-- - ?       零次或一次
-- - ^       行首
-- - $       行尾
-- - [abc]   字符类
-- - [^abc]  否定字符类
-- - (...)   捕获组
-- - \d      数字 [0-9]
-- - \w      单词字符 [a-zA-Z0-9_]
-- - \s      空白字符
-- - \{      字面量 {（需要转义）
-- - \}      字面量 }（需要转义）

local Regex = {}

----------------------------------------------------------------
-- 转义工具
----------------------------------------------------------------

--- 转义字符串中的正则特殊字符，使其可以作为字面量匹配
--- @param str string 要转义的字符串
--- @return string 转义后的字符串
function Regex.escape(str)
    -- 正则表达式特殊字符: . * + ? ^ $ { } [ ] ( ) | \
    -- 由于 gsub 已被重载为正则表达式，且 \ 转义不生效，
    -- 这里使用逐字符处理 + 字符类 [x] 的方式进行转义
    
    local specialChars = {
        ["\\"] = true,
        ["."] = true,
        ["*"] = true,
        ["+"] = true,
        ["?"] = true,
        ["^"] = true,
        ["$"] = true,
        ["{"] = true,
        ["}"] = true,
        ["["] = true,
        ["]"] = true,
        ["("] = true,
        [")"] = true,
        ["|"] = true,
        ["%"] = true,
    }
    
    local result = {}
    for i = 1, #str do
        local c = str:sub(i, i)
        if specialChars[c] then
            if c == "[" then
                table.insert(result, "[[]")
            elseif c == "]" then
                table.insert(result, "[]]")
            elseif c == "\\" then
                table.insert(result, "[\\\\]")
            elseif c == "^" then
                -- ^ 在字符类开头有特殊含义，放在非开头位置
                table.insert(result, "[\\^]")
            elseif c == "%" then
                -- % 用 [%%] 匹配
                table.insert(result, "[%%]")
            else
                table.insert(result, "[" .. c .. "]")
            end
        else
            table.insert(result, c)
        end
    end
    return table.concat(result)
end

----------------------------------------------------------------
-- 匹配操作
----------------------------------------------------------------

--- 测试字符串是否匹配正则表达式
--- @param str string 要测试的字符串
--- @param pattern string 正则表达式
--- @return boolean 是否匹配
function Regex.test(str, pattern)
    return str:find(pattern) ~= nil
end

--- 查找第一个匹配的位置
--- @param str string 要搜索的字符串
--- @param pattern string 正则表达式
--- @return number|nil start 起始位置（1-based），未找到返回 nil
--- @return number|nil end 结束位置（1-based）
function Regex.find(str, pattern)
    return str:find(pattern)
end

--- 提取第一个匹配的内容
--- @param str string 要搜索的字符串
--- @param pattern string 正则表达式（可包含捕获组）
--- @return string|nil ... 匹配结果或捕获组内容
function Regex.match(str, pattern)
    local m = str:match(pattern)
    if type(m) == "table" then
        if #m == 0 then
            return nil
        else
            return m[1]
        end
    end
    if m ~= nil then
        return m
    end
    return nil
end

--- 提取所有匹配的内容（迭代器）
--- @param str string 要搜索的字符串
--- @param pattern string 正则表达式
--- @return function 迭代器
function Regex.matchAll(str, pattern)
    return str:gmatch(pattern)
end

--- 提取所有匹配的内容（数组）
--- @param str string 要搜索的字符串
--- @param pattern string 正则表达式
--- @return table 匹配结果数组
function Regex.findAll(str, pattern)
    local results = {}
    for match in str:gmatch(pattern) do
        table.insert(results, match)
    end
    return results
end

----------------------------------------------------------------
-- 替换操作
----------------------------------------------------------------

--- 替换所有匹配的内容
--- @param str string 原字符串
--- @param pattern string 正则表达式
--- @param replacement string|function 替换内容或替换函数
--- @return string 替换后的字符串
--- @return number 替换次数
function Regex.replace(str, pattern, replacement)
    return str:gsub(pattern, replacement)
end

--- 替换第一个匹配的内容
--- @param str string 原字符串
--- @param pattern string 正则表达式
--- @param replacement string|function 替换内容或替换函数
--- @return string 替换后的字符串
function Regex.replaceFirst(str, pattern, replacement)
    return str:gsub(pattern, replacement, 1)
end

----------------------------------------------------------------
-- 字面量操作（不使用正则）
----------------------------------------------------------------

--- 字面量查找（不解释正则特殊字符）
--- @param str string 要搜索的字符串
--- @param literal string 要查找的字面量
--- @return number|nil start 起始位置，未找到返回 nil
--- @return number|nil end 结束位置
function Regex.findLiteral(str, literal)
    return str:find(Regex.escape(literal))
end

--- 字面量替换（不解释正则特殊字符）
--- @param str string 原字符串
--- @param literal string 要替换的字面量
--- @param replacement string 替换内容
--- @return string 替换后的字符串
--- @return number 替换次数
function Regex.replaceLiteral(str, literal, replacement)
    -- 使用函数作为 replacement，避免 % 等特殊字符的转义问题
    return str:gsub(Regex.escape(literal), function() return replacement end)
end

--- 字面量测试（不解释正则特殊字符）
--- @param str string 要测试的字符串
--- @param literal string 要查找的字面量
--- @return boolean 是否包含
function Regex.contains(str, literal)
    return str:find(Regex.escape(literal)) ~= nil
end

----------------------------------------------------------------
-- 分割操作
----------------------------------------------------------------

--- 按正则表达式分割字符串
--- @param str string 要分割的字符串
--- @param pattern string 分隔符正则表达式
--- @return table 分割后的数组
function Regex.split(str, pattern)
    local result = {}
    local lastEnd = 1
    
    for start, finish in function() return str:find(pattern, lastEnd) end do
        if start > lastEnd then
            table.insert(result, str:sub(lastEnd, start - 1))
        elseif start == lastEnd then
            table.insert(result, "")
        end
        lastEnd = finish + 1
    end
    
    -- 添加最后一部分
    if lastEnd <= #str then
        table.insert(result, str:sub(lastEnd))
    elseif lastEnd == #str + 1 then
        table.insert(result, "")
    end
    
    return result
end

--- 按字面量分割字符串
--- @param str string 要分割的字符串
--- @param literal string 分隔符字面量
--- @return table 分割后的数组
function Regex.splitLiteral(str, literal)
    return Regex.split(str, Regex.escape(literal))
end

----------------------------------------------------------------
-- 常用正则表达式常量
----------------------------------------------------------------

Regex.patterns = {
    -- 数字
    integer = "^-?\\d+$",
    float = "^-?\\d+\\.\\d+$",
    number = "^-?\\d+\\.?\\d*$",
    
    -- 空白
    whitespace = "\\s+",
    trim = "^\\s+|\\s+$",
    
    -- 标识符
    identifier = "^[a-zA-Z_][a-zA-Z0-9_]*$",
    
    -- 常见格式
    email = "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}",
    url = "https?://[^\\s]+",
}

return Regex
