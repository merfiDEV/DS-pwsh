"use strict";

const path = require("node:path");
const { DEEPSEEK_URL, configuredMinimumSendDelay } = require("./config");
const { shellForPlatform, executeCommand, validateExecutionRequest } = require("./executor");
const { createBridgeServer, listenOnAvailablePort } = require("./server");
const { detectRichLogger, logBanner } = require("./logger");
const { openBrowser, startBrowserKeeper } = require("./browser");
const { printBanner } = require("./banner");

let version = "";
try {
  version = require("../package.json").version || "";
} catch {
  version = "";
}

function configuredBrowserCheckMs(value = process.env.DS_PWSH_BROWSER_CHECK_MS) {
  if (value === undefined || value === "") return 10_000;
  const ms = Number(value);
  if (!Number.isSafeInteger(ms) || ms < 1000) return 10_000;
  return ms;
}

// The keeper is enabled by default; set DS_PWSH_KEEP_BROWSER=0 to disable it.
function keeperEnabled(value = process.env.DS_PWSH_KEEP_BROWSER) {
  if (value === undefined) return true;
  const normalized = String(value).trim().toLowerCase();
  return !(
    normalized === "0" ||
    normalized === "false" ||
    normalized === "no" ||
    normalized === "off"
  );
}

if (require.main === module) {
  detectRichLogger();
  const server = createBridgeServer();
  listenOnAvailablePort(server)
    .then((port) => {
      const info = {
        port,
        shell: shellForPlatform(process.platform),
        cwd: path.resolve(process.cwd()),
        platform: process.platform,
        version,
      };
      if (!logBanner(info)) printBanner(info);
      openBrowser(DEEPSEEK_URL);

      if (keeperEnabled()) {
        const intervalMs = configuredBrowserCheckMs();
        startBrowserKeeper(DEEPSEEK_URL, {
          intervalMs,
          log: (message) => console.log(message),
        });
      }
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
  keeperEnabled,
};
