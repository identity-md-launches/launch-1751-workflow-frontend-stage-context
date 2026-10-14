import { createConfig, http } from "wagmi";
import { coinbaseWallet, injected } from "wagmi/connectors";
import {
  createPublicClient,
  custom,
  defineChain,
  fallback,
  getAddress,
  keccak256,
  sha256,
  toBytes,
  parseAbi,
  type Abi,
  type Address,
  type EIP1193Provider,
} from "viem";

// The sole routing exception approved in the assignment. Never route via the
// UniversalRouter/Permit2/Quoter addresses preserved in the network manifest.
export const ROUTER = getAddress("0xFc411Cb7123c94480BBF00095428c37cc5C94531");
export const PRICE_LIMIT = {
  buy: 4295128740n,
  sell: 1461446703485210103287273052203988822378723970341n,
};
export const MAX_INPUT = (1n << 127n) - 1n;
export const POLL_MS = 5000;
export const STALE_MS = 45000;
export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);
export const stateViewAbi = parseAbi([
  "function getSlot0(bytes32) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
  "function getLiquidity(bytes32) view returns (uint128)",
]);
export type PoolKey = {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
};
type Contract = {
  name: string;
  address: Address;
  abiHash: string;
  abiPath: string;
};
export type Deployment = {
  version: number;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  contracts: Contract[];
  assets: { path: string; sha256: string }[];
  poolKey?: PoolKey;
  network: {
    chainId: number;
    name: string;
    testnet: boolean;
    rpcUrls: string[];
    explorer: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    pairToken: { address: Address; symbol: string; decimals: number };
    uniswapV4: { poolManager: Address; stateView: Address };
  };
  walletAddChain: {
    chainId: string;
    chainName: string;
    rpcUrls: string[];
    nativeCurrency: { name: string; symbol: string; decimals: number };
    blockExplorerUrls: string[];
  };
};
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sorted((value as Record<string, unknown>)[k])]),
    );
  return value;
}
async function json(path: string, expectedHash?: string) {
  if (
    !/^[a-zA-Z0-9_./-]+$/.test(path) ||
    path.includes("..") ||
    path.startsWith("/")
  )
    throw Error("Invalid deployment asset path.");
  const response = await fetch(
    new URL(path, new URL(import.meta.env.BASE_URL, document.baseURI)),
    { cache: "no-cache" },
  );
  if (!response.ok) throw Error(`Could not load ${path}. Reload to retry.`);
  const raw = await response.text();
  if (expectedHash && sha256(toBytes(raw)).slice(2) !== expectedHash)
    throw Error(`Integrity check failed for ${path}. Reload to retry.`);
  return JSON.parse(raw);
}
export async function loadRuntime() {
  const deployment: Deployment = await json("imd-deployment.json");
  if (
    deployment.version !== 1 ||
    deployment.chainId !== deployment.network.chainId ||
    Number(deployment.walletAddChain.chainId) !== deployment.chainId
  )
    throw Error("Deployment network does not match. Trading is disabled.");
  const find = (name: string) => {
    const c = deployment.contracts.find((x) => x.name === name);
    if (!c) throw Error(`Missing ${name} deployment.`);
    return { ...c, address: getAddress(c.address) };
  };
  const hook = find("RektJackpotHook"),
    token = find("RektToken");
  const loadAbi = (path: string) => {
    const asset = deployment.assets.find((a) => a.path === path);
    if (!asset || !/^[0-9a-f]{64}$/.test(asset.sha256))
      throw Error(`Missing ABI integrity entry: ${path}`);
    return json(path, asset.sha256);
  };
  const [hookAbi, tokenAbi, routerAbi] = (await Promise.all([
    loadAbi(hook.abiPath),
    loadAbi(token.abiPath),
    loadAbi("abi/RektSwapRouter.json"),
  ])) as [Abi, Abi, Abi];
  for (const [c, abi] of [
    [hook, hookAbi],
    [token, tokenAbi],
  ] as const) {
    if (keccak256(toBytes(JSON.stringify(sorted(abi)))).slice(2) !== c.abiHash)
      throw Error(`${c.name} ABI verification failed. Trading is disabled.`);
  }
  const chain = defineChain({
    id: deployment.chainId,
    name: deployment.network.name,
    nativeCurrency: deployment.network.nativeCurrency,
    rpcUrls: { default: { http: deployment.network.rpcUrls } },
    blockExplorers: {
      default: { name: "Explorer", url: deployment.network.explorer },
    },
    testnet: deployment.network.testnet,
  });
  const transport = () =>
    fallback(
      deployment.network.rpcUrls.map((url) =>
        http(url, { timeout: 7000, retryCount: 0, batch: { wait: 20 } }),
      ),
      { retryCount: 0 },
    );
  const wallets = createConfig({
    chains: [chain],
    multiInjectedProviderDiscovery: true,
    connectors: [
      injected(),
      coinbaseWallet({ appName: "Rekt Blitz", preference: { options: "all" } }),
    ],
    transports: { [chain.id]: transport() },
  });
  const client = (provider?: EIP1193Provider) =>
    createPublicClient({
      chain,
      transport: provider
        ? fallback(
            [
              transport(),
              custom(
                {
                  request: async (args) => {
                    const id = await provider.request({
                      method: "eth_chainId",
                    });
                    if (Number(id) !== chain.id)
                      throw Error(
                        "Switch your wallet to the configured chain.",
                      );
                    return provider.request(
                      args as Parameters<EIP1193Provider["request"]>[0],
                    );
                  },
                } as EIP1193Provider,
                { retryCount: 0 },
              ),
            ],
            { retryCount: 0 },
          )
        : transport(),
    });
  return {
    deployment,
    chain,
    wallets,
    client,
    hook,
    token,
    hookAbi,
    tokenAbi,
    routerAbi,
    imd: {
      ...deployment.network.pairToken,
      address: getAddress(deployment.network.pairToken.address),
    },
    router: ROUTER,
  };
}
export type Runtime = Awaited<ReturnType<typeof loadRuntime>>;
export type RpcClient = ReturnType<Runtime["client"]>;
export const explorerAddress = (r: Runtime, a: Address) =>
  `${r.deployment.network.explorer}/address/${getAddress(a)}`;

export async function ensureChain(provider: EIP1193Provider, r: Runtime) {
  if (Number(await provider.request({ method: "eth_chainId" })) === r.chain.id)
    return;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [
        { chainId: r.deployment.walletAddChain.chainId as `0x${string}` },
      ],
    });
  } catch (error) {
    const e = error as {
      code?: number;
      message?: string;
      cause?: { code?: number };
      data?: { originalError?: { code?: number } };
    };
    if (
      e.code !== 4902 &&
      e.cause?.code !== 4902 &&
      e.data?.originalError?.code !== 4902 &&
      !/unknown chain|unrecognized chain|not added|chain.*not.*configured/i.test(
        e.message ?? "",
      )
    )
      throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [r.deployment.walletAddChain as never],
    });
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [
        { chainId: r.deployment.walletAddChain.chainId as `0x${string}` },
      ],
    });
  }
  if (Number(await provider.request({ method: "eth_chainId" })) !== r.chain.id)
    throw Error(
      "The wallet is still on another network. Switch networks and retry.",
    );
}
