import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  copyFile,
} from "node:fs/promises";
import { resolve, relative } from "node:path";
import { createHash } from "node:crypto";
import { abiHash } from "./canonical.mjs";
const root = resolve(import.meta.dirname, "../..");
const out = resolve(root, "dist");
const handoff = JSON.parse(
  await readFile(resolve(root, "web/deployment/handoff.json")),
);
const network = JSON.parse(
  await readFile(resolve(root, "web/deployment/network.json")),
);
await mkdir(resolve(out, "abi"), { recursive: true });
const contracts = [];
for (const c of handoff.contracts) {
  const file = resolve(root, `docs/abi/${c.name}.json`);
  const abi = JSON.parse(await readFile(file));
  if (abiHash(abi) !== c.abiHash) throw Error(`ABI hash mismatch: ${c.name}`);
  const abiPath = `abi/${c.name}.json`;
  await copyFile(file, resolve(out, abiPath));
  contracts.push({
    name: c.name,
    address: c.address,
    abiHash: c.abiHash,
    abiPath,
  });
}
await copyFile(
  resolve(root, "docs/abi/RektSwapRouter.json"),
  resolve(out, "abi/RektSwapRouter.json"),
);
async function inventory(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await inventory(path)));
    else if (entry.name !== "imd-deployment.json")
      files.push({
        path: relative(out, path).replaceAll("\\", "/"),
        sha256: createHash("sha256")
          .update(await readFile(path))
          .digest("hex"),
      });
  }
  return files;
}
const manifest = {
  version: 1,
  launchId: handoff.launchId,
  chainId: handoff.chainId,
  sourceCommit: handoff.sourceCommit,
  attestationHash: handoff.attestationHash,
  contracts,
  assets: (await inventory(out)).sort((a, b) => a.path.localeCompare(b.path)),
  ...network,
  ...(handoff.poolKey ? { poolKey: handoff.poolKey } : {}),
};
await writeFile(
  resolve(out, "imd-deployment.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  `Exported ${manifest.assets.length} hashed assets; attested ABIs match.`,
);
