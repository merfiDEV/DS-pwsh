"use strict";

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const RICH_LOG_SCRIPT = path.join(__dirname, "rich-log.py");
const RICH_VENV_PYTHON = path.join(__dirname, ".rich-venv", "bin", "python");

let richLoggerChecked = false;
let richLoggerCommand = null;

function resolvePythonForRich() {
  if (fs.existsSync(RICH_VENV_PYTHON)) return RICH_VENV_PYTHON;
  return process.env.DS_PWSH_PYTHON || "python3";
}

function detectRichLogger() {
  if (richLoggerChecked) return richLoggerCommand;
  richLoggerChecked = true;
  richLoggerCommand = null;
  if (process.env.DS_PWSH_NO_RICH === "1") return null;
  // Inside a pkg single-file executable the helper script is not a real file
  // on disk, so an external Python interpreter cannot read it. Fall back to
  // plain text logs there.
  if (process.pkg) return null;
  if (!fs.existsSync(RICH_LOG_SCRIPT)) return null;
  const python = resolvePythonForRich();
  try {
    const probe = spawnSync(python, ["-c", "import rich"], {
      stdio: "ignore",
      windowsHide: true,
      timeout: 5000,
    });
    if (probe.status === 0) richLoggerCommand = python;
  } catch {
    richLoggerCommand = null;
  }
  return richLoggerCommand;
}

function logViaRich(payload) {
  const python = richLoggerCommand;
  if (!python) return false;
  try {
    const child = spawn(python, [RICH_LOG_SCRIPT], {
      stdio: ["pipe", "inherit", "inherit"],
      windowsHide: true,
    });
    child.on("error", () => {});
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

function formatCommandForLog(command) {
  return command
    .split("\n")
    .map((line, index) => (index === 0 ? line : `    | ${line}`))
    .join("\n");
}

function logCommandStart({ shell, command, cwd }) {
  if (logViaRich({ event: "start", shell, command, cwd })) return;
  console.log(`[DS-pwsh] >>> ${shell} (cwd: ${cwd})`);
  console.log(`[DS-pwsh]     ${formatCommandForLog(command)}`);
}

function logCommandResult({ shell }, result) {
  if (
    logViaRich({
      event: "result",
      shell,
      exitCode: result?.exitCode ?? null,
      signal: result?.signal ?? null,
    })
  ) {
    return;
  }
  const code = result?.exitCode ?? "?";
  const signal = result?.signal ? ` signal=${result.signal}` : "";
  console.log(`[DS-pwsh] <<< exit=${code}${signal}`);
}

module.exports = {
  detectRichLogger,
  logCommandStart,
  logCommandResult,
  formatCommandForLog,
};
