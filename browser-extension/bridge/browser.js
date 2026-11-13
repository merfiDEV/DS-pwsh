"use strict";

const { spawn, execFile } = require("node:child_process");

const DEFAULT_COMMANDS = {
  win32: "cmd",
  darwin: "open",
  linux: "xdg-open",
};

const BROWSER_PROCESS_NAMES = {
  win32: ["chrome.exe", "msedge.exe", "brave.exe", "firefox.exe", "vivaldi.exe", "opera.exe"],
  darwin: ["Google Chrome", "Microsoft Edge", "Brave Browser", "firefox", "Vivaldi", "Opera"],
  linux: [
    "chrome",
    "chromium",
    "chromium-browser",
    "msedge",
    "brave-browser",
    "firefox",
    "vivaldi",
    "opera",
    "google-chrome",
  ],
};

function openBrowser(url) {
  const override = process.env.DS_PWSH_OPEN_CMD;
  const platform = process.platform;
  if (override) {
    try {
      const child = spawn(override, [url], { stdio: "ignore", detached: true, shell: false });
      child.on("error", () => {});
      child.unref();
    } catch {
      // ignore
    }
    return;
  }

  const command = DEFAULT_COMMANDS[platform];
  if (!command) return;

  try {
    let child;
    if (platform === "win32") {
      child = spawn("cmd", ["/c", "start", "", url], {
        stdio: "ignore",
        detached: true,
        windowsHide: true,
      });
    } else {
      child = spawn(command, [url], { stdio: "ignore", detached: true });
    }
    child.on("error", () => {});
    child.unref();
  } catch {
    // ignore
  }
}

function listProcesses() {
  return new Promise((resolve) => {
    const platform = process.platform;
    if (platform === "win32") {
      execFile(
        "tasklist",
        ["/fo", "csv", "/nh"],
        { windowsHide: true, timeout: 5000 },
        (error, stdout) => {
          if (error || !stdout) return resolve([]);
          resolve(
            stdout
              .split(/\r?\n/)
              .map((line) => line.split(",")[0]?.replace(/^"|"$/g, "").trim())
              .filter(Boolean),
          );
        },
      );
      return;
    }
    execFile("ps", ["-A", "-o", "comm="], { timeout: 5000 }, (error, stdout) => {
      if (error || !stdout) return resolve([]);
      resolve(
        stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean),
      );
    });
  });
}

function isBrowserRunning(processes = []) {
  const names = BROWSER_PROCESS_NAMES[process.platform] || [];
  const lower = new Set(processes.map((name) => name.toLowerCase()));
  return names.some((needle) => {
    const wanted = needle.toLowerCase();
    for (const name of lower) {
      if (name === wanted || name.includes(wanted)) return true;
    }
    return false;
  });
}

function startBrowserKeeper(url, { intervalMs = 10_000, log = () => {} } = {}) {
  let timer = null;
  let running = false;
  let stopped = false;

  async function tick() {
    if (stopped || running) return;
    running = true;
    try {
      const processes = await listProcesses();
      if (!isBrowserRunning(processes)) {
        log(`[DS-pwsh] Browser not detected, reopening ${url}`);
        openBrowser(url);
      }
    } catch {
      // ignore
    } finally {
      running = false;
    }
  }

  function schedule() {
    if (stopped) return;
    timer = setTimeout(async () => {
      await tick();
      schedule();
    }, intervalMs);
    if (typeof timer.unref === "function") timer.unref();
  }

  schedule();

  return {
    stop() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
    _tick: tick,
  };
}

module.exports = { openBrowser, isBrowserRunning, startBrowserKeeper };
