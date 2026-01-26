//! emval_ffi.rs - Raw FFI bindings to emval_bridge C functions
//!
//! This module provides safe Rust wrappers around the Emscripten val C API.
//! It replaces the problematic `emscripten-val` crate with direct FFI calls.

use std::ffi::{c_char, c_void};
use std::ptr;

/// Emscripten val handle type (opaque pointer)
#[allow(non_camel_case_types)]
pub type EM_VAL = *mut c_void;

// ==================== External C Functions ====================

// These FFI functions are part of the complete emval API.
// Some are not currently used but kept for API completeness.
#[allow(dead_code)]
unsafe extern "C" {
    // Creation
    pub fn emval_create_undefined() -> EM_VAL;
    pub fn emval_create_null() -> EM_VAL;
    pub fn emval_create_bool(b: bool) -> EM_VAL;
    pub fn emval_create_i32(n: i32) -> EM_VAL;
    pub fn emval_create_f64(n: f64) -> EM_VAL;
    pub fn emval_create_string(s: *const c_char, len: usize) -> EM_VAL;
    pub fn emval_create_array() -> EM_VAL;
    pub fn emval_create_object() -> EM_VAL;
    pub fn emval_get_global(name: *const c_char) -> EM_VAL;

    // Type checks
    pub fn emval_is_undefined(handle: EM_VAL) -> bool;
    pub fn emval_is_null(handle: EM_VAL) -> bool;
    pub fn emval_is_true(handle: EM_VAL) -> bool;
    pub fn emval_is_false(handle: EM_VAL) -> bool;
    pub fn emval_is_number(handle: EM_VAL) -> bool;
    pub fn emval_is_string(handle: EM_VAL) -> bool;
    pub fn emval_is_array(handle: EM_VAL) -> bool;

    // Value extraction
    pub fn emval_as_f64(handle: EM_VAL) -> f64;
    pub fn emval_as_i32(handle: EM_VAL) -> i32;
    pub fn emval_as_bool(handle: EM_VAL) -> bool;
    pub fn emval_as_string(handle: EM_VAL, out_len: *mut usize) -> *const c_char;
    pub fn emval_type_of(handle: EM_VAL, out_len: *mut usize) -> *const c_char;

    // Property access
    pub fn emval_get_property_str(handle: EM_VAL, key: *const c_char) -> EM_VAL;
    pub fn emval_get_property_idx(handle: EM_VAL, index: u32) -> EM_VAL;
    pub fn emval_get_property_val(handle: EM_VAL, key_handle: EM_VAL) -> EM_VAL;
    pub fn emval_has_property_val(handle: EM_VAL, key_handle: EM_VAL) -> bool;
    pub fn emval_set_property_str(handle: EM_VAL, key: *const c_char, value_handle: EM_VAL);
    pub fn emval_set_property_idx(handle: EM_VAL, index: u32, value_handle: EM_VAL);

    // Function calls
    pub fn emval_call_method(
        handle: EM_VAL,
        method_name: *const c_char,
        args_handles: *const EM_VAL,
        args_count: usize,
    ) -> EM_VAL;
    pub fn emval_call_function(
        func_handle: EM_VAL,
        this_handle: EM_VAL,
        args_handles: *const EM_VAL,
        args_count: usize,
    ) -> EM_VAL;

    // Reference counting
    pub fn emval_clone_handle(handle: EM_VAL) -> EM_VAL;
    pub fn emval_release_handle(handle: EM_VAL);

    // Array operations
    pub fn emval_array_push(array_handle: EM_VAL, value_handle: EM_VAL);
    pub fn emval_array_length(handle: EM_VAL) -> u32;

    // Object operations
    pub fn emval_object_keys(handle: EM_VAL) -> EM_VAL;

    // Memory management (from Emscripten)
    pub fn free(ptr: *mut c_void);
}

// ==================== Safe Rust Wrappers ====================

/// A safe wrapper around an Emscripten val handle.
/// Automatically manages reference counting.
#[derive(Debug)]
pub struct JsVal {
    handle: EM_VAL,
}

// Some methods are part of the complete JsVal API but not currently used.
#[allow(dead_code)]
impl JsVal {
    /// Create from a raw handle (takes ownership)
    pub fn from_handle(handle: EM_VAL) -> Self {
        JsVal { handle }
    }

    /// Get the raw handle (borrows)
    pub fn handle(&self) -> EM_VAL {
        self.handle
    }

    /// Take ownership of the handle (consumes self without releasing)
    pub fn into_handle(self) -> EM_VAL {
        let handle = self.handle;
        std::mem::forget(self);
        handle
    }

    // ==================== Constructors ====================

    pub fn undefined() -> Self {
        JsVal::from_handle(unsafe { emval_create_undefined() })
    }

    pub fn null() -> Self {
        JsVal::from_handle(unsafe { emval_create_null() })
    }

    pub fn from_bool(b: bool) -> Self {
        JsVal::from_handle(unsafe { emval_create_bool(b) })
    }

    pub fn from_i32(n: i32) -> Self {
        JsVal::from_handle(unsafe { emval_create_i32(n) })
    }

    pub fn from_f64(n: f64) -> Self {
        JsVal::from_handle(unsafe { emval_create_f64(n) })
    }

    pub fn from_str(s: &str) -> Self {
        JsVal::from_handle(unsafe { emval_create_string(s.as_ptr() as *const c_char, s.len()) })
    }

    pub fn array() -> Self {
        JsVal::from_handle(unsafe { emval_create_array() })
    }

    pub fn object() -> Self {
        JsVal::from_handle(unsafe { emval_create_object() })
    }

    pub fn global(name: &str) -> Self {
        let c_name = std::ffi::CString::new(name).expect("CString::new failed");
        JsVal::from_handle(unsafe { emval_get_global(c_name.as_ptr()) })
    }

    // ==================== Type Checks ====================

    pub fn is_undefined(&self) -> bool {
        unsafe { emval_is_undefined(self.handle) }
    }

    pub fn is_null(&self) -> bool {
        unsafe { emval_is_null(self.handle) }
    }

    pub fn is_true(&self) -> bool {
        unsafe { emval_is_true(self.handle) }
    }

    pub fn is_false(&self) -> bool {
        unsafe { emval_is_false(self.handle) }
    }

    pub fn is_number(&self) -> bool {
        unsafe { emval_is_number(self.handle) }
    }

    pub fn is_string(&self) -> bool {
        unsafe { emval_is_string(self.handle) }
    }

    pub fn is_array(&self) -> bool {
        unsafe { emval_is_array(self.handle) }
    }

    // ==================== Value Extraction ====================

    pub fn as_f64(&self) -> f64 {
        unsafe { emval_as_f64(self.handle) }
    }

    pub fn as_i32(&self) -> i32 {
        unsafe { emval_as_i32(self.handle) }
    }

    pub fn as_bool(&self) -> bool {
        unsafe { emval_as_bool(self.handle) }
    }

    pub fn as_string(&self) -> String {
        unsafe {
            let mut len: usize = 0;
            let ptr = emval_as_string(self.handle, &mut len);
            if ptr.is_null() {
                return String::new();
            }
            let bytes = std::slice::from_raw_parts(ptr as *const u8, len);
            let s = String::from_utf8_lossy(bytes).to_string();
            free(ptr as *mut c_void);
            s
        }
    }

    pub fn type_of(&self) -> String {
        unsafe {
            let mut len: usize = 0;
            let ptr = emval_type_of(self.handle, &mut len);
            if ptr.is_null() {
                return String::new();
            }
            let bytes = std::slice::from_raw_parts(ptr as *const u8, len);
            let s = String::from_utf8_lossy(bytes).to_string();
            free(ptr as *mut c_void);
            s
        }
    }

    // ==================== Property Access ====================

    pub fn get(&self, key: &str) -> JsVal {
        let c_key = std::ffi::CString::new(key).expect("CString::new failed");
        JsVal::from_handle(unsafe { emval_get_property_str(self.handle, c_key.as_ptr()) })
    }

    pub fn get_index(&self, index: u32) -> JsVal {
        JsVal::from_handle(unsafe { emval_get_property_idx(self.handle, index) })
    }

    pub fn get_val(&self, key: &JsVal) -> JsVal {
        JsVal::from_handle(unsafe { emval_get_property_val(self.handle, key.handle) })
    }

    /// Check if object has a property (implements JavaScript 'in' operator)
    /// Works with both string keys and Symbol keys
    pub fn has_val(&self, key: &JsVal) -> bool {
        unsafe { emval_has_property_val(self.handle, key.handle) }
    }

    pub fn set(&self, key: &str, value: &JsVal) {
        let c_key = std::ffi::CString::new(key).expect("CString::new failed");
        unsafe { emval_set_property_str(self.handle, c_key.as_ptr(), value.handle) }
    }

    pub fn set_index(&self, index: u32, value: &JsVal) {
        unsafe { emval_set_property_idx(self.handle, index, value.handle) }
    }

    // ==================== Function Calls ====================

    /// Call a method on this value
    pub fn call_method(&self, method_name: &str, args: &[&JsVal]) -> JsVal {
        let c_method = std::ffi::CString::new(method_name).expect("CString::new failed");
        let handles: Vec<EM_VAL> = args.iter().map(|v| v.handle).collect();
        let result = unsafe {
            emval_call_method(
                self.handle,
                c_method.as_ptr(),
                if handles.is_empty() {
                    ptr::null()
                } else {
                    handles.as_ptr()
                },
                handles.len(),
            )
        };
        JsVal::from_handle(result)
    }

    /// Call this value as a function with a 'this' context
    pub fn call_with_this(&self, this_val: &JsVal, args: &[&JsVal]) -> JsVal {
        let handles: Vec<EM_VAL> = args.iter().map(|v| v.handle).collect();
        let result = unsafe {
            emval_call_function(
                self.handle,
                this_val.handle,
                if handles.is_empty() {
                    ptr::null()
                } else {
                    handles.as_ptr()
                },
                handles.len(),
            )
        };
        JsVal::from_handle(result)
    }

    /// Call this value as a function with null as 'this'
    pub fn call(&self, args: &[&JsVal]) -> JsVal {
        let null_this = JsVal::null();
        self.call_with_this(&null_this, args)
    }

    // ==================== Array Operations ====================

    pub fn push(&self, value: &JsVal) {
        unsafe { emval_array_push(self.handle, value.handle) }
    }

    pub fn length(&self) -> u32 {
        unsafe { emval_array_length(self.handle) }
    }

    // ==================== Object Operations ====================

    pub fn keys(&self) -> JsVal {
        JsVal::from_handle(unsafe { emval_object_keys(self.handle) })
    }
}

impl Clone for JsVal {
    fn clone(&self) -> Self {
        let new_handle = unsafe { emval_clone_handle(self.handle) };
        JsVal::from_handle(new_handle)
    }
}

impl Drop for JsVal {
    fn drop(&mut self) {
        unsafe { emval_release_handle(self.handle) }
    }
}

// Safety: JsVal is only used in single-threaded WASM context
unsafe impl Send for JsVal {}
unsafe impl Sync for JsVal {}

#[cfg(test)]
mod tests {
    // Tests would go here but require Emscripten environment
}
