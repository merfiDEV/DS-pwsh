"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { formatBanner } = require("../bridge/banner");

const sample = {
  port: 49152,
  shell: "bash",
  cwd: "/home/user/project",
  platform: "linux",
};

test("banner shows the project name and RUNNING status", () => {
  const out = formatBanner(sample);
  assert.match(out, /DS-pwsh Terminal Bridge/);
  assert.match(out, /RUNNING/);
});

test("banner includes address, shell, platform and cwd", () => {
  const out = formatBanner(sample);
  assert.match(out, /http:\/\/127\.0\.0\.1:49152/);
  assert.match(out, /bash/);
  assert.match(out, /linux/);
  assert.match(out, /\/home\/user\/project/);
});
