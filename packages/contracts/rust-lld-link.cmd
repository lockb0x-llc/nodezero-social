@echo off
rem rust-lld-link.cmd
rem
rem Thin wrapper that delegates to rust-lld.exe (LLVM lld bundled with the
rem Rust toolchain) as an MSVC-compatible linker, replacing `link.exe`.
rem
rem This allows `cargo check / cargo build` on Windows machines that have
rem Rust 1.85+ installed but no Visual Studio Build Tools (no MSVC link.exe).
rem
rem Usage: referenced via .cargo/config.toml [target.x86_64-pc-windows-msvc]
rem        linker = "path/to/rust-lld-link.cmd"
for /f "tokens=*" %%i in ('rustup which rustc --toolchain 1.85.0-x86_64-pc-windows-msvc 2^>nul') do (
    set "RUSTC=%%i"
)
if "%RUSTC%"=="" (
    for /f "tokens=*" %%i in ('rustup which rustc 2^>nul') do set "RUSTC=%%i"
)
set "LLD=%RUSTC:bin\rustc.exe=lib\rustlib\x86_64-pc-windows-msvc\bin\rust-lld.exe%"
"%LLD%" %*
