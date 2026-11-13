const DEEPSEEK_ORIGIN = "https://chat.deepseek.com";
const PORT_START = 49152;
const PORT_END = 49183;
const MAX_COMMAND_LENGTH = 32_000;
const BRIDGE_REQUEST_TIMEOUT_MS = 260_000;
let activePort = null;

async function getOptions() {
  const options = await chrome.storage.local.get({
    autoRun: true,
    projectDir: "",
  });
  return {
    autoRun: options.autoRun === true,
    projectDir:
      typeof options.projectDir === "string" ? options.projectDir.trim() : "",
  };
}

async function findBridge() {
  const probes = [];
  for (let port = PORT_START; port <= PORT_END; port += 1) {
    probes.push(
      fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(1500),
      })
        .then(async (response) => {
          if (!response.ok) return null;
          const status = await response.json();
          return status.service === "ds-pwsh-terminal-bridge"
            ? { port, status }
            : null;
        })
        .catch(() => null),
    );
  }
  const results = await Promise.all(probes);
  const bridge = results.find(Boolean);
  if (!bridge) {
    throw new Error("Локальный мост не найден. Запустите bridge/host.js.");
  }
  activePort = bridge.port;
  return bridge;
}

async function getBridgeStatus() {
  const bridge = await findBridge();
  return { ...bridge.status, port: bridge.port };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "GET_BRIDGE_STATUS") {
    getBridgeStatus()
      .then((status) => sendResponse({ ok: true, status }))
      .catch((error) =>
        sendResponse({ ok: false, error: error.message || String(error) }),
      );
    return true;
  }

  if (message?.type !== "RUN_SHELL_BLOCK") return false;

  const senderUrl = sender.tab?.url || sender.url || "";
  if (!senderUrl.startsWith(`${DEEPSEEK_ORIGIN}/`)) {
    sendResponse({ ok: false, error: "Commands are accepted only from DeepSeek." });
    return false;
  }

  if (
    typeof message.command !== "string" ||
    !message.command.trim() ||
    message.command.length > MAX_COMMAND_LENGTH ||
    !["bash", "pwsh"].includes(message.shell)
  ) {
    sendResponse({ ok: false, error: "Invalid shell command block." });
    return false;
  }

  getOptions()
    .then(async (options) => {
      if (!options.autoRun) {
        return { ok: false, error: "Automatic command execution is disabled." };
      }

      if (activePort === null) await findBridge();
      const response = await fetch(`http://127.0.0.1:${activePort}/execute`, {
        method: "POST",
        signal: AbortSignal.timeout(BRIDGE_REQUEST_TIMEOUT_MS),
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          shell: message.shell,
          command: message.command,
          cwd: options.projectDir || undefined,
        }),
      });
      const result = await response.json();
      if (!response.ok || result.ok !== true) {
        if (response.status >= 500) activePort = null;
        throw new Error(result.error || `Local bridge returned HTTP ${response.status}`);
      }
      return { ok: true, result };
    })
    .then(sendResponse)
    .catch((error) =>
      sendResponse({ ok: false, error: error.message || String(error) }),
    );

  return true;
});
