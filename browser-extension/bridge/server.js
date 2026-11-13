"use strict";

const http = require("node:http");
const {
  HOST,
  PORT_START,
  PORT_END,
  EXTENSION_ORIGIN,
  MAX_REQUEST_BYTES,
  configuredMinimumSendDelay,
} = require("./config");
const { executeCommand, shellForPlatform, validateExecutionRequest } = require("./executor");
const { logCommandStart, logCommandResult } = require("./logger");

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

function createBridgeServer(options = {}) {
  const platform = options.platform || process.platform;
  const defaultCwd = options.defaultCwd || process.cwd();
  const minimumSendDelayMs = options.minimumSendDelayMs ?? configuredMinimumSendDelay();
  if (!Number.isSafeInteger(minimumSendDelayMs) || minimumSendDelayMs < 0) {
    throw new Error("minimumSendDelayMs must be a non-negative integer.");
  }
  const execute = options.execute || executeCommand;

  return http.createServer(async (request, response) => {
    const origin = request.headers.origin;
    const isHealthRequest = request.method === "GET" && request.url === "/health";
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
      logCommandStart(validated);
      const result = await execute(validated, { platform });
      logCommandResult(validated, result);
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

module.exports = { listenOnAvailablePort, createBridgeServer };
