import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEther, type EIP1193Provider } from "viem";
import {
  amount,
  inputAmount,
  estimate,
  minimumOutput,
  countdown,
  clockText,
  swapArgs,
  errorMessage,
} from "../src/domain";
import {
  ensureChain,
  MAX_INPUT,
  PRICE_LIMIT,
  type Runtime,
} from "../src/config";
import { protectedSwap } from "../src/chain";
import network from "../deployment/network.json";

test("decimal inputs reject rounding, exponent notation, negatives, and int128 overflow", () => {
  assert.equal(inputAmount("1.000000000000000001", 18), 1000000000000000001n);
  for (const bad of [
    "-1",
    "1e18",
    "NaN",
    "Infinity",
    "1.0000000000000000001",
    "0",
    "",
  ])
    assert.equal(inputAmount(bad, 18), 0n);
  assert.equal(inputAmount(MAX_INPUT.toString(), 0), MAX_INPUT);
  assert.equal(inputAmount((MAX_INPUT + 1n).toString(), 0), 0n);
  assert.equal(inputAmount("0.01", 6), 10000n);
});
test("human amounts keep large integers exact and disclose tiny nonzero amounts", () => {
  assert.equal(
    amount(parseEther("12345678901234567890.1234")),
    "12,345,678,901,234,567,890.1234",
  );
  assert.equal(amount(1n), "<0.0001");
  assert.equal(amount(0n), "0");
});
test("all exact input swaps are negative and direction uses the approved price bounds", () => {
  assert.deepEqual(swapArgs("buy", 20n, 5n, 100n), [
    true,
    -20n,
    5n,
    PRICE_LIMIT.buy,
    100n,
  ]);
  assert.deepEqual(swapArgs("sell", 20n, 5n, 100n), [
    false,
    -20n,
    5n,
    PRICE_LIMIT.sell,
    100n,
  ]);
  assert.equal(minimumOutput(123456789n, 100), 122222221n);
  assert.throws(() => protectedSwap("buy", 10n, 1n, 100, 100n), /too small/);
});
test("pool estimates include fees, price impact, and never invent missing liquidity", () => {
  const p = 1n << 96n,
    l = parseEther("1000000"),
    i = parseEther("100");
  const buy = estimate("buy", i, p, l, 12500)!,
    sell = estimate("sell", i, p, l, 12500)!;
  assert.ok(buy > parseEther("97") && buy < parseEther("97.7625"));
  assert.ok(sell > parseEther("97") && sell < parseEther("97.7625"));
  assert.ok(estimate("buy", i, p, l, 12500, 1000)! < buy);
  assert.equal(estimate("buy", i, p, 0n, 12500), undefined);
  assert.equal(estimate("buy", i, 0n, l, 12500), undefined);
});
test("countdown uses chain time and sampled elapsed time without going negative", () => {
  assert.equal(countdown(1600n, 1000n, 5000, 6500), 599);
  assert.equal(countdown(1600n, 1600n, 5000, 5000), 0);
  assert.equal(countdown(1600n, 1601n, 5000, 4000), 0);
  assert.equal(clockText(599), "09:59");
});
test("unknown chain offers the exact handoff parameters, then switches again", async () => {
  let chain = 1,
    added = false;
  const calls: { method: string; params?: unknown }[] = [];
  const provider = {
    request: async (q: { method: string; params?: unknown }) => {
      calls.push(q);
      if (q.method === "eth_chainId") return `0x${chain.toString(16)}`;
      if (q.method === "wallet_switchEthereumChain") {
        if (!added) throw { code: 4902 };
        chain = 4663;
        return null;
      }
      if (q.method === "wallet_addEthereumChain") {
        added = true;
        return null;
      }
      throw Error(q.method);
    },
  } as EIP1193Provider;
  const r = {
    chain: { id: 4663 },
    deployment: { walletAddChain: network.walletAddChain },
  } as Runtime;
  await ensureChain(provider, r);
  assert.deepEqual(
    calls.filter((x) => x.method.startsWith("wallet_")).map((x) => x.method),
    [
      "wallet_switchEthereumChain",
      "wallet_addEthereumChain",
      "wallet_switchEthereumChain",
    ],
  );
  assert.deepEqual(
    calls.find((x) => x.method === "wallet_addEthereumChain")?.params,
    [network.walletAddChain],
  );
});
test("a rejected switch never triggers add-chain and errors are actionable", async () => {
  const calls: string[] = [];
  const provider = {
    request: async (q: { method: string }) => {
      calls.push(q.method);
      if (q.method === "eth_chainId") return "0x1";
      throw { code: 4001, message: "User rejected request" };
    },
  } as EIP1193Provider;
  await assert.rejects(
    ensureChain(provider, {
      chain: { id: 4663 },
      deployment: { walletAddChain: network.walletAddChain },
    } as Runtime),
  );
  assert.ok(!calls.includes("wallet_addEthereumChain"));
  assert.match(
    errorMessage({ code: 4001, message: "User rejected request" }),
    /declined/,
  );
});
