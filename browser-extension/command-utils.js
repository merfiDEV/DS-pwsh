(() => {
  function collectCommands(blocks, getShell, getCommand) {
    return blocks
      .map((block) => ({
        block,
        shell: getShell(block),
        command: getCommand(block),
      }))
      .filter(({ shell, command }) => shell && typeof command === "string" && command.trim());
  }

  async function runSequentially(items, execute) {
    const results = [];
    for (const [index, item] of items.entries()) {
      try {
        results.push({
          item,
          result: await execute(item, index + 1, items.length),
        });
      } catch (error) {
        results.push({ item, error });
      }
    }
    return results;
  }

  function formatResults(results) {
    const formatted = results
      .map(({ shell, result, error }, index) => {
        if (error) {
          return [`[DS-pwsh terminal: command ${index + 1}, ${shell}, error]`, error].join("\n");
        }
        const code = Number.isInteger(result.exitCode) ? result.exitCode : 1;
        const rawOutput = result.output || "(no output)";
        const output =
          rawOutput.length > 48_000
            ? `${rawOutput.slice(0, 48_000)}\n[chat result truncated]`
            : rawOutput;
        return [
          `[DS-pwsh terminal: command ${index + 1}, ${shell}, exit code ${code}]`,
          `Output:\n${output}`,
        ].join("\n\n");
      })
      .join("\n\n");
    return formatted.length > 48_000
      ? `${formatted.slice(0, 48_000)}\n[chat result truncated]`
      : formatted;
  }

  const api = { collectCommands, formatResults, runSequentially };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    globalThis.DSPwshCommandUtils = api;
  }
})();
