// build.rs - Build script for lua_runner_wasm
//
// This script compiles the C++ emval_bridge code and links it with the Rust code.
// When targeting wasm32-unknown-emscripten, we use emcc for compilation.

use std::env;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    let target = env::var("TARGET").unwrap_or_default();
    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let cpp_dir = manifest_dir.join("cpp");
    
    println!("cargo:rerun-if-changed=cpp/emval_bridge.h");
    println!("cargo:rerun-if-changed=cpp/emval_bridge.cpp");
    
    if target == "wasm32-unknown-emscripten" {
        // Compile C++ code using emcc with embind support
        let cpp_file = cpp_dir.join("emval_bridge.cpp");
        let obj_file = out_dir.join("emval_bridge.o");
        
        // Compile to object file with embind
        // Note: -lembind must be at link time, not compile time
        let status = Command::new("emcc")
            .args([
                "-c",
                "-O2",
                "-std=c++17",
                "-fPIC",
                "-I", cpp_dir.to_str().unwrap(),
                cpp_file.to_str().unwrap(),
                "-o", obj_file.to_str().unwrap(),
            ])
            .status()
            .expect("Failed to run emcc - is Emscripten installed and active?");
        
        if !status.success() {
            panic!("emcc compilation failed");
        }
        
        // Create static library
        let lib_file = out_dir.join("libemval_bridge.a");
        let status = Command::new("emar")
            .args([
                "rcs",
                lib_file.to_str().unwrap(),
                obj_file.to_str().unwrap(),
            ])
            .status()
            .expect("Failed to run emar");
        
        if !status.success() {
            panic!("emar failed to create static library");
        }
        
        // Tell cargo to link the library
        println!("cargo:rustc-link-search=native={}", out_dir.display());
        println!("cargo:rustc-link-lib=static=emval_bridge");
        
        // Link with embind - this is critical for emval functions to work
        println!("cargo:rustc-link-arg=-lembind");
        // Force the linker to include our symbols even if they appear unused
        println!("cargo:rustc-link-arg=--whole-archive");
        println!("cargo:rustc-link-arg=-lemval_bridge");
        println!("cargo:rustc-link-arg=--no-whole-archive");
    } else {
        // For non-Emscripten targets (e.g., native tests), we skip C++ compilation
        // and the code should not use the FFI functions
        println!("cargo:warning=Building for non-Emscripten target, emval FFI will not be available");
    }
}
