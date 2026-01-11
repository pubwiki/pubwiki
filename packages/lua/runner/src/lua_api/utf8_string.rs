use mlua::prelude::*;
use regex::Regex;

/// Override Lua's byte-based string methods with UTF-8 aware versions
pub fn install_utf8_string_methods(lua: &Lua) -> LuaResult<()> {
    let string_table: LuaTable = lua.globals().get("string")?;
    
    // Override string.len to count UTF-8 characters instead of bytes
    let utf8_len = lua.create_function(|_, s: String| {
        Ok(s.chars().count())
    })?;
    string_table.set("len", utf8_len)?;
    
    // Override string.sub to work with UTF-8 character indices
    let utf8_sub = lua.create_function(|_, (s, i, j): (String, Option<i64>, Option<i64>)| {
        let chars: Vec<char> = s.chars().collect();
        let len = chars.len() as i64;
        
        if len == 0 {
            return Ok(String::new());
        }
        
        // Convert 1-based Lua indices to 0-based Rust indices
        let start = i.unwrap_or(1);
        let end = j.unwrap_or(len);
        
        // Convert to 1-based positive indices first
        let start_1based = if start < 0 { len + start + 1 } else { start };
        let end_1based = if end < 0 { len + end + 1 } else { end };
        
        // Convert to 0-based indices
        let start_idx = ((start_1based - 1).max(0) as usize).min(chars.len());
        let end_idx = (end_1based.max(0) as usize).min(chars.len()); // end is inclusive in Lua, so don't subtract 1
        
        if start_idx >= end_idx || start_idx >= chars.len() {
            return Ok(String::new());
        }
        
        Ok(chars[start_idx..end_idx].iter().collect::<String>())
    })?;
    string_table.set("sub", utf8_sub)?;
    
    // Override string.reverse to work with UTF-8 characters
    let utf8_reverse = lua.create_function(|_, s: String| {
        Ok(s.chars().rev().collect::<String>())
    })?;
    string_table.set("reverse", utf8_reverse)?;
    
    // Override string.upper to work with UTF-8 characters
    let utf8_upper = lua.create_function(|_, s: String| {
        Ok(s.to_uppercase())
    })?;
    string_table.set("upper", utf8_upper)?;
    
    // Override string.lower to work with UTF-8 characters
    let utf8_lower = lua.create_function(|_, s: String| {
        Ok(s.to_lowercase())
    })?;
    string_table.set("lower", utf8_lower)?;
    
    // Add string.char_at to get character at UTF-8 index
    let utf8_char_at = lua.create_function(|_, (s, i): (String, i64)| {
        let chars: Vec<char> = s.chars().collect();
        let len = chars.len() as i64;
        
        let idx = if i < 0 {
            ((len + i + 1).max(0)) as usize
        } else {
            ((i - 1).max(0)) as usize
        };
        
        if idx >= chars.len() {
            Ok(None)
        } else {
            Ok(Some(chars[idx].to_string()))
        }
    })?;
    string_table.set("char_at", utf8_char_at)?;
    
    // Add string.chars to iterate over UTF-8 characters
    let utf8_chars = lua.create_function(|_, s: String| {
        let chars: Vec<String> = s.chars().map(|c| c.to_string()).collect();
        Ok(chars)
    })?;
    string_table.set("chars", utf8_chars)?;
    
    // Override string.byte to work with UTF-8 (return Unicode codepoint)
    let utf8_byte = lua.create_function(|_, (s, i, j): (String, Option<i64>, Option<i64>)| {
        let chars: Vec<char> = s.chars().collect();
        let len = chars.len() as i64;
        
        let start = i.unwrap_or(1);
        let end = j.unwrap_or(start);
        
        let start_idx = if start < 0 {
            ((len + start + 1).max(0)) as usize
        } else {
            ((start - 1).max(0)) as usize
        };
        
        let end_idx = if end < 0 {
            ((len + end + 1).max(0)) as usize
        } else {
            (end.min(len)) as usize
        };
        
        if start_idx >= chars.len() {
            return Ok(Vec::new());
        }
        
        let end_idx = end_idx.min(chars.len());
        let codepoints: Vec<u32> = chars[start_idx..end_idx]
            .iter()
            .map(|&c| c as u32)
            .collect();
        
        Ok(codepoints)
    })?;
    string_table.set("byte", utf8_byte)?;
    
    // Override string.char to create string from Unicode codepoints
    let utf8_char = lua.create_function(|_, codepoints: LuaMultiValue| {
        let mut result = String::new();
        for value in codepoints {
            if let LuaValue::Integer(code) = value {
                if let Some(c) = char::from_u32(code as u32) {
                    result.push(c);
                }
            } else if let LuaValue::Number(code) = value {
                if let Some(c) = char::from_u32(code as u32) {
                    result.push(c);
                }
            }
        }
        Ok(result)
    })?;
    string_table.set("char", utf8_char)?;
    
    // UTF-8 aware string.find with regex support
    let utf8_find = lua.create_function(|_, (s, pattern, init): (String, String, Option<i64>)| {
        let chars: Vec<char> = s.chars().collect();
        let start_pos = init.unwrap_or(1).max(1) as usize - 1;
        
        let search_str = &chars[start_pos..].iter().collect::<String>();
        match Regex::new(&pattern) {
            Ok(re) => {
                if let Some(mat) = re.find(search_str) {
                    // Calculate character positions (1-based)
                    let prefix = &search_str[..mat.start()];
                    let matched = &search_str[mat.start()..mat.end()];
                    
                    let char_start = start_pos + prefix.chars().count();
                    let char_end = char_start + matched.chars().count();
                    
                    Ok((Some((char_start + 1) as i64), Some(char_end as i64)))
                } else {
                    Ok((None, None))
                }
            }
            Err(e) => {
                Err(LuaError::RuntimeError(format!("Invalid regex pattern: {}", e)))
            }
        }
    })?;
    string_table.set("find", utf8_find)?;
    
    // string.match - return captured groups from regex
    let utf8_match = lua.create_function(|_, (s, pattern, init): (String, String, Option<i64>)| {
        let start_pos = init.unwrap_or(1).max(1) as usize - 1;
        let chars: Vec<char> = s.chars().collect();
        let search_str = &chars[start_pos..].iter().collect::<String>();
        
        match Regex::new(&pattern) {
            Ok(re) => {
                if let Some(caps) = re.captures(search_str) {
                    // Return all captured groups (excluding the full match at index 0)
                    let mut results = Vec::new();
                    for i in 1..caps.len() {
                        if let Some(m) = caps.get(i) {
                            results.push(m.as_str().to_string());
                        }
                    }
                    
                    // If no captures, return the full match
                    if results.is_empty() {
                        if let Some(m) = caps.get(0) {
                            results.push(m.as_str().to_string());
                        }
                    }
                    
                    Ok(Some(results))
                } else {
                    Ok(None)
                }
            }
            Err(e) => {
                Err(LuaError::RuntimeError(format!("Invalid regex pattern: {}", e)))
            }
        }
    })?;
    string_table.set("match", utf8_match)?;
    
    // string.gmatch - return iterator for all matches
    let utf8_gmatch = lua.create_function(|lua, (s, pattern): (String, String)| {
        match Regex::new(&pattern) {
            Ok(re) => {
                let matches: Vec<String> = re.find_iter(&s)
                    .map(|m| m.as_str().to_string())
                    .collect();
                
                // Create an iterator function
                let mut index = 0;
                let iter_fn = lua.create_function_mut(move |_lua, _: ()| {
                    if index < matches.len() {
                        let result = matches[index].clone();
                        index += 1;
                        Ok(Some(result))
                    } else {
                        Ok(None)
                    }
                })?;
                
                Ok(iter_fn)
            }
            Err(e) => {
                Err(LuaError::RuntimeError(format!("Invalid regex pattern: {}", e)))
            }
        }
    })?;
    string_table.set("gmatch", utf8_gmatch)?;
    
    // string.gsub - global substitution with regex
    let utf8_gsub = lua.create_function(|_, (s, pattern, replacement, n): (String, String, LuaValue, Option<usize>)| {
        match Regex::new(&pattern) {
            Ok(re) => {
                let max_replacements = n.unwrap_or(usize::MAX);
                let mut count = 0;
                
                let result = if let LuaValue::String(repl_str) = replacement {
                    let repl = repl_str.to_str()?.to_string();
                    let mut result = s.clone();
                    
                    // Find all matches and replace them (from end to start to maintain indices)
                    let matches: Vec<_> = re.find_iter(&s).collect();
                    
                    for mat in matches.iter().rev().take(max_replacements) {
                        result.replace_range(mat.range(), &repl);
                        count += 1;
                    }
                    
                    result
                } else if let LuaValue::Function(func) = replacement {
                    let mut result = String::new();
                    let mut last_end = 0;
                    
                    for mat in re.find_iter(&s).take(max_replacements) {
                        result.push_str(&s[last_end..mat.start()]);
                        
                        // Call the function with the match
                        let repl: String = func.call(mat.as_str())?;
                        result.push_str(&repl);
                        
                        last_end = mat.end();
                        count += 1;
                    }
                    
                    result.push_str(&s[last_end..]);
                    result
                } else {
                    return Err(LuaError::RuntimeError(
                        "gsub replacement must be string or function".to_string()
                    ));
                };
                
                Ok((result, count))
            }
            Err(e) => {
                Err(LuaError::RuntimeError(format!("Invalid regex pattern: {}", e)))
            }
        }
    })?;
    string_table.set("gsub", utf8_gsub)?;
    
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_utf8_len() {
        let lua = Lua::new();
        install_utf8_string_methods(&lua).unwrap();
        
        let len: usize = lua.load(r#"return string.len("你好世界")"#).eval().unwrap();
        assert_eq!(len, 4); // 4 characters, not 12 bytes
    }
    
    #[test]
    fn test_utf8_sub_debug() {
        let lua = Lua::new();
        install_utf8_string_methods(&lua).unwrap();
        
        // Debug negative indices
        let result: String = lua.load(r#"
            local s = "你好世界"
            print("Testing sub(-2, -1) on '你好世界'")
            local result = string.sub(s, -2, -1)
            print("Result:", result)
            return result
        "#).eval().unwrap();
        println!("Rust received: {}", result);
        assert_eq!(result, "世界");
    }
    
    #[test]
    fn test_utf8_sub() {
        let lua = Lua::new();
        install_utf8_string_methods(&lua).unwrap();
        
        // Positive indices
        let sub: String = lua.load(r#"return string.sub("你好世界", 1, 2)"#).eval().unwrap();
        assert_eq!(sub, "你好");
        
        // Negative indices - count from end
        let sub2: String = lua.load(r#"return string.sub("你好世界", -2, -1)"#).eval().unwrap();
        assert_eq!(sub2, "世界");
        
        // Mixed positive and negative
        let sub3: String = lua.load(r#"return string.sub("你好世界", 2, -2)"#).eval().unwrap();
        assert_eq!(sub3, "好世");
        
        // Negative start only
        let sub4: String = lua.load(r#"return string.sub("你好世界", -3)"#).eval().unwrap();
        assert_eq!(sub4, "好世界");

        let sub5: String = lua.load(r#"return string.sub("你好世界", 1, -2)"#).eval().unwrap();
        assert_eq!(sub5, "你好世");
    }
    
    #[test]
    fn test_utf8_reverse() {
        let lua = Lua::new();
        install_utf8_string_methods(&lua).unwrap();
        
        let rev: String = lua.load(r#"return string.reverse("你好")"#).eval().unwrap();
        assert_eq!(rev, "好你");
    }
    
    #[test]
    fn test_utf8_upper_lower() {
        let lua = Lua::new();
        install_utf8_string_methods(&lua).unwrap();
        
        let upper: String = lua.load(r#"return string.upper("hello")"#).eval().unwrap();
        assert_eq!(upper, "HELLO");
        
        let lower: String = lua.load(r#"return string.lower("WORLD")"#).eval().unwrap();
        assert_eq!(lower, "world");
    }
    
    #[test]
    fn test_method_call_syntax() {
        let lua = Lua::new();
        install_utf8_string_methods(&lua).unwrap();
        
        // Test that buffer:sub() method call syntax also uses UTF-8
        let sub: String = lua.load(r#"
            local s = "你好世界"
            return s:sub(1, 2)
        "#).eval().unwrap();
        assert_eq!(sub, "你好");
        
        // Test buffer:len() method call syntax
        let len: usize = lua.load(r#"
            local s = "你好世界"
            return s:len()
        "#).eval().unwrap();
        assert_eq!(len, 4);
    }

    #[test]
    fn test_multiline_string() {
        let lua = Lua::new();
        install_utf8_string_methods(&lua).unwrap();
        
        // Test regex with multiline content
        let _result: (Option<i64>, Option<i64>) = lua.load(r#"
            local s = "<summary>\nsjdjklwe\n</summary>"
            return s:find("<summary>[\\s\\S]*?</summary>")
        "#).eval().unwrap();
    }
    
    #[test]
    fn test_regex_find() {
        let lua = Lua::new();
        install_utf8_string_methods(&lua).unwrap();
        
        // Test regex pattern matching with UTF-8
        let result: (Option<i64>, Option<i64>) = lua.load(r#"
            local s = "你好world世界"
            return string.find(s, "[a-z]+")
        "#).eval().unwrap();
        assert_eq!(result, (Some(3), Some(7))); // "world" is at UTF-8 positions 3-7
        
        // Test regex with anchors
        let result2: (Option<i64>, Option<i64>) = lua.load(r#"
            local s = "你好world"
            return string.find(s, "^你好")
        "#).eval().unwrap();
        assert_eq!(result2, (Some(1), Some(2)));
    }
}
