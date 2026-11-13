"use strict";

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const RICH_LOG_SCRIPT = path.join(__dirname, "rich-log.py");
const RICH_VENV_PYTHON = path.join(__dirname, ".rich-venv", "bin", "python");
const RICH_LOG_BIN = path.join(
  __dirname,
  process.platform === "win32" ? "rich-log-bin.exe" : "rich-log-bin.bin",
);

let richLoggerChecked = false;
let richLoggerCommand = null;
let richLoggerArgs = null;

function resolvePythonForRich() {
  if (fs.existsSync(RICH_VENV_PYTHON)) return RICH_VENV_PYTHON;
  return process.env.DS_PWSH_PYTHON || "python3";
}

function extractBundledRichLog() {
  if (!fs.existsSync(RICH_LOG_BIN)) return null;
  let data;
  try {
    data = fs.readFileSync(RICH_LOG_BIN);
  } catch {
    return null;
  }
  const hash = crypto.createHash("sha1").update(data).digest("hex").slice(0, 12);
  const ext = process.platform === "win32" ? ".exe" : "";
  const dir = path.join(os.tmpdir(), "ds-pwsh-rich-log");
  const target = path.join(dir, `rich-log-${hash}${ext}`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(target)) {
      fs.writeFileSync(target, data);
      if (process.platform !== "win32") fs.chmodSync(target, 0o755);
    }
    return target;
  } catch {
    return null;
  }
}

const APPEND_MAGIC = Buffer.from("DSPWSH-RICHLOG-V1\n", "utf8");

function extractAppendedRichLog() {
  if (!process.pkg) return null;
  let fd;
  try {
    fd = fs.openSync(process.execPath, "r");
    const size = fs.fstatSync(fd).size;
    const window = Math.min(size, APPEND_MAGIC.length + 64 * 1024 * 1024);
    const buf = Buffer.alloc(window);
    fs.readSync(fd, buf, 0, window, size - window);
    const idx = buf.lastIndexOf(APPEND_MAGIC);
    if (idx < 0) return null;
    const start = size - window + idx + APPEND_MAGIC.length;
    const richSize = size - start;
    if (richSize <= 0) return null;
    const ext = process.platform === "win32" ? ".exe" : "";
    const dir = path.join(os.tmpdir(), "ds-pwsh-rich-log");
    const hash = crypto.createHash("sha1").update(String(start)).digest("hex").slice(0, 12);
    const target = path.join(dir, "rich-log-" + hash + ext);
    if (!fs.existsSync(target) || fs.statSync(target).size !== richSize) {
      fs.mkdirSync(dir, { recursive: true });
      const out = fs.openSync(target, "w");
      const CHUNK = 1 << 20;
      const block = Buffer.alloc(CHUNK);
      let pos = start;
      while (pos < size) {
        const n = fs.readSync(fd, block, 0, Math.min(CHUNK, size - pos), pos);
        if (n <= 0) break;
        fs.writeSync(out, block, 0, n);
        pos += n;
      }
      fs.closeSync(out);
      if (process.platform !== "win32") fs.chmodSync(target, 0o755);
    }
    return target;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
  }
}

function detectRichLogger() {
  if (richLoggerChecked) return richLoggerCommand;
  richLoggerChecked = true;
  richLoggerCommand = null;
  richLoggerArgs = null;
  if (process.env.DS_PWSH_NO_RICH === "1") return null;

  const appended = process.pkg ? extractAppendedRichLog() : null;
  if (appended) {
    richLoggerCommand = appended;
    richLoggerArgs = [];
    return richLoggerCommand;
  }

  const bundled = process.pkg
    ? extractBundledRichLog()
    : fs.existsSync(RICH_LOG_BIN)
      ? RICH_LOG_BIN
      : null;
  if (bundled) {
    richLoggerCommand = bundled;
    richLoggerArgs = [];
    return richLoggerCommand;
  }

  if (process.pkg) return null;
  if (!fs.existsSync(RICH_LOG_SCRIPT)) return null;
  const python = resolvePythonForRich();
  try {
    const probe = spawnSync(python, ["-c", "import rich"], {
      stdio: "ignore",
      windowsHide: true,
      timeout: 5000,
    });
    if (probe.status === 0) {
      richLoggerCommand = python;
      richLoggerArgs = [RICH_LOG_SCRIPT];
    }
  } catch {
    richLoggerCommand = null;
    richLoggerArgs = null;
  }
  return richLoggerCommand;
}

function logViaRich(payload) {
  const command = richLoggerCommand;
  if (!command) return false;
  const args = richLoggerArgs || [];
  try {
    const child = spawn(command, args, {
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
    .split("\\n")
    .map((line, index) => (index === 0 ? line : `    | ${line}`))
    .join("\\n");
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
