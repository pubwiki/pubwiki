// emval_bridge.h - Emscripten val API bridge
// 
// OWNERSHIP MODEL: 
// - Functions that BORROW handles use val::take_ownership() + val::release() pattern
//   This transfers ownership to val temporarily, then releases it back.
// - Functions that return new handles use val::release() to transfer ownership out.
// - NO manual incref/decref - all managed through val's RAII.

#pragma once

#include <emscripten/val.h>
#include <emscripten/wire.h>
#include <string>
#include <vector>
#include <cstdint>
#include <cstdio>

namespace emval_bridge {

using emscripten::val;
using EM_VAL = emscripten::EM_VAL;

// Debug logging
#define EMVAL_DEBUG 0

#if EMVAL_DEBUG
#define EMVAL_LOG(fmt, ...) fprintf(stderr, "[emval] " fmt "\n", ##__VA_ARGS__)
#else
#define EMVAL_LOG(fmt, ...)
#endif

// ==================== RAII Helper ====================
// BorrowedVal: temporarily owns a handle, releases it back on destruction
class BorrowedVal {
    val v;
    EM_VAL original_handle;
public:
    explicit BorrowedVal(EM_VAL handle) 
        : v(val::take_ownership(handle)), original_handle(handle) {}
    
    ~BorrowedVal() {
        // Release ownership back - the handle remains valid for the caller
        v.release_ownership();
    }
    
    val& get() { return v; }
    const val& get() const { return v; }
    val* operator->() { return &v; }
    const val* operator->() const { return &v; }
};

// ==================== Val Creation ====================
// These create new handles - caller owns the returned handle
// We use release_ownership() to transfer ownership out, preventing the
// temporary val from decref'ing the handle when it destructs.

inline EM_VAL create_undefined() {
    return val::undefined().release_ownership();
}

inline EM_VAL create_null() {
    return val::null().release_ownership();
}

inline EM_VAL create_bool(bool b) {
    return val(b).release_ownership();
}

inline EM_VAL create_i32(int32_t n) {
    return val(n).release_ownership();
}

inline EM_VAL create_f64(double n) {
    return val(n).release_ownership();
}

inline EM_VAL create_string(const char* s, size_t len) {
    return val(std::string(s, len)).release_ownership();
}

inline EM_VAL create_array() {
    return val::array().release_ownership();
}

inline EM_VAL create_object() {
    return val::object().release_ownership();
}

inline EM_VAL get_global(const char* name) {
    return val::global(name).release_ownership();
}

// ==================== Reference Counting ====================

/// Clone a handle - caller owns the new reference
inline EM_VAL clone_handle(EM_VAL handle) {
    EMVAL_LOG("clone_handle(%p)", handle);
    emscripten::internal::_emval_incref(handle);
    return handle;
}

/// Release a handle - CONSUMES the handle
inline void release_handle(EM_VAL handle) {
    EMVAL_LOG("release_handle(%p)", handle);
    val::take_ownership(handle); // destructor decrefs
}

// ==================== Type Checks ====================
// These BORROW the handle - it remains valid after the call

inline bool is_undefined(EM_VAL handle) {
    EMVAL_LOG("is_undefined(%p)", handle);
    BorrowedVal v(handle);
    return v->isUndefined();
}

inline bool is_null(EM_VAL handle) {
    EMVAL_LOG("is_null(%p)", handle);
    BorrowedVal v(handle);
    return v->isNull();
}

inline bool is_true(EM_VAL handle) {
    EMVAL_LOG("is_true(%p)", handle);
    BorrowedVal v(handle);
    return v->isTrue();
}

inline bool is_false(EM_VAL handle) {
    EMVAL_LOG("is_false(%p)", handle);
    BorrowedVal v(handle);
    return v->isFalse();
}

inline bool is_number(EM_VAL handle) {
    EMVAL_LOG("is_number(%p)", handle);
    BorrowedVal v(handle);
    return v->isNumber();
}

inline bool is_string(EM_VAL handle) {
    EMVAL_LOG("is_string(%p)", handle);
    BorrowedVal v(handle);
    return v->isString();
}

inline bool is_array(EM_VAL handle) {
    EMVAL_LOG("is_array(%p)", handle);
    BorrowedVal v(handle);
    return v->isArray();
}

// ==================== Value Extraction ====================
// These BORROW the handle

inline double as_f64(EM_VAL handle) {
    EMVAL_LOG("as_f64(%p)", handle);
    BorrowedVal v(handle);
    return v->as<double>();
}

inline int32_t as_i32(EM_VAL handle) {
    EMVAL_LOG("as_i32(%p)", handle);
    BorrowedVal v(handle);
    return v->as<int32_t>();
}

inline bool as_bool(EM_VAL handle) {
    EMVAL_LOG("as_bool(%p)", handle);
    BorrowedVal v(handle);
    return v->as<bool>();
}

inline const char* as_string(EM_VAL handle, size_t* out_len) {
    EMVAL_LOG("as_string(%p)", handle);
    BorrowedVal v(handle);
    std::string str = v->as<std::string>();
    *out_len = str.size();
    char* result = (char*)malloc(str.size() + 1);
    memcpy(result, str.c_str(), str.size() + 1);
    return result;
}

// ==================== Property Access ====================
// Input handles are BORROWED, returns NEW handle (caller owns it)

inline EM_VAL get_property_str(EM_VAL handle, const char* key) {
    EMVAL_LOG("get_property_str(%p, \"%s\")", handle, key);
    BorrowedVal v(handle);
    val result = v.get()[key];
    return result.release_ownership(); // Transfer ownership to caller
}

inline EM_VAL get_property_idx(EM_VAL handle, uint32_t index) {
    EMVAL_LOG("get_property_idx(%p, %u)", handle, index);
    BorrowedVal v(handle);
    val result = v.get()[index];
    return result.release_ownership();
}

inline EM_VAL get_property_val(EM_VAL handle, EM_VAL key_handle) {
    EMVAL_LOG("get_property_val(%p, %p)", handle, key_handle);
    BorrowedVal v(handle);
    BorrowedVal key(key_handle);
    val result = v.get()[key.get()];
    return result.release_ownership();
}

// Set property - BORROWS all handles
inline void set_property_str(EM_VAL handle, const char* key, EM_VAL value_handle) {
    EMVAL_LOG("set_property_str(%p, \"%s\", %p)", handle, key, value_handle);
    BorrowedVal v(handle);
    BorrowedVal value(value_handle);
    v->set(key, value.get());
}

inline void set_property_idx(EM_VAL handle, uint32_t index, EM_VAL value_handle) {
    EMVAL_LOG("set_property_idx(%p, %u, %p)", handle, index, value_handle);
    BorrowedVal v(handle);
    BorrowedVal value(value_handle);
    v->set(index, value.get());
}

// ==================== typeof ====================

inline const char* type_of(EM_VAL handle, size_t* out_len) {
    EMVAL_LOG("type_of(%p)", handle);
    BorrowedVal v(handle);
    std::string type_str = v->typeOf().as<std::string>();
    *out_len = type_str.size();
    char* result = (char*)malloc(type_str.size() + 1);
    memcpy(result, type_str.c_str(), type_str.size() + 1);
    return result;
}

// ==================== Function Calls ====================
// All input handles are BORROWED, returns NEW handle

inline EM_VAL call_method(EM_VAL handle, const char* method_name, 
                          const EM_VAL* args_handles, size_t args_count) {
    EMVAL_LOG("call_method(%p, \"%s\", argc=%zu)", handle, method_name, args_count);
    
    BorrowedVal v(handle);
    
    // Borrow all argument handles
    std::vector<BorrowedVal> borrowed_args;
    borrowed_args.reserve(args_count);
    for (size_t i = 0; i < args_count; i++) {
        borrowed_args.emplace_back(args_handles[i]);
    }
    
    val result;
    switch (args_count) {
        case 0: result = v->call<val>(method_name); break;
        case 1: result = v->call<val>(method_name, borrowed_args[0].get()); break;
        case 2: result = v->call<val>(method_name, borrowed_args[0].get(), borrowed_args[1].get()); break;
        case 3: result = v->call<val>(method_name, borrowed_args[0].get(), borrowed_args[1].get(), borrowed_args[2].get()); break;
        case 4: result = v->call<val>(method_name, borrowed_args[0].get(), borrowed_args[1].get(), borrowed_args[2].get(), borrowed_args[3].get()); break;
        case 5: result = v->call<val>(method_name, borrowed_args[0].get(), borrowed_args[1].get(), borrowed_args[2].get(), borrowed_args[3].get(), borrowed_args[4].get()); break;
        default: {
            val arr = val::array();
            for (size_t i = 0; i < args_count; i++) {
                arr.call<void>("push", borrowed_args[i].get());
            }
            val func = v.get()[method_name];
            result = func.call<val>("apply", v.get(), arr);
        } break;
    }
    
    return result.release_ownership();
}

inline EM_VAL call_function(EM_VAL func_handle, EM_VAL this_handle,
                            const EM_VAL* args_handles, size_t args_count) {
    EMVAL_LOG("call_function(%p, this=%p, argc=%zu)", func_handle, this_handle, args_count);
    
    BorrowedVal func(func_handle);
    BorrowedVal this_val(this_handle);
    
    val args_array = val::array();
    std::vector<BorrowedVal> borrowed_args;
    borrowed_args.reserve(args_count);
    for (size_t i = 0; i < args_count; i++) {
        borrowed_args.emplace_back(args_handles[i]);
        args_array.call<void>("push", borrowed_args.back().get());
    }
    
    val result = func->call<val>("apply", this_val.get(), args_array);
    return result.release_ownership();
}

// ==================== Array Operations ====================

inline void array_push(EM_VAL array_handle, EM_VAL value_handle) {
    EMVAL_LOG("array_push(%p, %p)", array_handle, value_handle);
    BorrowedVal arr(array_handle);
    BorrowedVal value(value_handle);
    arr->call<void>("push", value.get());
}

inline uint32_t array_length(EM_VAL handle) {
    EMVAL_LOG("array_length(%p)", handle);
    BorrowedVal v(handle);
    return v.get()["length"].as<uint32_t>();
}

// ==================== Object Operations ====================

inline EM_VAL object_keys(EM_VAL handle) {
    EMVAL_LOG("object_keys(%p)", handle);
    BorrowedVal v(handle);
    val result = val::global("Object").call<val>("keys", v.get());
    return result.release_ownership();
}

} // namespace emval_bridge
