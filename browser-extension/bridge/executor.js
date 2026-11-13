"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const {
  COMMAND_TIMEOUT_MS,
  MAX_COMMAND_LENGTH,
  MAX_OUTPUT_BYTES,
} = require("./config");

function shellForPlatform(platform) {
  return platform === "win32" ? "pwsh" : "bash";
}

function validateExecutionRequest(body, options = {}) {
  const platform = options.platform || process.platform;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Request body must be an object.");
  }
  if (body.shell !== shellForPlatform(platform)) {
    throw new Error(`This host accepts ${shellForPlatform(platform)} commands only.`);
  }
  if (
    typeof body.command !== "string" ||
    !body.command.trim() ||
    body.command.length > MAX_COMMAND_LENGTH
  ) {
    throw new Error(`Command must contain 1-${MAX_COMMAND_LENGTH} characters.`);
  }

  const cwd =
    typeof body.cwd === "string" && body.cwd.trim()
      ? path.resolve(body.cwd.trim())
      : path.resolve(options.defaultCwd || process.cwd());
  if (!path.isAbsolute(cwd) || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    throw new Error(`Working directory does not exist: ${cwd}`);
  }

  return { shell: body.shell, command: body.command, cwd };
}

function executeCommand({ shell, command, cwd }, options = {}) {
  const timeoutMs = options.timeoutMs || COMMAND_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes || MAX_OUTPUT_BYTES;
  const executable =
    shell === "pwsh"
      ? process.env.COOKIE_CODE_PWSH || "powershell.exe"
      : process.env.COOKIE_CODE_BASH || "bash";
  const args =
    shell === "pwsh"
      ? [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [Console]::OutputEncoding; ${command}`,
        ]
      : ["-c", command];

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(executable, args, {
        cwd,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      reject(error);
      return;
    }

    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let timedOut = false;
    let outputTruncated = false;

    const collect = (target) => (chunk) => {
      if (outputBytes >= maxOutputBytes) {
        outputTruncated = true;
        return;
      }
      const remaining = maxOutputBytes - outputBytes;
      const bounded = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
      target.push(bounded);
      outputBytes += bounded.length;
      if (bounded.length < chunk.length) outputTruncated = true;
    };

    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (exitCode, signal) => {
      clearTimeout(timeout);
      const output = [
        Buffer.concat(stdout).toString("utf8").trimEnd(),
        Buffer.concat(stderr).toString("utf8").trimEnd()
          ? `[stderr]\n${Buffer.concat(stderr).toString("utf8").trimEnd()}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");
      resolve({
        exitCode: timedOut ? 124 : Number.isInteger(exitCode) ? exitCode : 1,
        output: `${output || "(no output)"}${timedOut ? "\n[command timed out]" : ""}${outputTruncated ? "\n[output truncated]" : ""}`,
        signal: signal || undefined,
      });
    });
  });
}

module.exports = { shellForPlatform, validateExecutionRequest, executeCommand };
