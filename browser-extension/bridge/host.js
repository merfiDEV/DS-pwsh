"use strict";

const path = require("node:path");
const { HOST, DEEPSEEK_URL, configuredMinimumSendDelay } = require("./config");
const { shellForPlatform, executeCommand, validateExecutionRequest } = require("./executor");
const { createBridgeServer, listenOnAvailablePort } = require("./server");
const { detectRichLogger } = require("./logger");
const { openBrowser } = require("./browser");

if (require.main === module) {
  setImmediate(() => detectRichLogger());
  const server = createBridgeServer();
  listenOnAvailablePort(server)
    .then((port) => {
      console.log(`[DS-pwsh] Terminal bridge listening at http://${HOST}:${port}`);
      console.log(`[DS-pwsh] Shell: ${shellForPlatform(process.platform)}`);
      console.log(`[DS-pwsh] Working directory: ${path.resolve(process.cwd())}`);
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
