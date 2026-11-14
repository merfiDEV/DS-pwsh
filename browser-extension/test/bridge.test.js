"use strict";

const assert = require("node:assert/strict");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const {
  createBridgeServer,
  configuredMinimumSendDelay,
  executeCommand,
  listenOnAvailablePort,
  shellForPlatform,
  validateExecutionRequest,
} = require("../bridge/host");

const EXTENSION_ORIGIN = "chrome-extension://emfnepkalgoobcinjmjfmjigikeamfpj";
const OPAQUE_ORIGIN = "null";
function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test("shell matches the operating system", () => {
  assert.equal(shellForPlatform("win32"), "pwsh");
  assert.equal(shellForPlatform("linux"), "bash");
  assert.equal(shellForPlatform("darwin"), "bash");
});

test("minimum send delay defaults to zero and accepts bounded settings", () => {
  assert.equal(configuredMinimumSendDelay(undefined), 0);
  assert.equal(configuredMinimumSendDelay("0"), 0);
  assert.equal(configuredMinimumSendDelay("7500"), 7_500);
  assert.equal(configuredMinimumSendDelay("180000"), 180_000);
  assert.throws(() => configuredMinimumSendDelay("-1"), /must be an integer from 0/);
  assert.throws(() => configuredMinimumSendDelay("not-a-number"), /must be an integer from 0/);
  assert.throws(() => configuredMinimumSendDelay("180001"), /must be an integer from 0/);
});

test("execution rejects a mismatched shell and invalid working directory", () => {
  assert.throws(
    () => validateExecutionRequest({ shell: "pwsh", command: "echo no" }, { platform: "linux" }),
    /accepts bash commands only/,
  );
  assert.throws(
    () => validateExecutionRequest({ shell: "bash", command: " " }, { platform: "linux" }),
    /Command must contain/,
  );
  assert.throws(
    () =>
      validateExecutionRequest(
        {
          shell: "bash",
          command: "echo no",
          cwd: path.join(os.tmpdir(), "missing-cookie-project"),
        },
        { platform: "linux" },
      ),
    /Working directory does not exist/,
  );
});

test("bridge picks the next port when the first one is busy", async () => {
  const occupied = net.createServer();
  const occupiedPort = await listen(occupied);
  const bridge = createBridgeServer({ platform: "linux", defaultCwd: process.cwd() });
  try {
    const port = await listenOnAvailablePort(bridge, {
      host: "127.0.0.1",
      startPort: occupiedPort,
      endPort: occupiedPort + 1,
    });
    assert.equal(port, occupiedPort + 1);
  } finally {
    await close(bridge);
    await close(occupied);
  }
});

test("bridge reports the dynamically selected port and shell", async (t) => {
  const server = createBridgeServer({
    platform: "linux",
    defaultCwd: process.cwd(),
    minimumSendDelayMs: 5_000,
  });
  const port = await listenOnAvailablePort(server);
  t.after(() => close(server));

  const response = await fetch(`http://127.0.0.1:${port}/health`, {
    headers: { Origin: EXTENSION_ORIGIN },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    service: "ds-pwsh-terminal-bridge",
    platform: "linux",
    shell: "bash",
    cwd: process.cwd(),
    minimumSendDelayMs: 5_000,
  });
});

test("opaque origins can discover health but cannot execute commands", async (t) => {
  const server = createBridgeServer({
    platform: "linux",
    defaultCwd: process.cwd(),
    minimumSendDelayMs: 0,
  });
  const port = await listen(server);
  t.after(() => close(server));

  const response = await fetch(`http://127.0.0.1:${port}/health`, {
    headers: { Origin: OPAQUE_ORIGIN },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), OPAQUE_ORIGIN);

  const commandResponse = await fetch(`http://127.0.0.1:${port}/execute`, {
    method: "POST",
    headers: {
      Origin: OPAQUE_ORIGIN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ shell: "bash", command: "printf should-not-run" }),
  });
  assert.equal(commandResponse.status, 403);
  assert.deepEqual(await commandResponse.json(), {
    ok: false,
    error: "Origin is not allowed.",
  });
});

test("bridge health discovery works when the browser omits Origin", async (t) => {
  const server = createBridgeServer({
    platform: "linux",
    defaultCwd: process.cwd(),
  });
  const port = await listen(server);
  t.after(() => close(server));

  const response = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal((await response.json()).service, "ds-pwsh-terminal-bridge");
});

test("bridge executes a command and returns its output", async (t) => {
  const server = createBridgeServer({
    platform: "linux",
    defaultCwd: process.cwd(),
    minimumSendDelayMs: 0,
  });
  const port = await listen(server);
  t.after(() => close(server));

  const response = await fetch(`http://127.0.0.1:${port}/execute`, {
    method: "POST",
    headers: {
      Origin: EXTENSION_ORIGIN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      shell: "bash",
      command: 'echo "Привет! DS-pwsh на связи."',
    }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    exitCode: 0,
    output: "Привет! DS-pwsh на связи.",
  });
});

test("bash receives commands through stdin without changing shell syntax or long arguments", async () => {
  const longArgument = `/${"very-long-path-segment-".repeat(500)}file.bak`;
  const command = [
    'echo "a b"',
    'bash -c "echo hello-dash"',
    "x=1; echo $x",
    'printf \'%s\\n\' "$(printf nested)"',
    "echo 'quoted'",
    `printf '%s' '${longArgument}'`,
  ].join("\n");

  const result = await executeCommand(
    { shell: "bash", command, cwd: process.cwd() },
    { timeoutMs: 5_000 },
  );

  assert.equal(result.exitCode, 0);
  assert.equal(
    result.output,
    `a b\nhello-dash\n1\nnested\nquoted\n${longArgument}`,
  );
});

test("bridge returns command results immediately and exposes the client send delay", async (t) => {
  const server = createBridgeServer({
    platform: "linux",
    defaultCwd: process.cwd(),
    minimumSendDelayMs: 40,
  });
  const port = await listen(server);
  t.after(() => close(server));

  const health = await fetch(`http://127.0.0.1:${port}/health`, {
    headers: { Origin: EXTENSION_ORIGIN },
  });
  assert.equal((await health.json()).minimumSendDelayMs, 40);

  const startedAt = Date.now();
  const response = await fetch(`http://127.0.0.1:${port}/execute`, {
    method: "POST",
    headers: {
      Origin: EXTENSION_ORIGIN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ shell: "bash", command: "printf delayed" }),
  });

  assert.equal(response.status, 200);
  assert.ok(Date.now() - startedAt < 35, "bridge should not hold the command response");
  assert.equal((await response.json()).output, "delayed");
});

test("bridge rejects requests from other origins", async (t) => {
  const server = createBridgeServer({
    platform: "linux",
    defaultCwd: process.cwd(),
  });
  const port = await listen(server);
  t.after(() => close(server));

  const response = await fetch(`http://127.0.0.1:${port}/health`, {
    headers: { Origin: "https://example.com" },
  });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "Origin is not allowed.",
  });
});
