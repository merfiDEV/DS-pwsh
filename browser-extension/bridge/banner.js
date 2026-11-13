"use strict";

const { HOST } = require("./config");

// Plain-text fallback used only when the Rich renderer is unavailable.
function formatBanner({ port, shell, cwd, platform } = {}) {
  const address = `http://${HOST}:${port}`;
  return [
    "",
    "  === DS-pwsh Terminal Bridge ===",
    "  Status:   RUNNING",
    `  Address:  ${address}`,
    `  Shell:    ${shell}`,
    `  Platform: ${platform}`,
    `  Cwd:      ${cwd}`,
    "",
    "  Waiting for commands from the browser extension...",
    "  Press Ctrl+C to stop.",
    "",
  ].join("\n");
}

function printBanner(info = {}) {
  process.stdout.write(formatBanner(info) + "\n");
}

module.exports = { formatBanner, printBanner };
