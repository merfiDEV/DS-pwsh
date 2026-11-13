(() => {
  const RUN_DELAY_MS = 2200;
  const COMMAND_RESPONSE_TIMEOUT_MS = 260_000;
  const handledBlocks = new WeakSet();
  const handledMessages = new WeakSet();
  const scheduledMessages = new WeakMap();
  const knownUserMessages = new WeakSet();
  const pendingResults = [];
  let toastTimer;
  let awaitingAssistant = false;
  let awaitingNewUserMessage = false;
  let lastUserMessage = null;
  let pendingUserText = "";

  const inputSelectors = [
    'textarea[placeholder*="message" i]',
    'textarea[placeholder*="输入"]',
    "textarea.chat-input",
    "textarea",
    'div[contenteditable="true"]',
    '[role="textbox"]',
  ];

  const sendSelectors = [
    'button[aria-label*="send" i]',
    'button[aria-label*="发送"]',
    'button[title*="send" i]',
    'button[title*="发送"]',
    '[role="button"][aria-label*="send" i]',
    '[role="button"][aria-label*="发送"]',
    '[role="button"][title*="send" i]',
    '[role="button"][title*="发送"]',
    ".submit-btn",
    ".send-btn",
    '[data-testid*="send" i]',
    '[data-testid*="submit" i]',
  ];
  const actionControlSelector = 'button, [role="button"], input[type="submit"]';

  function showToast(message, isError = false) {
    let toast = document.getElementById("ds-pwsh-terminal-bridge-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "ds-pwsh-terminal-bridge-toast";
      toast.style.cssText = [
        "position:fixed",
        "right:20px",
        "bottom:20px",
        "z-index:2147483647",
        "max-width:380px",
        "padding:12px 16px",
        "border-radius:10px",
        "font:13px/1.45 system-ui,sans-serif",
        "color:#e6e6e6",
        "background:#222222",
        "box-shadow:0 8px 32px #0008",
      ].join(";");
      document.documentElement.appendChild(toast);
    }
    toast.style.border = isError ? "1px solid #8a8a8a" : "1px solid #666666";
    toast.textContent = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.remove(), 6000);
  }

  function extensionErrorMessage(error) {
    const message = error?.message || String(error);
    return /extension context invalidated|context invalidated/i.test(message)
      ? "Расширение было перезагружено. Обновите вкладку DeepSeek и повторите команду; команда не запускалась."
      : message;
  }

  function isUserMessage(node) {
    let current = node;
    while (current && current !== document.body) {
      const role =
        current.getAttribute?.("data-role") ||
        current.getAttribute?.("data-author") ||
        current.getAttribute?.("data-message-type") ||
        "";
      if (/user|human/i.test(role)) return true;
      const className =
        typeof current.className === "string" ? current.className : "";
      if (/(?:^|[-_\s])(?:user|human)(?:$|[-_\s])|user-message|message-user/i.test(className)) return true;
      current = current.parentElement;
    }
    const text = (node.textContent || node.innerText || "").slice(0, 200);
    return (
      text.includes("我已选择目录：") ||
      text.includes("系统提示词：") ||
      text.includes("工具使用规则：")
    );
  }

  const MESSAGE_SELECTOR =
    ".ds-message, [data-role='assistant'], [data-author='assistant'], [data-role='user'], [data-author='user'], [data-message-type]";

  function messageElements(root = document) {
    const messages = Array.from(root.querySelectorAll(MESSAGE_SELECTOR));
    if (root instanceof Element && root.matches(MESSAGE_SELECTOR)) messages.unshift(root);
    return [...new Set(messages)];
  }

  function rememberExistingUserMessages() {
    for (const message of messageElements()) {
      if (!isUserMessage(message)) continue;
      knownUserMessages.add(message);
      lastUserMessage = message;
    }
  }

  function observeUserMessages(root) {
    for (const message of messageElements(root)) {
      const matchesPendingText =
        awaitingNewUserMessage &&
        pendingUserText.length > 3 &&
        (message.textContent || "").includes(pendingUserText);
      if ((!isUserMessage(message) && !matchesPendingText) || knownUserMessages.has(message)) continue;
      knownUserMessages.add(message);
      lastUserMessage = message;
      awaitingAssistant = true;
      awaitingNewUserMessage = false;
      pendingUserText = "";
    }
  }

  function getShell(pre) {
    const code = pre.matches?.("code") ? pre : pre.querySelector("code");
    const sources = [code, pre, pre.closest("div[data-language]")].filter(Boolean);
    let language = "";
    for (const element of sources) {
      language =
        element.getAttribute("data-language") ||
        Array.from(element.classList || [])
          .map((name) => name.match(/^language-(.+)$/i)?.[1] || "")
          .find(Boolean) ||
        "";
      if (language) break;
    }

    if (!language) {
      const block = pre.closest(".md-code-block");
      const banner = block?.querySelector(".md-code-block-banner");
      if (banner) {
        for (const label of banner.querySelectorAll("span")) {
          if (label.closest("button")) continue;
          const value = label.textContent.trim();
          if (/^[a-zA-Z0-9_+#.-]{1,20}$/.test(value)) {
            language = value;
            break;
          }
        }
      }
    }

    const normalized = language.toLowerCase().trim();
    if (["bash", "sh", "shell", "zsh"].includes(normalized)) return "bash";
    if (["pwsh", "powershell", "powershellcore", "ps1"].includes(normalized)) {
      return "pwsh";
    }
    return "";
  }

  function getCommand(pre) {
    const code = pre.matches?.("code") ? pre : pre.querySelector("code");
    const source = code || pre;
    return globalThis.DSPwshCommandUtils.normalizeCommand(
      source.innerText || source.textContent || "",
    );
  }

  function latestAssistantMessage() {
    const messages = messageElements();
    const lastUserIndex = lastUserMessage ? messages.indexOf(lastUserMessage) : -1;
    return messages
      .slice(lastUserIndex + 1)
      .filter((message) => !isUserMessage(message))
      .at(-1) || null;
  }

  function blockSignature(root) {
    return getCodeBlocks(root)
      .map((block) => `${getShell(block)}\n${getCommand(block)}`)
      .join("\n---\n");
  }

  function getCodeBlocks(root) {
    const preBlocks = Array.from(root.querySelectorAll("pre"));
    if (preBlocks.length) return preBlocks;

    const languageBlocks = Array.from(
      root.querySelectorAll("code[class*='language-'], code[class*='lang-']"),
    );
    if (languageBlocks.length) return languageBlocks;

    const markdownBlocks = Array.from(
      root.querySelectorAll(".md-code-block, [class*='code-block']"),
    ).filter((block) => block.querySelector("code"));
    if (markdownBlocks.length) return markdownBlocks;

    return Array.from(root.querySelectorAll("[data-language], [data-lang]"))
      .filter((block) => block.querySelector("code"));
  }

  function scheduleBlock(pre) {
    if (!awaitingAssistant || handledBlocks.has(pre) || isUserMessage(pre)) return;
    if (!getShell(pre)) return;
    const message = pre.closest(
      ".ds-message, [data-role='assistant'], [data-author='assistant'], [data-testid*='message'], [class*='message-content']",
    );
    if (message && handledMessages.has(message)) return;
    const scope = message || pre;
    const signature = blockSignature(message || pre);
    const previous = scheduledMessages.get(scope);
    if (previous?.signature === signature) return;
    if (previous) clearTimeout(previous.timer);

    const timer = setTimeout(() => {
      scheduledMessages.delete(scope);
      if (!pre.isConnected || isUserMessage(pre)) return;
      if (blockSignature(message || pre) !== signature) {
        scheduleBlock(pre);
        return;
      }

      const blocks = message
        ? getCodeBlocks(message)
        : [pre];
      const commands = globalThis.DSPwshCommandUtils.collectCommands(
        blocks.filter(
          (block) => !handledBlocks.has(block) && !isUserMessage(block),
        ),
        getShell,
        getCommand,
      );
      if (!commands.length) return;

      for (const { block } of commands) handledBlocks.add(block);
      if (message) {
        handledMessages.add(message);
      }
      awaitingAssistant = false;
      executeCommands(commands);
    }, RUN_DELAY_MS);
    scheduledMessages.set(scope, { timer, signature });
  }

  function findInput() {
    for (const selector of inputSelectors) {
      const element = document.querySelector(selector);
      if (element && element.getClientRects().length > 0) return element;
    }
    return null;
  }

  function findSendButton() {
    const isAvailable = (control) =>
      control.getClientRects().length > 0 &&
      !control.disabled &&
      control.getAttribute("aria-disabled") !== "true";
    const input = findInput();
    if (!input) return null;
    const form = input.closest("form");
    const formSubmit = form?.querySelector(
      'button[type="submit"], input[type="submit"]',
    );
    if (formSubmit && isAvailable(formSubmit)) return formSubmit;

    let scope = input.parentElement;
    for (let depth = 0; scope && depth < 8; depth += 1) {
      const labelledControls = Array.from(
        scope.querySelectorAll(sendSelectors.join(",")),
      ).filter(isAvailable);
      if (labelledControls.length) return labelledControls.at(-1);

      const controls = Array.from(
        scope.querySelectorAll(actionControlSelector),
      ).filter(isAvailable);
      if (controls.length > 0 && controls.length <= 3) {
        return controls.at(-1);
      }
      scope = scope.parentElement;
    }
    return (
      Array.from(document.querySelectorAll(sendSelectors.join(",")))
        .filter(isAvailable)
        .at(-1) || null
    );
  }

  function getInputText(input) {
    return input.isContentEditable ? input.textContent || "" : input.value || "";
  }

  function setInputText(input, value) {
    if (input.isContentEditable) {
      input.focus();
      input.replaceChildren(document.createTextNode(value));
    } else {
      const setter = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(input),
        "value",
      )?.set;
      if (!setter) throw new Error("Could not update DeepSeek's message field.");
      setter.call(input, value);
    }
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function deliverPendingResults() {
    if (!pendingResults.length) return;
    const input = findInput();
    const result = pendingResults[0];
    if (result.delivering) return;
    if (!input || getInputText(input).trim()) {
      if (!result.waitingNotified) {
        result.waitingNotified = true;
        showToast(
          `${input ? "Команда выполнена, но поле чата занято" : "Команда выполнена, но поле чата не найдено"}. ${result.summary} Результат сохранён для отправки.`,
          true,
        );
      }
      return;
    }

    try {
      setInputText(input, result.message);
    } catch (error) {
      showToast(error.message || String(error), true);
      return;
    }

    submitPendingResult(result);
  }

  function submitPendingResult(result, attempt = 0) {
    if (attempt === 0) result.delivering = true;
    setTimeout(() => {
      const input = findInput();
      if (!input || getInputText(input) !== result.message) {
        result.delivering = false;
        showToast("Поле ввода изменилось; результат ожидает отправки.", true);
        return;
      }

      const button = findSendButton();
      if (!button) {
        if (attempt < 20) {
          submitPendingResult(result, attempt + 1);
          return;
        }
        pendingResults.shift();
        const form = input.closest("form");
        try {
          if (form?.requestSubmit) {
            form.requestSubmit();
          } else {
            input.focus();
            input.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: "Enter",
                code: "Enter",
                bubbles: true,
                cancelable: true,
              }),
            );
            input.dispatchEvent(
              new KeyboardEvent("keyup", {
                key: "Enter",
                code: "Enter",
                bubbles: true,
                cancelable: true,
              }),
            );
          }
        } catch (error) {
          showToast(error.message || String(error), true);
          return;
        }
        setTimeout(() => {
          if (getInputText(input).trim() !== result.message) {
            showToast("Результат отправлен в чат.");
            return;
          }
          showToast("Кнопка отправки не найдена. Результат оставлен в поле ввода.", true);
        }, 500);
        return;
      }

      button.click();
      const confirmSend = (check = 0) => {
        setTimeout(() => {
          if (getInputText(input).trim() !== result.message) {
            pendingResults.shift();
            showToast("Результат отправлен в чат.");
            return;
          }
          if (check < 5) {
            confirmSend(check + 1);
            return;
          }
          pendingResults.shift();
          showToast(
            "Не удалось подтвердить отправку. Результат оставлен в поле ввода.",
            true,
          );
        }, 200);
      };
      confirmSend();
    }, 100);
  }

  function summarizeResults(results) {
    return results
      .map(({ result, error }, index) => {
        if (error) return `#${index + 1}: error`;
        const output = (result.output || "(no output)")
          .replace(/\s+/g, " ")
          .trim();
        const excerpt = output.length > 100 ? `${output.slice(0, 100)}…` : output;
        return `#${index + 1}: code ${result.exitCode}, ${excerpt}`;
      })
      .join(" · ");
  }

  function confirmCommand(block, index, total) {
    return new Promise((resolve) => {
      const dialog = document.createElement("dialog");
      dialog.setAttribute("aria-labelledby", "ds-pwsh-confirm-title");
      dialog.style.cssText = [
        "width:min(560px,calc(100vw - 32px))",
        "max-width:560px",
        "padding:20px",
        "border:1px solid #555",
        "border-radius:12px",
        "color:#e6e6e6",
        "background:#222",
        "font:14px/1.5 system-ui,sans-serif",
        "box-shadow:0 20px 70px #000b",
      ].join(";");

      const title = document.createElement("h2");
      title.id = "ds-pwsh-confirm-title";
      title.textContent = `Разрешить команду ${index} из ${total}?`;
      title.style.cssText = "margin:0 0 6px;font-size:17px";

      const description = document.createElement("p");
      description.textContent = `Оболочка: ${block.shell}. Команда запустится с правами текущего пользователя.`;
      description.style.cssText = "margin:0 0 12px;color:#aaa";

      const preview = document.createElement("pre");
      preview.textContent = block.command;
      preview.style.cssText = [
        "max-height:40vh",
        "overflow:auto",
        "margin:0 0 16px",
        "padding:12px",
        "border:1px solid #444",
        "border-radius:8px",
        "background:#161616",
        "color:#eee",
        "white-space:pre-wrap",
        "overflow-wrap:anywhere",
        "font:12px/1.5 ui-monospace,monospace",
      ].join(";");

      const actions = document.createElement("form");
      actions.method = "dialog";
      actions.style.cssText = "display:flex;justify-content:flex-end;gap:8px";
      const skip = document.createElement("button");
      skip.type = "submit";
      skip.value = "skip";
      skip.textContent = "Пропустить";
      const run = document.createElement("button");
      run.type = "submit";
      run.value = "run";
      run.textContent = "Выполнить";
      for (const button of [skip, run]) {
        button.style.cssText =
          "min-height:38px;padding:8px 14px;border:1px solid #555;border-radius:7px;color:#eee;background:#333;font:inherit;cursor:pointer";
      }
      run.style.background = "#555";
      actions.append(skip, run);
      dialog.append(title, description, preview, actions);

      dialog.addEventListener(
        "close",
        () => {
          dialog.remove();
          resolve(dialog.returnValue === "run");
        },
        { once: true },
      );
      document.body.append(dialog);
      try {
        dialog.showModal();
      } catch (error) {
        dialog.remove();
        showToast(
          `Не удалось показать подтверждение; команда не запущена: ${error.message || String(error)}`,
          true,
        );
        resolve(false);
      }
    });
  }

  function sendCommand(runtime, block, index, total) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        settled = true;
        reject(
          new Error(
            `Команда ${index} из ${total}: мост не ответил за 260 секунд.`,
          ),
        );
      }, COMMAND_RESPONSE_TIMEOUT_MS);

      try {
        runtime.sendMessage(
          {
            type: "RUN_SHELL_BLOCK",
            shell: block.shell,
            command: block.command,
          },
          (response) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            if (runtime.lastError) {
              reject(new Error(runtime.lastError.message));
              return;
            }
            if (!response?.ok) {
              reject(new Error(response?.error || "Не удалось выполнить команду."));
              return;
            }
            if (
              !response.result ||
              typeof response.result.output !== "string" ||
              !Number.isInteger(response.result.exitCode)
            ) {
              reject(new Error("Мост вернул ответ без кода завершения или вывода."));
              return;
            }
            resolve(response.result);
          },
        );
      } catch (error) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  async function executeCommands(commands) {
    const runtime = globalThis.chrome?.runtime || globalThis.browser?.runtime;
    if (!runtime || typeof runtime.sendMessage !== "function") {
      showToast(
        "Нет связи с API расширения. Перезагрузите DS-pwsh на chrome://extensions, затем обновите вкладку DeepSeek. Команды не запускались.",
        true,
      );
      return;
    }

    let confirmCommands;
    try {
      const storage =
        globalThis.chrome?.storage || globalThis.browser?.storage;
      if (!storage?.local?.get) {
        throw new Error("Настройки подтверждения недоступны.");
      }
      const options = await storage.local.get({ confirmCommands: true });
      confirmCommands = options.confirmCommands === true;
    } catch (error) {
      showToast(
        `Не удалось проверить настройки подтверждения; команды не запущены: ${extensionErrorMessage(error)}`,
        true,
      );
      return;
    }

    const results = await globalThis.DSPwshCommandUtils.runSequentially(
      commands,
      async (block, index, total) => {
        if (
          confirmCommands &&
          !(await confirmCommand(block, index, total))
        ) {
          throw new Error("Пропущено пользователем; команда не запускалась.");
        }
        showToast(
          `Выполняется команда ${index}/${total} (${block.shell})…`,
        );
        return sendCommand(runtime, block, index, total);
      },
    );

    const formattedResults = results.map(({ item, result, error }) => ({
      shell: item.shell,
      result,
      error: error?.message || (error ? String(error) : ""),
    }));
    const summary = summarizeResults(formattedResults);
    showToast(`Готово: ${commands.length} команд. ${summary}`);
    pendingResults.push({
      message: globalThis.DSPwshCommandUtils.formatResults(formattedResults),
      summary,
    });
    deliverPendingResults();
  }

  function scanNode(node, includeDescendants = true) {
    if (!(node instanceof Element)) return;
    observeUserMessages(node);
    const blocks = new Set();
    const candidates = [
      "pre",
      "code[class*='language-']",
      "code[class*='lang-']",
      ".md-code-block",
      "[class*='code-block']",
      "[data-language]",
      "[data-lang]",
    ].join(",");
    if (node.matches(candidates)) blocks.add(node);
    const parentBlock = node.closest(
      "pre, code[class*='language-'], code[class*='lang-'], .md-code-block, [class*='code-block'], [data-language], [data-lang]",
    );
    if (parentBlock) blocks.add(parentBlock);
    if (includeDescendants) {
      for (const block of node.querySelectorAll(candidates)) blocks.add(block);
    }
    for (const block of blocks) {
      if ((block.matches("pre, code") || block.querySelector("pre, code")) && getShell(block)) {
        scheduleBlock(block);
      }
    }
  }

  function onUserSend(event) {
    if (event.type === "keydown") {
      if (
        event.key !== "Enter" ||
        event.shiftKey ||
        event.isComposing ||
        !event.target.matches?.(inputSelectors.join(","))
      ) {
        return;
      }
    } else {
      const explicitButton = event.target.closest?.(sendSelectors.join(","));
      if (!explicitButton) {
        const input = findInput();
        const clickedControl = event.target.closest?.(
          'button, [role="button"], input[type="submit"]',
        );
        const form = input?.closest("form");
        let clickedComposerControl = Boolean(
          input &&
            clickedControl &&
            form &&
            (form === clickedControl || form.contains(clickedControl)),
        );
        let scope = input?.parentElement;
        for (let depth = 0; scope && depth < 6 && !clickedComposerControl; depth += 1) {
          clickedComposerControl = scope.contains(clickedControl);
          scope = scope.parentElement;
        }
        const inferredSendControl =
          input &&
          getInputText(input).trim() &&
          clickedControl &&
          clickedComposerControl;
        if (!inferredSendControl) {
          return;
        }
      }
    }
    const input = findInput();
    pendingUserText = input ? getInputText(input).trim() : "";
    awaitingAssistant = true;
    awaitingNewUserMessage = true;
  }

  rememberExistingUserMessages();

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) scanNode(node);
      const target =
        mutation.target instanceof Element
          ? mutation.target
          : mutation.target.parentElement;
      if (target) scanNode(target, false);
    }
    deliverPendingResults();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["class", "data-language"],
  });

  // DeepSeek иногда заполняет уже существующий узел и теряет ожидаемые
  // MutationObserver-события. Периодически перечитываем последнюю реплику,
  // как делает Cookie-code, и запускаем только после стабильной паузы.
  setInterval(() => {
    if (!awaitingAssistant || awaitingNewUserMessage) return;
    const message = latestAssistantMessage();
    if (!message) return;
    for (const block of getCodeBlocks(message)) scheduleBlock(block);
  }, 700);

  document.addEventListener("click", onUserSend, true);
  document.addEventListener("submit", () => {
    awaitingAssistant = true;
    awaitingNewUserMessage = true;
  }, true);
  document.addEventListener("keydown", onUserSend, true);
  document.addEventListener("input", deliverPendingResults, true);
})();
