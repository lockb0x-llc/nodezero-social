#!/usr/bin/env pwsh
<#
.SYNOPSIS
    One-time Windows developer setup for NodeZero Soroban contracts.

.DESCRIPTION
    Soroban smart contracts use proc-macros (#[contract], #[contractimpl]).
    On Windows, proc-macros compile as native executables, which requires
    either the MSVC Build Tools (Visual Studio) or the GNU toolchain (MinGW).

    This script installs the MINIMAL required components via winget:
      - MSVC C++ build tools (compiler + linker)
      - Windows 11 SDK (kernel32.lib, advapi32.lib, etc.)

    After running this script, `cargo check` and `cargo test` work locally.
    CI uses ubuntu-latest and does not need this script.

.EXAMPLE
    pwsh -File scripts/dev-setup-windows-contracts.ps1
#>

$ErrorActionPreference = "Stop"

Write-Host "`n[setup] NodeZero contracts — Windows developer setup" -ForegroundColor Cyan
Write-Host "[setup] This installs MSVC Build Tools + Windows 11 SDK via winget.`n"

# Check winget is available
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Error "winget not found. Install App Installer from the Microsoft Store."
    exit 1
}

# Check if already installed
$vsWhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path $vsWhere) {
    $installed = & $vsWhere -products * -requires Microsoft.VisualCpp.Tools.HostX64.TargetX64 2>$null
    if ($installed) {
        Write-Host "[setup] MSVC Build Tools already installed. No action needed." -ForegroundColor Green
        exit 0
    }
}

Write-Host "[setup] Installing Visual Studio 2022 Build Tools..."
Write-Host "[setup] Components: MSVC v143 compiler + Windows 11 SDK 22621`n"

winget install Microsoft.VisualStudio.2022.BuildTools --silent `
  --override "--quiet --add Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Component.Windows11SDK.22621 --includeRecommended --wait --norestart"

Write-Host "`n[setup] Done. Please RESTART your terminal, then run:" -ForegroundColor Green
Write-Host "  cd packages/contracts && cargo check"
Write-Host ""
Write-Host "[setup] Alternatively, use WSL2 for a Linux-native experience:"
Write-Host "  wsl -- cargo check --manifest-path packages/contracts/Cargo.toml"
