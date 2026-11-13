function buildInstruction(platform, confirmCommands) {
  const isWindows = platform === "win32";
  const availableShells = isWindows
    ? "cmd.exe и PowerShell (pwsh)"
    : "bash";
  const codeFence = isWindows ? "pwsh" : "bash";
  const windowsNote = isWindows
    ? "Расширение выполняет команды из блоков pwsh; если нужна команда cmd.exe, запускай её через cmd.exe /c внутри PowerShell."
    : "";
  const executionNote = confirmCommands
    ? "Каждая команда показывается в окне подтверждения и запускается только после явного разрешения пользователя."
    : "Каждая команда в отдельном блоке bash/pwsh запускается сразу, без дополнительного подтверждения.";

  return [
    "Ты — DS-pwsh. Единственный доступный инструмент — терминал с оболочкой этой ОС.",
    `Доступные оболочки: только ${availableShells}; никаких других инструментов, JavaScript, браузерных API, редакторов или файловых API.`,
    "Читай, создавай, изменяй, переименовывай и удаляй файлы исключительно командами в терминале. Не используй никакие инструменты для прямого чтения или редактирования файлов.",
    `Каждую команду оформляй отдельным блоком \`\`\`${codeFence}. Можно выдать несколько таких блоков в одном ответе: расширение выполнит их строго по очереди и вернёт все результаты одним сообщением. Не жди результата между блоками и не добавляй дефисы/маркеры списка перед командами внутри блока.`,
    executionNote,
    "Будь осторожен: команды выполняются с правами текущего пользователя. Перед выдачей проверь каждую команду, не используй разрушительные или не относящиеся к задаче действия и объясняй рискованные операции заранее.",
    windowsNote,
    "Рабочая папка уже установлена. Выполняй только безопасные команды, необходимые для текущей задачи.",
  ]
    .filter(Boolean)
    .join(" ");
}

async function getPlatform() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "GET_BRIDGE_STATUS",
    });
    if (response?.ok && typeof response.status?.platform === "string") {
      return response.status.platform;
    }
  } catch (error) {
    console.warn("Could not read the bridge platform; using browser platform.", error);
  }
  const browserPlatform =
    navigator.userAgentData?.platform || navigator.platform || "";
  return /^win/i.test(browserPlatform) ? "win32" : "linux";
}

async function loadOptions() {
  const options = await chrome.storage.local.get({
    autoRun: true,
    confirmCommands: true,
    projectDir: "",
    sendDelayMs: 5000,
  });
  document.getElementById("auto-run").checked = options.autoRun === true;
  document.getElementById("confirm-commands").checked =
    options.confirmCommands === true;
  document.getElementById("project-dir").value = options.projectDir || "";
  const delaySeconds = Math.round((Number(options.sendDelayMs) || 0) / 1000);
  document.getElementById("send-delay").value = String(delaySeconds);
}

async function saveSettings({ includeProjectDir = false } = {}) {
  const rawDelay = Number(document.getElementById("send-delay").value);
  const clampedDelaySeconds = Number.isFinite(rawDelay)
    ? Math.min(180, Math.max(0, Math.round(rawDelay)))
    : 5;
  document.getElementById("send-delay").value = String(clampedDelaySeconds);
  const values = {
    autoRun: document.getElementById("auto-run").checked,
    confirmCommands: document.getElementById("confirm-commands").checked,
    sendDelayMs: clampedDelaySeconds * 1000,
  };
  if (includeProjectDir) {
    values.projectDir = document.getElementById("project-dir").value.trim();
  }
  await chrome.storage.local.set(values);
  return values;
}

function showNotice(message, isError = false) {
  const notice = document.getElementById("notice");
  notice.textContent = message;
  notice.classList.toggle("error", isError);
}

async function updateBridgeStatus() {
  const dot = document.getElementById("status-dot");
  const title = document.getElementById("status-title");
  const detail = document.getElementById("status-detail");

  try {
    const response = await chrome.runtime.sendMessage({
      type: "GET_BRIDGE_STATUS",
    });
    if (!response?.ok) throw new Error(response?.error || "Мост недоступен");
    const status = response.status;
    if (dot) dot.className = "status-dot online";
    title.textContent = `Подключено · ${status.shell}`;
    detail.textContent = `127.0.0.1:${status.port} · ${status.cwd}`;
  } catch (error) {
    if (dot) dot.className = "status-dot offline";
    title.textContent = "Нет подключения к мосту";
    detail.textContent =
      error?.message || "Запустите локальный bridge из папки проекта.";
  }
}

document.getElementById("save").addEventListener("click", async () => {
  try {
    await saveSettings({ includeProjectDir: true });
    showNotice("Настройки сохранены.");
    updateBridgeStatus();
  } catch (error) {
    showNotice(`Не удалось сохранить настройки: ${error.message || String(error)}`, true);
  }
});

for (const id of ["auto-run", "confirm-commands", "send-delay"]) {
  document.getElementById(id).addEventListener("change", async () => {
    try {
      await saveSettings();
      showNotice("Настройка применена сразу.");
    } catch (error) {
      showNotice(`Не удалось применить настройку: ${error.message || String(error)}`, true);
    }
  });
}

document
  .getElementById("copy-instructions")
  .addEventListener("click", async () => {
    try {
      const platform = await getPlatform();
      const confirmCommands = document.getElementById("confirm-commands").checked;
      await navigator.clipboard.writeText(
        buildInstruction(platform, confirmCommands),
      );
      showNotice("Инструкция скопирована. Вставьте её в чат DeepSeek.");
    } catch (error) {
      showNotice(`Не удалось скопировать инструкцию: ${error.message || String(error)}`, true);
    }
  });

const deleteDialog = document.getElementById("delete-confirm");
document.getElementById("delete-current-chat").addEventListener("click", () => {
  deleteDialog.showModal();
});
document.getElementById("cancel-delete").addEventListener("click", () => {
  deleteDialog.close();
});
document.getElementById("confirm-delete").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  showNotice("Удаляю текущий чат…");
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id) throw new Error("Не найдена активная вкладка браузера.");
    const response = await chrome.tabs.sendMessage(tab.id, { type: "DELETE_CURRENT_CHAT" });
    if (!response?.ok) throw new Error(response?.error || "Не удалось удалить чат.");
    deleteDialog.close();
    showNotice("Чат удалён из истории DeepSeek.");
  } catch (error) {
    showNotice(`${error.message || String(error)} Проверь, что открыта вкладка DeepSeek, затем перезагрузи её.`, true);
  } finally {
    button.disabled = false;
  }
});

loadOptions();
updateBridgeStatus();
