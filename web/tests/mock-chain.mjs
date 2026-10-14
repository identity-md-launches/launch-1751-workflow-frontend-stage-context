import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  decodeFunctionData,
  encodeFunctionResult,
  parseAbi,
  toHex,
  parseEther,
  zeroAddress,
} from "viem";
export const WALLET = "0x1111111111111111111111111111111111111111"; // Isolated test identity; never exported.
const H = "0x" + "1".repeat(64),
  T = "0x" + "2".repeat(64),
  P = "0x" + "3".repeat(64);
export async function mockChain(root) {
  const m = JSON.parse(await readFile(resolve(root, "imd-deployment.json")));
  const token = m.contracts.find((x) => x.name === "RektToken").address,
    hook = m.contracts.find((x) => x.name === "RektJackpotHook").address;
  const imd = m.network.pairToken.address,
    router = "0xfc411cb7123c94480bbf00095428c37cc5c94531";
  const abi = Object.fromEntries(
    await Promise.all(
      ["RektToken", "RektJackpotHook", "RektSwapRouter"].map(async (n) => [
        n,
        JSON.parse(await readFile(resolve(root, `abi/${n}.json`))),
      ]),
    ),
  );
  const stateAbi = parseAbi([
    "function getSlot0(bytes32) view returns (uint160,int24,uint24,uint24)",
    "function getLiquidity(bytes32) view returns (uint128)",
  ]);
  const mock = {
    walletChain: 1,
    known: false,
    connected: false,
    imd: parseEther("1000"),
    rekt: parseEther("500"),
    imdAllowance: 0n,
    rektAllowance: 0n,
    payout: parseEther("12"),
    pot: parseEther("1000"),
    round: 8n,
    end: BigInt(Math.floor(Date.now() / 1000) + 180),
    leader: WALLET,
    reject: false,
    failRpc: false,
    failSimulation: false,
    missingCode: false,
    holdReceipt: false,
    receipts: {},
    calls: [],
    sent: [],
    owner: hook,
  };
  function decode(tx) {
    const address = tx.to.toLowerCase();
    const a =
      address === hook.toLowerCase()
        ? abi.RektJackpotHook
        : address === router
          ? abi.RektSwapRouter
          : address === m.network.uniswapV4.stateView.toLowerCase()
            ? stateAbi
            : abi.RektToken;
    return {
      ...decodeFunctionData({ abi: a, data: tx.data }),
      abi: a,
      address,
    };
  }
  const block = () => ({
    number: "0x5466d20",
    hash: H,
    parentHash: P,
    nonce: "0x0000000000000000",
    sha3Uncles: P,
    logsBloom: "0x" + "0".repeat(512),
    transactionsRoot: P,
    stateRoot: P,
    receiptsRoot: P,
    miner: zeroAddress,
    difficulty: "0x0",
    totalDifficulty: "0x0",
    extraData: "0x",
    size: "0x100",
    gasLimit: "0x1c9c380",
    gasUsed: "0x5208",
    timestamp: toHex(BigInt(Math.floor(Date.now() / 1000))),
    transactions: [],
    uncles: [],
    baseFeePerGas: "0x1",
  });
  const rpc = async (q) => {
    mock.calls.push(q);
    const { method, params = [] } = q;
    if (method === "eth_requestAccounts") {
      if (mock.reject) {
        mock.reject = false;
        throw { code: 4001, message: "User rejected" };
      }
      mock.connected = true;
      return [WALLET];
    }
    if (method === "eth_accounts") return mock.connected ? [WALLET] : [];
    if (method === "wallet_switchEthereumChain") {
      if (mock.reject || mock.rejectSwitch) {
        mock.reject = false;
        mock.rejectSwitch = false;
        throw { code: 4001, message: "User rejected" };
      }
      if (!mock.known) throw { code: 4902, message: "Unknown chain" };
      mock.walletChain = 4663;
      return null;
    }
    if (method === "wallet_addEthereumChain") {
      mock.known = true;
      mock.added = params[0];
      return null;
    }
    if (method === "wallet_revokePermissions") {
      mock.connected = false;
      return null;
    }
    if (method === "wallet_getCapabilities") return {};
    if (method === "eth_chainId")
      return toHex(q.wallet ? mock.walletChain : 4663);
    if (mock.failRpc) throw { code: -32000, message: "Mock RPC unavailable" };
    if (method === "eth_getCode")
      return mock.missingCode ? "0x" : "0x6080604052";
    if (method === "eth_getBlockByNumber") return block();
    if (method === "eth_blockNumber") return "0x5466d20";
    if (method === "eth_getBalance") return toHex(parseEther("1"));
    if (method === "eth_getTransactionCount") return "0x1";
    if (method === "eth_estimateGas") return "0x493e0";
    if (method === "eth_gasPrice" || method === "eth_maxPriorityFeePerGas")
      return "0x1";
    if (method === "eth_call") {
      const d = decode(params[0]),
        a = d.args ?? [];
      let result;
      const hookValues = {
        swapRouter: router,
        poolManager: m.network.uniswapV4.poolManager,
        launchToken: token,
        quoteCurrency: imd,
        initialized: true,
        poolKey: {
          currency0: imd,
          currency1: token,
          fee: 12500,
          tickSpacing: 60,
          hooks: hook,
        },
        jackpotPool: mock.pot,
        currentLeader: mock.leader,
        roundEndTime: mock.end,
        roundId: mock.round,
        minimumTicket: parseEther("50"),
        totalIMDBurned: parseEther("120"),
        totalPrizesPaid: parseEther("360"),
        totalCreatorFeesPaid: parseEther("420"),
        totalUnclaimedPayouts: mock.payout,
        canSettle:
          mock.leader !== zeroAddress &&
          BigInt(Math.floor(Date.now() / 1000)) > mock.end,
        owner: mock.owner,
        pendingOwner: zeroAddress,
        poolId: P,
        unclaimedPayout: mock.payout,
      };
      if (d.address === hook.toLowerCase()) {
        if (d.functionName === "roundHistory")
          result = [
            WALLET,
            1700000000n,
            1700000010n,
            parseEther("100"),
            parseEther("60"),
            parseEther("20"),
            parseEther("20"),
          ];
        else if (d.functionName in hookValues)
          result = hookValues[d.functionName];
        else if (
          [
            "settleRound",
            "claimPayout",
            "configureRouter",
            "transferOwnership",
            "acceptOwnership",
          ].includes(d.functionName)
        )
          result = undefined;
        else throw Error("Unhandled hook read " + d.functionName);
      } else if (d.address === router) {
        if (d.functionName === "hook") result = hook;
        else if (d.functionName === "poolManager")
          result = m.network.uniswapV4.poolManager;
        else if (d.functionName === "swap") {
          if (mock.failSimulation)
            throw { code: 3, message: "execution reverted" };
          if (a[1] >= 0n) throw Error("Exact-input amount must be negative");
          const input = -a[1],
            allowed = a[0] ? mock.imdAllowance : mock.rektAllowance,
            bal = a[0] ? mock.imd : mock.rekt;
          if (allowed < input || bal < input)
            throw {
              code: 3,
              message: "execution reverted: insufficient allowance or balance",
            };
          result = [input, a[0] ? input * 2n : input / 2n];
        } else throw Error("Unhandled router read " + d.functionName);
      } else if (d.address === m.network.uniswapV4.stateView.toLowerCase())
        result =
          d.functionName === "getSlot0"
            ? [1n << 96n, 0, 0, 12500]
            : parseEther("100000");
      else if (d.functionName === "balanceOf")
        result = d.address === imd.toLowerCase() ? mock.imd : mock.rekt;
      else if (d.functionName === "allowance") {
        if (a[1].toLowerCase() !== router) throw Error("Wrong spender");
        result =
          d.address === imd.toLowerCase()
            ? mock.imdAllowance
            : mock.rektAllowance;
      } else if (d.functionName === "decimals") result = 18;
      else if (d.functionName === "symbol")
        result = d.address === imd.toLowerCase() ? "IMD" : "REKTD";
      else if (d.functionName === "approve") result = true;
      else throw Error("Unhandled token read " + d.functionName);
      return encodeFunctionResult({
        abi: d.abi,
        functionName: d.functionName,
        result,
      });
    }
    if (method === "eth_sendTransaction") {
      if (mock.reject) {
        mock.reject = false;
        throw { code: 4001, message: "User rejected request" };
      }
      const tx = params[0],
        d = decode(tx),
        a = d.args ?? [];
      mock.sent.push({ tx, ...d });
      const hash = toHex(BigInt(mock.sent.length), { size: 32 });
      if (d.functionName === "approve") {
        if (d.address === imd.toLowerCase()) mock.imdAllowance = a[1];
        else mock.rektAllowance = a[1];
      }
      if (d.functionName === "swap") {
        const input = -a[1];
        if (a[0]) {
          mock.imd -= input;
          mock.rekt += input * 2n;
          mock.imdAllowance -= input;
          mock.leader = WALLET;
          mock.end = BigInt(Math.floor(Date.now() / 1000) + 300);
        } else {
          mock.rekt -= input;
          mock.imd += input / 2n;
          mock.rektAllowance -= input;
        }
      }
      if (d.functionName === "settleRound") {
        mock.round++;
        mock.leader = zeroAddress;
        mock.end = 0n;
        mock.pot = mock.pot / 5n;
      }
      if (d.functionName === "claimPayout") mock.payout = 0n;
      mock.receipts[hash] = {
        transactionHash: hash,
        transactionIndex: "0x0",
        blockHash: H,
        blockNumber: "0x5466d20",
        from: WALLET,
        to: tx.to,
        cumulativeGasUsed: "0x5208",
        gasUsed: "0x5208",
        contractAddress: null,
        logs: [],
        logsBloom: "0x" + "0".repeat(512),
        status: "0x1",
        effectiveGasPrice: "0x1",
        type: "0x2",
      };
      return hash;
    }
    if (method === "eth_getTransactionReceipt")
      return mock.holdReceipt ? null : (mock.receipts[params[0]] ?? null);
    if (method === "eth_getTransactionByHash")
      return {
        hash: params[0],
        from: WALLET,
        to: router,
        nonce: "0x1",
        gas: "0x493e0",
        value: "0x0",
        input: "0x",
        v: "0x0",
        r: T,
        s: T,
        blockHash: H,
        blockNumber: "0x5466d20",
        transactionIndex: "0x0",
        gasPrice: "0x1",
        type: "0x0",
      };
    throw Error("Unhandled RPC " + method);
  };
  return { mock, rpc, manifest: m, router, imd, token, hook };
}
export async function injectWallet(page, rpc) {
  await page.exposeFunction("__rektTestRpc", async (q) => {
    try {
      return { result: await rpc({ ...q, wallet: true }) };
    } catch (error) {
      return { error: { code: error.code ?? -32000, message: error.message } };
    }
  });
  await page.addInitScript(() => {
    const listeners = new Map();
    const provider = {
      request: async (q) => {
        const response = await window.__rektTestRpc(q);
        if (response.error)
          throw Object.assign(
            new Error(response.error.message),
            response.error,
          );
        if (q.method === "wallet_switchEthereumChain")
          for (const cb of listeners.get("chainChanged") ?? []) cb("0x1237");
        return response.result;
      },
      on: (e, cb) => listeners.set(e, [...(listeners.get(e) ?? []), cb]),
      removeListener: (e, cb) =>
        listeners.set(
          e,
          (listeners.get(e) ?? []).filter((x) => x !== cb),
        ),
    };
    window.ethereum = provider;
    const announce = () =>
      window.dispatchEvent(
        new CustomEvent("eip6963:announceProvider", {
          detail: {
            info: {
              uuid: "98ac29df-bd16-4328-9667-cd7193b6cc0e",
              name: "Test wallet",
              icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" fill="green"/></svg>',
              rdns: "test.rekt.wallet",
            },
            provider,
          },
        }),
      );
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
  });
}
