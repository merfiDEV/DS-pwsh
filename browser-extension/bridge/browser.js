"use strict";

const { spawn } = require("node:child_process");

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
      console.warn(`[DS-pwsh] Could not open browser via ${command}: ${error.message}`);
    });
    child.unref();
  } catch (error) {
    console.warn(`[DS-pwsh] Could not open browser via ${command}: ${error.message}`);
  }
}

module.exports = { openBrowser };
