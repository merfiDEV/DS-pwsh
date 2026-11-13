"use strict";

const path = require("node:path");
const { DEEPSEEK_URL, configuredMinimumSendDelay } = require("./config");
const { shellForPlatform, executeCommand, validateExecutionRequest } = require("./executor");
const { createBridgeServer, listenOnAvailablePort } = require("./server");
const { detectRichLogger, logBanner } = require("./logger");
const { openBrowser } = require("./browser");
const { printBanner } = require("./banner");

let version = "";
try {
  version = require("../package.json").version || "";
} catch {
  version = "";
}

if (require.main === module) {
  // Detect the Rich renderer up front so the startup banner is styled.
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
