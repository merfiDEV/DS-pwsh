"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { isBrowserRunning } = require("../bridge/browser");

test("detects a running browser when a known process is present", () => {
  const list = ["node", "bash", "chrome", "Xorg"];
  assert.strictEqual(isBrowserRunning(list), true);
});

test("returns false when no browser process is present", () => {
  const list = ["node", "bash", "vim", "Xorg"];
  assert.strictEqual(isBrowserRunning(list), false);
});

test("matches case-insensitively and by substring", () => {
  const list = ["/usr/lib/chromium/chromium", "node"];
  assert.strictEqual(isBrowserRunning(list), true);
});

const { keeperEnabled } = require("../bridge/host");

test("keeper is enabled by default", () => {
  assert.strictEqual(keeperEnabled(undefined), true);
});

test("keeper can be disabled explicitly", () => {
  for (const value of ["0", "false", "no", "off", "OFF", " False "]) {
    assert.strictEqual(keeperEnabled(value), false, `value=${value}`);
  }
});

test("keeper stays enabled for other values", () => {
  for (const value of ["1", "true", "yes", "on", "anything"]) {
    assert.strictEqual(keeperEnabled(value), true, `value=${value}`);
  }
});
