"use strict";
const fs = require("node:fs");
const path = require("node:path");
const MAGIC = Buffer.from("DSPWSH-RICHLOG-V1\n", "utf8");
function fail(msg) {
  console.error(msg);
  process.exit(1);
}
const [hostPath, richPath, outPath] = process.argv.slice(2);
if (!hostPath || !richPath || !outPath) {
  fail("usage: node stitch.js <host-exe> <rich-log-exe> <output-exe>");
}
for (const f of [hostPath, richPath]) {
  if (!fs.existsSync(f)) fail("missing file: " + f);
}
const host = fs.readFileSync(hostPath);
const rich = fs.readFileSync(richPath);
// A marker string may appear in bundled JS; only the appended tail matters.
fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(outPath, Buffer.concat([host, MAGIC, rich]));
if (process.platform !== "win32") fs.chmodSync(outPath, 0o755);
console.log("stitched " + outPath + ": host=" + host.length + " rich=" + rich.length);
