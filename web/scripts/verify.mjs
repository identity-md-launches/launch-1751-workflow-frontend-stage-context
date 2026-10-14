import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { abiHash } from "./canonical.mjs";
const root = resolve(import.meta.dirname, "../.."),
  out = resolve(root, "dist");
const load = async (p) => JSON.parse(await readFile(resolve(root, p)));
const m = await load("dist/imd-deployment.json"),
  h = await load("web/deployment/handoff.json"),
  n = await load("web/deployment/network.json");
assert.deepEqual(
  Object.keys(m).sort(),
  [
    "version",
    "launchId",
    "chainId",
    "sourceCommit",
    "attestationHash",
    "contracts",
    "assets",
    "network",
    "walletAddChain",
    ...(h.poolKey ? ["poolKey"] : []),
  ].sort(),
);
for (const k of [
  "version",
  "launchId",
  "chainId",
  "sourceCommit",
  "attestationHash",
])
  assert.equal(m[k], h[k]);
assert.deepEqual(m.network, n.network);
assert.deepEqual(m.walletAddChain, n.walletAddChain);
if (h.poolKey) assert.deepEqual(m.poolKey, h.poolKey);
assert.equal(m.contracts.length, h.contracts.length);
for (const c of m.contracts) {
  const expected = h.contracts.find((x) => x.name === c.name);
  assert.ok(expected);
  assert.equal(c.address, expected.address);
  assert.equal(c.abiHash, expected.abiHash);
  assert.equal(abiHash(await load(`dist/${c.abiPath}`)), c.abiHash);
}
async function files(dir, prefix = "") {
  const result = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = prefix + e.name;
    if (e.isDirectory())
      result.push(...(await files(resolve(dir, e.name), p + "/")));
    else result.push(p);
  }
  return result;
}
assert.ok(m.assets.length <= 128);
assert.deepEqual(
  (await files(out)).filter((p) => p !== "imd-deployment.json").sort(),
  m.assets.map((a) => a.path).sort(),
);
let bytes = 0;
for (const a of m.assets) {
  assert.match(a.path, /^[a-zA-Z0-9_./-]+$/);
  assert.ok(!a.path.includes("..") && !a.path.startsWith("/"));
  const data = await readFile(resolve(out, a.path));
  bytes += data.length;
  assert.equal(createHash("sha256").update(data).digest("hex"), a.sha256);
  assert.ok(data.length < 8388608);
}
assert.ok(bytes < 8388608);
const html = await readFile(resolve(out, "index.html"), "utf8");
assert.ok(!/(?:src|href)="\/(?!\/)/.test(html));
console.log(
  `PASS: handoff, network, contract set, canonical ABI hashes, ${m.assets.length} asset hashes, relative HTML; ${bytes} export bytes.`,
);
