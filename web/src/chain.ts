import {
  isAddressEqual,
  getAddress,
  zeroAddress,
  createWalletClient,
  custom,
  type Address,
  type EIP1193Provider,
  type Hash,
  type Abi,
} from "viem";
import {
  erc20Abi,
  stateViewAbi,
  ROUTER,
  type PoolKey,
  type RpcClient,
  type Runtime,
  ensureChain,
} from "./config";
import { swapArgs, minimumOutput, type Side } from "./domain";

export type Snapshot = {
  block: bigint;
  timestamp: bigint;
  sampledAt: number;
  jackpotPool: bigint;
  currentLeader: Address;
  roundEndTime: bigint;
  roundId: bigint;
  minimumTicket: bigint;
  totalIMDBurned: bigint;
  totalPrizesPaid: bigint;
  totalCreatorFeesPaid: bigint;
  totalUnclaimedPayouts: bigint;
  canSettle: boolean;
  initialized: boolean;
  router: Address;
  owner: Address;
  pendingOwner: Address;
  poolId: Hash;
  pool?: {
    sqrt: bigint;
    liquidity: bigint;
    lpFee: number;
    protocolFee: number;
  };
};
export type Balances = {
  account: Address;
  imd: bigint;
  rekt: bigint;
  eth: bigint;
  imdAllowance: bigint;
  rektAllowance: bigint;
  payout: bigint;
  sampledAt: number;
};
export type Round = {
  id: bigint;
  winner: Address;
  endTime: bigint;
  settledAt: bigint;
  pot: bigint;
  prize: bigint;
  burned: bigint;
  rollover: bigint;
};
const equal = (a: Address, b: Address) => isAddressEqual(a, b);
export async function verifyDeployment(c: RpcClient, r: Runtime) {
  if ((await c.getChainId()) !== r.chain.id)
    throw Error(
      "RPC chain does not match the deployment. Signing is disabled.",
    );
  const addresses = [
    r.hook.address,
    r.token.address,
    r.imd.address,
    ROUTER,
    r.deployment.network.uniswapV4.poolManager,
  ];
  const code = await Promise.all(
    addresses.map((address) => c.getBytecode({ address })),
  );
  if (code.some((x) => !x || x === "0x"))
    throw Error(
      "A required contract has no deployed code. Signing is disabled.",
    );
  const read = (address: Address, abi: Abi, functionName: string) =>
    c.readContract({ address, abi, functionName });
  const [
    router,
    manager,
    token,
    quote,
    routerHook,
    routerManager,
    imdDecimals,
    rektDecimals,
    imdSymbol,
    rektSymbol,
    initialized,
  ] = await Promise.all([
    ...["swapRouter", "poolManager", "launchToken", "quoteCurrency"].map((f) =>
      read(r.hook.address, r.hookAbi, f),
    ),
    ...["hook", "poolManager"].map((f) => read(ROUTER, r.routerAbi, f)),
    read(r.imd.address, erc20Abi, "decimals"),
    read(r.token.address, erc20Abi, "decimals"),
    read(r.imd.address, erc20Abi, "symbol"),
    read(r.token.address, erc20Abi, "symbol"),
    read(r.hook.address, r.hookAbi, "initialized"),
  ]);
  if (
    !equal(router as Address, ROUTER) ||
    !equal(manager as Address, r.deployment.network.uniswapV4.poolManager) ||
    !equal(token as Address, r.token.address) ||
    !equal(quote as Address, r.imd.address) ||
    !equal(routerHook as Address, r.hook.address) ||
    !equal(routerManager as Address, manager as Address)
  )
    throw Error(
      "Contract bindings differ from the approved deployment. Signing is disabled.",
    );
  if (
    imdDecimals !== r.imd.decimals ||
    rektDecimals !== 18 ||
    imdSymbol !== "IMD" ||
    rektSymbol !== "REKTD"
  )
    throw Error(
      "Token metadata does not match the deployment. Signing is disabled.",
    );
  if (!initialized)
    throw Error("The pool has not been initialized. Trading is unavailable.");
  const key = (await read(r.hook.address, r.hookAbi, "poolKey")) as PoolKey;
  if (
    !equal(key.currency0, r.imd.address) ||
    !equal(key.currency1, r.token.address) ||
    !equal(key.hooks, r.hook.address) ||
    key.fee !== 12500 ||
    key.tickSpacing !== 60
  )
    throw Error(
      "Pool settings differ from the approved source. Signing is disabled.",
    );
  if (r.deployment.poolKey)
    for (const k of Object.keys(key) as (keyof PoolKey)[])
      if (
        String(key[k]).toLowerCase() !==
        String(r.deployment.poolKey[k]).toLowerCase()
      )
        throw Error("Pool key does not match the handoff.");
  return { verifiedAt: Date.now(), key };
}
export async function readSnapshot(
  c: RpcClient,
  r: Runtime,
): Promise<Snapshot> {
  const block = await c.getBlock();
  const names = [
    "jackpotPool",
    "currentLeader",
    "roundEndTime",
    "roundId",
    "minimumTicket",
    "totalIMDBurned",
    "totalPrizesPaid",
    "totalCreatorFeesPaid",
    "totalUnclaimedPayouts",
    "canSettle",
    "initialized",
    "swapRouter",
    "owner",
    "pendingOwner",
    "poolId",
  ] as const;
  const values = await Promise.all(
    names.map((functionName) =>
      c.readContract({
        address: r.hook.address,
        abi: r.hookAbi,
        functionName,
        blockNumber: block.number,
      }),
    ),
  );
  const data = Object.fromEntries(names.map((n, i) => [n, values[i]]));
  let pool: Snapshot["pool"];
  try {
    const [slot, liquidity] = await Promise.all([
      c.readContract({
        address: r.deployment.network.uniswapV4.stateView,
        abi: stateViewAbi,
        functionName: "getSlot0",
        args: [data.poolId as Hash],
        blockNumber: block.number,
      }),
      c.readContract({
        address: r.deployment.network.uniswapV4.stateView,
        abi: stateViewAbi,
        functionName: "getLiquidity",
        args: [data.poolId as Hash],
        blockNumber: block.number,
      }),
    ]);
    pool = { sqrt: slot[0], liquidity, lpFee: slot[3], protocolFee: slot[2] };
  } catch {
    /* Reads and trade inputs still work; router simulation can quote when funded. */
  }
  return {
    ...data,
    router: getAddress(data.swapRouter as Address),
    block: block.number,
    timestamp: block.timestamp,
    sampledAt: Date.now(),
    pool,
  } as Snapshot;
}
export async function readBalances(
  c: RpcClient,
  r: Runtime,
  account: Address,
): Promise<Balances> {
  const [imd, rekt, eth, imdAllowance, rektAllowance, payout] =
    await Promise.all([
      c.readContract({
        address: r.imd.address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account],
      }),
      c.readContract({
        address: r.token.address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account],
      }),
      c.getBalance({ address: account }),
      c.readContract({
        address: r.imd.address,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account, ROUTER],
      }),
      c.readContract({
        address: r.token.address,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account, ROUTER],
      }),
      c.readContract({
        address: r.hook.address,
        abi: r.hookAbi,
        functionName: "unclaimedPayout",
        args: [account],
      }) as Promise<bigint>,
    ]);
  return {
    account,
    imd,
    rekt,
    eth,
    imdAllowance,
    rektAllowance,
    payout,
    sampledAt: Date.now(),
  };
}
export async function readHistory(
  c: RpcClient,
  r: Runtime,
  current: bigint,
  page: number,
): Promise<Round[]> {
  const newest = current - 1n - BigInt(page * 5);
  const ids = Array.from({ length: 5 }, (_, i) => newest - BigInt(i)).filter(
    (id) => id > 0n,
  );
  return Promise.all(
    ids.map(async (id) => {
      const v = (await c.readContract({
        address: r.hook.address,
        abi: r.hookAbi,
        functionName: "roundHistory",
        args: [id],
      })) as [Address, bigint, bigint, bigint, bigint, bigint, bigint];
      return {
        id,
        winner: v[0],
        endTime: v[1],
        settledAt: v[2],
        pot: v[3],
        prize: v[4],
        burned: v[5],
        rollover: v[6],
      };
    }),
  );
}
export async function simulateQuote(
  c: RpcClient,
  r: Runtime,
  account: Address,
  side: Side,
  input: bigint,
  deadline: bigint,
) {
  const { result } = await c.simulateContract({
    address: ROUTER,
    abi: r.routerAbi,
    functionName: "swap",
    args: swapArgs(side, input, 1n, deadline),
    account,
  });
  const [amountIn, amountOut] = result as [bigint, bigint];
  if (amountIn <= 0n || amountIn > input || amountOut <= 0n)
    throw Error("The router returned an invalid quote. Try a smaller amount.");
  return { amountIn, amountOut, quotedAt: Date.now() };
}
export type Action =
  | "approve"
  | "trade"
  | "settle"
  | "claim"
  | "configure"
  | "transfer"
  | "accept";
export type ActionState = {
  phase:
    | "idle"
    | "simulating"
    | "signing"
    | "confirming"
    | "refreshing"
    | "unknown"
    | "success"
    | "error";
  hash?: Hash;
  message?: string;
};
export const pending = (s: ActionState) =>
  ["simulating", "signing", "confirming", "refreshing", "unknown"].includes(
    s.phase,
  );
export async function sendAction(args: {
  r: Runtime;
  c: RpcClient;
  provider: EIP1193Provider;
  account: Address;
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  onState: (s: ActionState) => void;
  refresh: () => Promise<unknown>;
}) {
  const {
    r,
    c,
    provider,
    account,
    address,
    abi,
    functionName,
    onState,
    refresh,
  } = args;
  onState({ phase: "simulating" });
  await ensureChain(provider, r);
  const accounts = await provider.request({ method: "eth_accounts" });
  if (!accounts.some((a) => equal(a, account)))
    throw Error("The wallet account changed. Refresh and try again.");
  await verifyDeployment(c, r);
  const { request } = await c.simulateContract({
    address,
    abi,
    functionName,
    args: args.args,
    account,
  });
  onState({ phase: "signing" });
  const wallet = createWalletClient({
    chain: r.chain,
    transport: custom(provider),
    account,
  });
  const hash = await wallet.writeContract(request);
  onState({ phase: "confirming", hash });
  let cancelled = false;
  const receipt = await c.waitForTransactionReceipt({
    hash,
    timeout: 120000,
    onReplaced: (replacement) => {
      onState({
        phase: "confirming",
        hash: replacement.transaction.hash,
        message:
          replacement.reason === "cancelled"
            ? "Cancellation submitted."
            : "Transaction replaced; awaiting confirmation.",
      });
      if (replacement.reason === "cancelled") cancelled = true;
    },
  });
  if (cancelled || receipt.status !== "success") {
    onState({
      phase: "error",
      hash: receipt.transactionHash,
      message: cancelled
        ? "The transaction was cancelled. No action completed."
        : "The transaction reverted. No action completed. Refresh and retry.",
    });
    await refresh().catch(() => {});
    return;
  }
  onState({ phase: "refreshing", hash: receipt.transactionHash });
  try {
    await refresh();
    onState({
      phase: "success",
      hash: receipt.transactionHash,
      message: "Confirmed on chain.",
    });
  } catch {
    onState({
      phase: "success",
      hash: receipt.transactionHash,
      message:
        "Confirmed on chain. State refresh failed; refresh before continuing.",
    });
  }
}
export function protectedSwap(
  side: Side,
  input: bigint,
  out: bigint,
  bps: number,
  deadline: bigint,
) {
  const min = minimumOutput(out, bps);
  if (min <= 1n)
    throw Error(
      "The output is too small for a protected trade. Increase the amount.",
    );
  return swapArgs(side, input, min, deadline);
}
export const noLeader = (a: Address) => equal(a, zeroAddress);
