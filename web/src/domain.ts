import {
  formatUnits,
  parseUnits,
  BaseError,
  ContractFunctionRevertedError,
  decodeErrorResult,
  type Abi,
} from "viem";
import { MAX_INPUT, PRICE_LIMIT } from "./config";
export type Side = "buy" | "sell";
export function inputAmount(text: string, decimals: number) {
  if (!/^\d+(\.\d*)?$/.test(text.trim())) return 0n;
  if ((text.split(".")[1]?.length ?? 0) > decimals) return 0n;
  try {
    const n = parseUnits(text.trim(), decimals);
    return n > 0n && n <= MAX_INPUT ? n : 0n;
  } catch {
    return 0n;
  }
}
export function amount(value: bigint | undefined, decimals = 18, max = 4) {
  if (value === undefined) return "…";
  const [whole, fraction = ""] = formatUnits(value, decimals).split(".");
  const f = fraction.slice(0, max).replace(/0+$/, "");
  if (value > 0n && whole === "0" && !f)
    return `<${max ? "0." + "0".repeat(max - 1) + "1" : "1"}`;
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f ? "." + f : "");
}
export function minimumOutput(out: bigint, bps: number) {
  return (out * BigInt(10000 - bps)) / 10000n;
}
export function swapArgs(
  side: Side,
  input: bigint,
  min: bigint,
  deadline: bigint,
) {
  return [side === "buy", -input, min, PRICE_LIMIT[side], deadline] as const;
}
export function countdown(
  end: bigint,
  chainTime: bigint,
  sampledAt: number,
  now: number,
) {
  const remaining =
    Number(end - chainTime) - Math.floor(Math.max(0, now - sampledAt) / 1000);
  return Math.max(0, remaining);
}
export function clockText(seconds: number) {
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}
// A bounded single-liquidity-range estimate. Tick crossing and rounding can
// change execution; this value is NEVER the source of a signed swap limit.
export function estimate(
  side: Side,
  input: bigint,
  sqrt: bigint,
  liquidity: bigint,
  lpFee: number,
  protocolFee = 0,
) {
  if (input <= 0n || sqrt <= 0n || liquidity <= 0n) return undefined;
  const directional = side === "buy" ? protocolFee & 4095 : protocolFee >> 12;
  const fee =
    directional + lpFee - Math.floor((directional * lpFee) / 1_000_000);
  if (fee >= 1_000_000) return undefined;
  const q = 1n << 96n;
  let net = side === "buy" ? input - input / 100n : input;
  net = (net * BigInt(1_000_000 - fee)) / 1_000_000n;
  if (side === "buy") {
    const next = (liquidity * q * sqrt) / (liquidity * q + net * sqrt);
    return (liquidity * (sqrt - next)) / q;
  }
  const next = sqrt + (net * q) / liquidity;
  const gross = (liquidity * q * (next - sqrt)) / (next * sqrt);
  return gross - gross / 100n;
}
const messages: Record<string, string> = {
  SlippageExceeded:
    "The price moved beyond your limit. Refresh the quote and retry.",
  PartialFillUnsupported:
    "This buy cannot fill at the current liquidity. Try a smaller amount.",
  DeadlineExpired: "The trade deadline passed. Refresh the quote and retry.",
  RoundStillActive:
    "The round is still active on chain. Wait for the next block.",
  NoActiveRound:
    "This round has already settled, or has no leader. Refresh the round.",
  NothingToClaim:
    "There is no payout to retry for this address. Refresh balances.",
  OnlySwapRouter:
    "The approved router no longer matches the hook. Trading is disabled; reload for current state.",
  InvalidRouter:
    "The replacement router must have identical runtime code. Check the address.",
  OwnableUnauthorizedAccount: "Only the current owner can perform this action.",
  ERC20InsufficientBalance:
    "Your token balance is too low. Use a smaller amount.",
  ERC20InsufficientAllowance: "Approve the input token first, then retry.",
};
export function errorMessage(error: unknown, abis: Abi[] = []): string {
  let e: unknown = error;
  if (error instanceof BaseError)
    e = error.walk((x) => x instanceof ContractFunctionRevertedError) ?? error;
  const reverted = e as {
    data?: { errorName?: string; args?: unknown[] };
    code?: number;
    shortMessage?: string;
    message?: string;
  };
  if (reverted.data?.errorName === "WrappedError") {
    for (const arg of reverted.data.args ?? [])
      if (typeof arg === "string" && /^0x[0-9a-f]{8,}$/i.test(arg)) {
        for (const abi of abis)
          try {
            const decoded = decodeErrorResult({
              abi,
              data: arg as `0x${string}`,
            });
            if (messages[decoded.errorName]) return messages[decoded.errorName];
          } catch {
            /* try next ABI */
          }
      }
  }
  if (reverted.data?.errorName && messages[reverted.data.errorName])
    return messages[reverted.data.errorName];
  const text = reverted.shortMessage ?? reverted.message ?? String(error);
  if (reverted.code === 4001 || /reject|denied|cancelled/i.test(text))
    return "Request declined in your wallet. You can try again.";
  if (
    /provider not found|provider is not available|connector not found/i.test(
      text,
    )
  )
    return "No browser wallet was found. Install one or choose Coinbase Wallet.";
  if (/insufficient funds/i.test(text))
    return "Not enough ETH for network fees. Add ETH to this wallet and retry.";
  if (/fetch|timeout|403|HTTP|network request/i.test(text))
    return "The network could not be reached. Retry or connect a wallet for a fallback connection.";
  if (/execution reverted|revert/i.test(text))
    return "The contract rejected this action. Refresh state and check your amount, allowance, and eligibility.";
  return text.length < 190
    ? text
    : "The request failed. Refresh state and retry; check your wallet for details.";
}
