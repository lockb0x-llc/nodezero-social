#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const contractsDir = path.join(process.cwd(), "packages", "contracts");
const env = { ...process.env };

let result;

if (process.platform === "win32") {
  const vcvarsPath =
    process.env.VCVARS64_BAT ||
    "C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Auxiliary\\Build\\vcvars64.bat";

  if (!fs.existsSync(vcvarsPath)) {
    console.error(`MSVC environment script not found: ${vcvarsPath}`);
    console.error(
      "Install Visual Studio Build Tools (C++ workload) or set VCVARS64_BAT to the correct vcvars64.bat path.",
    );
    process.exit(1);
  }

  const target = env.CARGO_BUILD_TARGET || "x86_64-pc-windows-msvc";
  const wrapperPath = path.join(os.tmpdir(), "nodezero-test-contracts.cmd");
  const wrapperContents = [
    "@echo off",
    `call \"${vcvarsPath}\"`,
    "if errorlevel 1 exit /b %errorlevel%",
    `set CARGO_BUILD_TARGET=${target}`,
    "cargo test",
    "exit /b %errorlevel%",
    "",
  ].join("\r\n");

  fs.writeFileSync(wrapperPath, wrapperContents, "ascii");
  result = spawnSync("cmd.exe", ["/d", "/c", wrapperPath], {
    cwd: contractsDir,
    env,
    stdio: "inherit",
  });
  fs.rmSync(wrapperPath, { force: true });
} else {
  result = spawnSync("cargo", ["test"], {
    cwd: contractsDir,
    env,
    stdio: "inherit",
  });
}

if (typeof result.status === "number") {
  process.exit(result.status);
}

if (result.error) {
  console.error(result.error.message);
}

process.exit(1);
