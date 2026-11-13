"use strict";

const http = require("node:http");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const HOST = "127.0.0.1";
const PORT_START = 49152;
const PORT_END = 49183;
const EXTENSION_ORIGIN = "chrome-extension://emfnepkalgoobcinjmjfmjigikeamfpj";
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_COMMAND_LENGTH = 32_000;
const COMMAND_TIMEOUT_MS = 60_000;
const DEFAULT_MINIMUM_SEND_DELAY_MS = 5_000;
const MAXIMUM_SEND_DELAY_MS = 180_000;

function configuredMinimumSendDelay(value = process.env.DS_PWSH_MIN_SEND_DELAY_MS) {
  if (value === undefined || value === "") return DEFAULT_MINIMUM_SEND_DELAY_MS;
  const delayMs = Number(value);
  if (
    !Number.isSafeInteger(delayMs) ||
    delayMs < DEFAULT_MINIMUM_SEND_DELAY_MS ||
    delayMs > MAXIMUM_SEND_DELAY_MS
  ) {
    throw new Error(
      `DS_PWSH_MIN_SEND_DELAY_MS must be an integer from ${DEFAULT_MINIMUM_SEND_DELAY_MS} to ${MAXIMUM_SEND_DELAY_MS}.`,
    );
  }
  return delayMs;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function shellForPlatform(platform) {
  return platform === "win32" ? "pwsh" : "bash";
}

function listenOnAvailablePort(
  server,
  { host = HOST, startPort = PORT_START, endPort = PORT_END } = {},
) {
  return new Promise((resolve, reject) => {
    let port = startPort;

    const tryListen = () => {
      const onError = (error) => {
        server.off("listening", onListening);
        if (error.code === "EADDRINUSE" && port < endPort) {
          port += 1;
          tryListen();
          return;
        }
        reject(
          error.code === "EADDRINUSE"
            ? new Error(`No free bridge port in range ${startPort}-${endPort}.`)
            : error,
        );
      };
      const onListening = () => {
        server.off("error", onError);
        resolve(server.address().port);
      };

      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, host);
    };

    tryListen();
  });
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

  const cwd = typeof body.cwd === "string" && body.cwd.trim()
    ? path.resolve(body.cwd.trim())
    : path.resolve(options.defaultCwd || process.cwd());
  if (!path.isAbsolute(cwd) || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    throw new Error(`Working directory does not exist: ${cwd}`);
  }

  return { shell: body.shell, command: body.command, cwd };
}

function executeCommand({ shell, command, cwd }, options = {}) {
  const platform = options.platform || process.platform;
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

function createBridgeServer(options = {}) {
  const platform = options.platform || process.platform;
  const defaultCwd = path.resolve(options.defaultCwd || process.cwd());
  const minimumSendDelayMs =
    options.minimumSendDelayMs ?? configuredMinimumSendDelay();
  if (!Number.isSafeInteger(minimumSendDelayMs) || minimumSendDelayMs < 0) {
    throw new Error("minimumSendDelayMs must be a non-negative integer.");
  }
  const wait = options.wait || delay;
  const execute = options.execute || executeCommand;

  return http.createServer(async (request, response) => {
    const origin = request.headers.origin;
    const isHealthRequest =
      request.method === "GET" && request.url === "/health";
    const originAllowed =
      origin === EXTENSION_ORIGIN ||
      (isHealthRequest && (origin === "null" || origin === undefined));
    if (!originAllowed) {
      console.warn(
        `[DS-pwsh] Rejected bridge request from origin ${JSON.stringify(origin || null)}`,
      );
      response.writeHead(403, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: false, error: "Origin is not allowed." }));
      return;
    }

    const corsHeaders = {
      "Access-Control-Allow-Origin": origin || "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "600",
      Vary: "Origin",
    };
    if (request.method === "OPTIONS") {
      response.writeHead(204, corsHeaders);
      response.end();
      return;
    }

    if (isHealthRequest) {
      response.writeHead(200, {
        ...corsHeaders,
        "Content-Type": "application/json; charset=utf-8",
      });
      response.end(
        JSON.stringify({
          ok: true,
          service: "ds-pwsh-terminal-bridge",
          platform,
          shell: shellForPlatform(platform),
          cwd: defaultCwd,
          minimumSendDelayMs,
        }),
      );
      return;
    }

    if (request.method !== "POST" || request.url !== "/execute") {
      response.writeHead(404, { ...corsHeaders, "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: false, error: "Not found." }));
      return;
    }

    try {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > MAX_REQUEST_BYTES) {
          throw new Error("Request body is too large.");
        }
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const validated = validateExecutionRequest(body, { platform, defaultCwd });
      const result = await execute(validated, { platform });
      await wait(minimumSendDelayMs);
      response.writeHead(200, {
        ...corsHeaders,
        "Content-Type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify({ ok: true, ...result }));
    } catch (error) {
      response.writeHead(400, {
        ...corsHeaders,
        "Content-Type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify({ ok: false, error: error.message || String(error) }));
    }
  });
}

function openBrowser(url) {
  if (process.env.DS_PWSH_NO_OPEN === "1") return;
  const platform = process.platform;
  let command;
  let args;
  if (platform === "win32") {
    command = process.env.ComSpec || "cmd.exe";
    args = ["/d", "/s", "/c", "start", "", url];
  } else if (platform === "darwin") {
    command = "open";
    args = [url];
  } else {
    command = process.env.DS_PWSH_OPEN_CMD || "xdg-open";
    args = [url];
  }
  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      windowsVerbatimArguments: platform === "win32",
    });
    child.on("error", (error) => {
      console.warn(
        `[DS-pwsh] Could not open browser via ${command}: ${error.message}`,
      );
    });
    child.unref();
  } catch (error) {
    console.warn(`[DS-pwsh] Could not open browser via ${command}: ${error.message}`);
  }
}

if (require.main === module) {
  const server = createBridgeServer();
  listenOnAvailablePort(server)
    .then((port) => {
      console.log(`[DS-pwsh] Terminal bridge listening at http://${HOST}:${port}`);
      console.log(`[DS-pwsh] Shell: ${shellForPlatform(process.platform)}`);
      console.log(`[DS-pwsh] Working directory: ${path.resolve(process.cwd())}`);
      openBrowser("https://chat.deepseek.com/");
    })
    .catch((error) => {
      console.error(`[DS-pwsh] Terminal bridge failed to start: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = {
  createBridgeServer,
  configuredMinimumSendDelay,
  executeCommand,
  listenOnAvailablePort,
  shellForPlatform,
  validateExecutionRequest,
};
