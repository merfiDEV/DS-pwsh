"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  collectCommands,
  formatResults,
  runSequentially,
} = require("../command-utils");

test("collectCommands preserves command text exactly", () => {
  const command = '  - echo "a b"; x=$(printf \'raw\')\n  echo done  \n';
  const commands = collectCommands(
    [{ shell: "bash", command }],
    (block) => block.shell,
    (block) => block.command,
  );

  assert.equal(commands[0].command, command);
});

test("collectCommands finds all supported blocks in message order", () => {
  const blocks = [
    { shell: "bash", command: "- echo first" },
    { shell: "text", command: "not a command" },
    { shell: "bash", command: "printf second" },
  ];
  const commands = collectCommands(
    blocks,
    (block) => (block.shell === "bash" ? block.shell : ""),
    (block) => block.command,
  );

  assert.deepEqual(
    commands.map(({ command }) => command),
    ["- echo first", "printf second"],
  );
  assert.deepEqual(
    commands.map(({ block }) => block),
    [blocks[0], blocks[2]],
  );
});

test("runSequentially waits for each command and preserves order", async () => {
  const calls = [];
  let active = 0;
  let maximumActive = 0;

  const results = await runSequentially(["first", "second", "third"], async (item) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    calls.push(`start:${item}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
    calls.push(`end:${item}`);
    active -= 1;
    return `${item}-result`;
  });

  assert.equal(maximumActive, 1);
  assert.deepEqual(calls, [
    "start:first",
    "end:first",
    "start:second",
    "end:second",
    "start:third",
    "end:third",
  ]);
  assert.deepEqual(
    results.map(({ result }) => result),
    ["first-result", "second-result", "third-result"],
  );
});

test("runSequentially continues after an individual command fails", async () => {
  const results = await runSequentially(["first", "second"], async (item) => {
    if (item === "first") throw new Error("failed");
    return "completed";
  });

  assert.equal(results[0].error.message, "failed");
  assert.equal(results[1].result, "completed");
});

test("formatResults combines outputs without echoing model commands", () => {
  const message = formatResults([
    {
      shell: "bash",
      result: { exitCode: 0, output: "first output" },
    },
    {
      shell: "bash",
      result: { exitCode: 0, output: "second output" },
    },
  ]);

  assert.match(message, /command 1, bash, exit code 0/);
  assert.match(message, /command 2, bash, exit code 0/);
  assert.match(message, /first output/);
  assert.match(message, /second output/);
  assert.doesNotMatch(message, /echo first|printf second/);
});
