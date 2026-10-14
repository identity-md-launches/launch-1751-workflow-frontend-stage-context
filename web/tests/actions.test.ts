import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createPublicClient,
  custom,
  defineChain,
  parseEther,
  type Abi,
  type EIP1193Provider,
} from "viem";
import { sendAction, type ActionState } from "../src/chain";
import { erc20Abi, type Runtime, type RpcClient } from "../src/config";

// The JS browser fixture also exercises viem's real ABI encoding here.
const fixtureModule = "./mock-chain.mjs";
async function setup(mode: "success" | "cancelled" | "reverted") {
  const { mockChain, WALLET } = await import(fixtureModule);
  const root = resolve(import.meta.dirname, "../../dist");
  const fixture = await mockChain(root),
    { mock, rpc, manifest } = fixture;
  Object.assign(mock, { connected: true, known: true, walletChain: 4663 });
  const abi = async (name: string) =>
    JSON.parse(
      await readFile(resolve(root, `abi/${name}.json`), "utf8"),
    ) as Abi;
  const chain = defineChain({
    id: manifest.chainId,
    name: manifest.network.name,
    nativeCurrency: manifest.network.nativeCurrency,
    rpcUrls: { default: { http: manifest.network.rpcUrls } },
  });
  const runtime = {
    deployment: manifest,
    chain,
    hook: manifest.contracts.find(
      (x: { name: string }) => x.name === "RektJackpotHook",
    ),
    token: manifest.contracts.find(
      (x: { name: string }) => x.name === "RektToken",
    ),
    imd: manifest.network.pairToken,
    hookAbi: await abi("RektJackpotHook"),
    tokenAbi: await abi("RektToken"),
    routerAbi: await abi("RektSwapRouter"),
  } as Runtime;
  const base = createPublicClient({
    chain,
    transport: custom({ request: rpc }),
  });
  const client = {
    ...base,
    waitForTransactionReceipt: async (options: {
      hash: `0x${string}`;
      onReplaced: (value: unknown) => void;
    }) => {
      if (mode === "cancelled")
        options.onReplaced({
          reason: "cancelled",
          transaction: { hash: options.hash },
        });
      return {
        ...mock.receipts[options.hash],
        transactionHash: options.hash,
        status: mode === "reverted" ? "reverted" : "success",
      };
    },
  } as unknown as RpcClient;
  const provider = {
    request: (q: unknown) => rpc({ ...(q as object), wallet: true }),
  } as EIP1193Provider;
  const states: ActionState[] = [];
  return {
    fixture,
    states,
    args: {
      r: runtime,
      c: client,
      provider,
      account: WALLET,
      address: fixture.imd,
      abi: erc20Abi,
      functionName: "approve",
      args: [fixture.router, parseEther("1")],
      onState: (state: ActionState) => states.push(state),
      refresh: async () => {},
    },
  };
}
test("a confirmed wallet cancellation is never reported as a successful trade", async () => {
  const { args, states } = await setup("cancelled");
  await sendAction(args);
  assert.equal(states.at(-1)?.phase, "error");
  assert.match(states.at(-1)?.message ?? "", /cancelled/);
  assert.ok(!states.some((s) => s.phase === "success"));
});
test("a reverted receipt unlocks with an explicit failure and transaction link", async () => {
  const { args, states } = await setup("reverted");
  await sendAction(args);
  assert.equal(states.at(-1)?.phase, "error");
  assert.ok(states.at(-1)?.hash);
  assert.match(states.at(-1)?.message ?? "", /reverted/);
});
test("a failed refresh after successful confirmation does not claim the transaction failed", async () => {
  const { args, states } = await setup("success");
  await sendAction({
    ...args,
    refresh: async () => {
      throw Error("RPC unavailable");
    },
  });
  assert.equal(states.at(-1)?.phase, "success");
  assert.match(states.at(-1)?.message ?? "", /State refresh failed/);
});
test("a failed deployed-code verification prevents the wallet send request", async () => {
  const { args, fixture } = await setup("success");
  fixture.mock.missingCode = true;
  await assert.rejects(sendAction(args), /no deployed code/);
  assert.equal(fixture.mock.sent.length, 0);
});
