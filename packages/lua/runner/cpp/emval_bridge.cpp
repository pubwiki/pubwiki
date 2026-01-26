// emval_bridge.cpp - Emscripten val API bridge implementation
// This file is compiled by emcc and linked with the Rust code

#include "emval_bridge.h"
#include <emscripten/val.h>

using emscripten::val;
using EM_VAL = emscripten::EM_VAL;

// The inline functions in the header are sufficient for most cases.
// This file exists to ensure proper linkage and can contain
// any non-inline implementations if needed.

// If we need to export C functions for direct FFI (as a fallback), we can add them here:

extern "C" {

// ==================== C API Wrappers ====================
// These provide a stable C ABI for Rust to call via FFI

EM_VAL emval_create_undefined() {
    return emval_bridge::create_undefined();
}

EM_VAL emval_create_null() {
    return emval_bridge::create_null();
}

EM_VAL emval_create_bool(bool b) {
    return emval_bridge::create_bool(b);
}

EM_VAL emval_create_i32(int32_t n) {
    return emval_bridge::create_i32(n);
}

EM_VAL emval_create_f64(double n) {
    return emval_bridge::create_f64(n);
}

EM_VAL emval_create_string(const char* s, size_t len) {
    return emval_bridge::create_string(s, len);
}

EM_VAL emval_create_array() {
    return emval_bridge::create_array();
}

EM_VAL emval_create_object() {
    return emval_bridge::create_object();
}

EM_VAL emval_get_global(const char* name) {
    return emval_bridge::get_global(name);
}

// Type checks
bool emval_is_undefined(EM_VAL handle) {
    return emval_bridge::is_undefined(handle);
}

bool emval_is_null(EM_VAL handle) {
    return emval_bridge::is_null(handle);
}

bool emval_is_true(EM_VAL handle) {
    return emval_bridge::is_true(handle);
}

bool emval_is_false(EM_VAL handle) {
    return emval_bridge::is_false(handle);
}

bool emval_is_number(EM_VAL handle) {
    return emval_bridge::is_number(handle);
}

bool emval_is_string(EM_VAL handle) {
    return emval_bridge::is_string(handle);
}

bool emval_is_array(EM_VAL handle) {
    return emval_bridge::is_array(handle);
}

// Value extraction
double emval_as_f64(EM_VAL handle) {
    return emval_bridge::as_f64(handle);
}

int32_t emval_as_i32(EM_VAL handle) {
    return emval_bridge::as_i32(handle);
}

bool emval_as_bool(EM_VAL handle) {
    return emval_bridge::as_bool(handle);
}

const char* emval_as_string(EM_VAL handle, size_t* out_len) {
    return emval_bridge::as_string(handle, out_len);
}

const char* emval_type_of(EM_VAL handle, size_t* out_len) {
    return emval_bridge::type_of(handle, out_len);
}

// Property access
EM_VAL emval_get_property_str(EM_VAL handle, const char* key) {
    return emval_bridge::get_property_str(handle, key);
}

EM_VAL emval_get_property_idx(EM_VAL handle, uint32_t index) {
    return emval_bridge::get_property_idx(handle, index);
}

EM_VAL emval_get_property_val(EM_VAL handle, EM_VAL key_handle) {
    return emval_bridge::get_property_val(handle, key_handle);
}

bool emval_has_property_val(EM_VAL handle, EM_VAL key_handle) {
    return emval_bridge::has_property_val(handle, key_handle);
}

void emval_set_property_str(EM_VAL handle, const char* key, EM_VAL value_handle) {
    emval_bridge::set_property_str(handle, key, value_handle);
}

void emval_set_property_idx(EM_VAL handle, uint32_t index, EM_VAL value_handle) {
    emval_bridge::set_property_idx(handle, index, value_handle);
}

// Function calls
EM_VAL emval_call_method(EM_VAL handle, const char* method_name,
                         const EM_VAL* args_handles, size_t args_count) {
    return emval_bridge::call_method(handle, method_name, args_handles, args_count);
}

EM_VAL emval_call_function(EM_VAL func_handle, EM_VAL this_handle,
                           const EM_VAL* args_handles, size_t args_count) {
    return emval_bridge::call_function(func_handle, this_handle, args_handles, args_count);
}

// Reference counting
EM_VAL emval_clone_handle(EM_VAL handle) {
    return emval_bridge::clone_handle(handle);
}

void emval_release_handle(EM_VAL handle) {
    emval_bridge::release_handle(handle);
}

// Array operations
void emval_array_push(EM_VAL array_handle, EM_VAL value_handle) {
    emval_bridge::array_push(array_handle, value_handle);
}

uint32_t emval_array_length(EM_VAL handle) {
    return emval_bridge::array_length(handle);
}

// Object operations
EM_VAL emval_object_keys(EM_VAL handle) {
    return emval_bridge::object_keys(handle);
}

} // extern "C"
