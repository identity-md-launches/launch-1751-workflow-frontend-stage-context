import { useEffect, useMemo, useRef, useState } from "react";
import { useConnection } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import {
  formatUnits,
  getAddress,
  isAddress,
  isAddressEqual,
  type Address,
  type EIP1193Provider,
} from "viem";
import {
  erc20Abi,
  explorerAddress,
  POLL_MS,
  ROUTER,
  STALE_MS,
  type Runtime,
} from "./config";
import {
  amount,
  countdown,
  clockText,
  inputAmount,
  estimate,
  minimumOutput,
  errorMessage,
  type Side,
} from "./domain";
import {
  readSnapshot,
  readBalances,
  readHistory,
  verifyDeployment,
  simulateQuote,
  sendAction,
  protectedSwap,
  noLeader,
  pending,
  type Action,
  type ActionState,
} from "./chain";
import { Wallet } from "./Wallet";

function AddressValue({
  r,
  address,
  label,
}: {
  r: Runtime;
  address: Address;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(getAddress(address));
      setCopied(true);
      setFailed(false);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setFailed(true);
    }
  }
  return (
    <span className="address-value">
      <a
        href={explorerAddress(r, address)}
        target="_blank"
        rel="noreferrer"
        aria-label={
          label ? `${label}: ${getAddress(address)} on explorer` : undefined
        }
      >
        {getAddress(address)}
      </a>
      <button
        className="copy"
        aria-label={`Copy ${label ?? "address"}`}
        onClick={() => void copy()}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      {failed && <span role="status">Select the address to copy it.</span>}
    </span>
  );
}
const initialActions = Object.fromEntries(
  [
    "approve",
    "trade",
    "settle",
    "claim",
    "configure",
    "transfer",
    "accept",
  ].map((x) => [x, { phase: "idle" }]),
) as Record<Action, ActionState>;
function TxStatus({ r, state }: { r: Runtime; state: ActionState }) {
  const messages = {
    idle: "",
    simulating: "Checking this action…",
    signing: "Confirm in your wallet…",
    confirming: "Waiting for confirmation…",
    refreshing: "Confirmed. Updating balances…",
    unknown: "Confirmation is still pending. Checking again automatically…",
    success: "Confirmed on chain.",
    error: state.message,
  };
  return (
    <div
      className={`tx-status ${state.phase === "error" ? "error" : ""}`}
      role="status"
    >
      {state.message ?? messages[state.phase]}{" "}
      {state.hash && (
        <a
          href={`${r.deployment.network.explorer}/tx/${state.hash}`}
          target="_blank"
          rel="noreferrer"
        >
          View transaction ↗
        </a>
      )}
    </div>
  );
}
export function App({ r }: { r: Runtime }) {
  const { address, chainId, isConnected, connector } = useConnection();
  const [walletOpen, setWalletOpen] = useState(false),
    [provider, setProvider] = useState<EIP1193Provider>();
  const [side, setSide] = useState<Side>("buy"),
    [text, setText] = useState(""),
    [slippage, setSlippage] = useState(100),
    [now, setNow] = useState(Date.now()),
    [historyPage, setHistoryPage] = useState(0);
  const [actions, setActions] = useState(initialActions),
    [newRouter, setNewRouter] = useState(""),
    [newOwner, setNewOwner] = useState("");
  const lock = useRef(false);
  useEffect(() => {
    let active = true;
    setProvider(undefined);
    if (connector && chainId === r.chain.id)
      void connector
        .getProvider()
        .then((p) => {
          if (active) setProvider(p as EIP1193Provider);
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [connector, chainId, r.chain.id]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const c = useMemo(() => r.client(provider), [r, provider]);
  const state = useQuery({
    queryKey: ["state", !!provider],
    queryFn: () => readSnapshot(c, r),
    refetchInterval: POLL_MS,
    retry: 0,
  });
  const verification = useQuery({
    queryKey: ["verification", !!provider],
    queryFn: () => verifyDeployment(c, r),
    refetchInterval: 30000,
    retry: 0,
  });
  const balances = useQuery({
    queryKey: ["balances", address, chainId, !!provider],
    queryFn: () => readBalances(c, r, address!),
    enabled: !!address && chainId === r.chain.id,
    refetchInterval: POLL_MS,
    retry: 0,
  });
  const s = state.data,
    b = balances.data,
    wrong = isConnected && chainId !== r.chain.id;
  const fresh = !!s && !state.isError && now - s.sampledAt < STALE_MS;
  const verified =
    !!verification.data &&
    !verification.isError &&
    now - verification.data.verifiedAt < STALE_MS &&
    !!s &&
    isAddressEqual(s.router, ROUTER);
  const ready = !!address && !wrong && fresh && verified;
  const walletFresh =
    !!b &&
    b.account === address &&
    !balances.isError &&
    now - b.sampledAt < STALE_MS;
  const busy = Object.values(actions).some(pending);
  const inputSymbol = side === "buy" ? "IMD" : "REKTD",
    outputSymbol = side === "buy" ? "REKTD" : "IMD";
  const decimals = side === "buy" ? r.imd.decimals : 18,
    outputDecimals = side === "buy" ? 18 : r.imd.decimals;
  const input = inputAmount(text, decimals),
    balance = b ? (side === "buy" ? b.imd : b.rekt) : undefined,
    allowance = b
      ? side === "buy"
        ? b.imdAllowance
        : b.rektAllowance
      : undefined;
  const needsApproval = allowance !== undefined && input > allowance;
  const canQuote =
    ready &&
    walletFresh &&
    input > 0n &&
    balance !== undefined &&
    balance >= input &&
    !needsApproval;
  const quote = useQuery({
    queryKey: [
      "quote",
      address,
      side,
      input.toString(),
      s?.block.toString(),
      allowance?.toString(),
    ],
    queryFn: () =>
      simulateQuote(c, r, address!, side, input, s!.timestamp + 300n),
    enabled: canQuote,
    retry: 0,
    staleTime: 5000,
  });
  const fallback = s?.pool
    ? estimate(
        side,
        input,
        s.pool.sqrt,
        s.pool.liquidity,
        s.pool.lpFee,
        s.pool.protocolFee,
      )
    : undefined;
  const exact =
    canQuote && !quote.isError && quote.data ? quote.data : undefined;
  const output = exact?.amountOut ?? fallback;
  const quoteFresh = !!exact && now - exact.quotedAt < 20000;
  const history = useQuery({
    queryKey: ["history", s?.roundId.toString(), historyPage, !!provider],
    queryFn: () => readHistory(c, r, s!.roundId, historyPage),
    enabled: !!s,
    retry: 0,
  });
  const remaining = s
    ? countdown(s.roundEndTime, s.timestamp, s.sampledAt, now)
    : 0;
  const active = !!s && !noLeader(s.currentLeader);
  const expired = active && remaining === 0;
  const qualified = side === "buy" && !!s && input >= s.minimumTicket;
  const allRefresh = async () => {
    await Promise.all([
      state.refetch({ throwOnError: true }),
      balances.refetch({ throwOnError: true }),
      verification.refetch({ throwOnError: true }),
      history.refetch({ throwOnError: true }),
    ]);
  };
  // A timeout/RPC interruption after broadcast is not a failed transaction.
  // Keep all signing controls locked until a receipt resolves the uncertainty.
  useEffect(() => {
    const unknown = Object.entries(actions).filter(
      ([, value]) => value.phase === "unknown" && value.hash,
    );
    if (!unknown.length) return;
    let stopped = false,
      inFlight = false;
    const check = async () => {
      if (inFlight) return;
      inFlight = true;
      for (const [action, value] of unknown)
        try {
          const receipt = await c.getTransactionReceipt({ hash: value.hash! });
          if (stopped) break;
          await Promise.all([
            state.refetch(),
            balances.refetch(),
            verification.refetch(),
          ]);
          setActions((old) => ({
            ...old,
            [action]: {
              phase: receipt.status === "success" ? "success" : "error",
              hash: receipt.transactionHash,
              message:
                receipt.status === "success"
                  ? "Confirmed on chain."
                  : "The transaction reverted. Refresh and retry.",
            },
          }));
        } catch {
          /* Receipt absent or RPC unavailable: keep the pending lock. */
        }
      inFlight = false;
    };
    void check();
    const id = setInterval(() => void check(), POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [actions, c]);
  async function run(
    action: Action,
    fn: string,
    args: readonly unknown[] = [],
    target = r.hook.address,
    abi = r.hookAbi,
  ) {
    if (lock.current || busy || !ready || !address || !provider) return;
    lock.current = true;
    const update = (value: ActionState) =>
      setActions((old) => ({ ...old, [action]: value }));
    update({ phase: "simulating" });
    try {
      await sendAction({
        r,
        c,
        provider,
        account: address,
        address: target,
        abi,
        functionName: fn,
        args,
        onState: update,
        refresh: allRefresh,
      });
    } catch (e) {
      setActions((old) => {
        const message = errorMessage(e, [r.hookAbi, r.routerAbi, r.tokenAbi]);
        const uncertain =
          old[action].hash &&
          old[action].phase === "confirming" &&
          !/reverted|cancelled/i.test(message);
        return {
          ...old,
          [action]: {
            ...old[action],
            phase: uncertain ? "unknown" : "error",
            message: uncertain
              ? "Confirmation is still pending. Check the transaction link; automatic checks continue."
              : message,
          },
        };
      });
      void state.refetch();
      void balances.refetch();
    } finally {
      lock.current = false;
    }
  }
  function trade() {
    if (!ready || !walletFresh || !input || !balance || balance < input) return;
    if (needsApproval)
      void run(
        "approve",
        "approve",
        [ROUTER, input],
        side === "buy" ? r.imd.address : r.token.address,
        erc20Abi,
      );
    else if (exact && quoteFresh && s) {
      try {
        void run(
          "trade",
          "swap",
          protectedSwap(
            side,
            input,
            exact.amountOut,
            slippage,
            s.timestamp + 300n,
          ),
          ROUTER,
          r.routerAbi,
        );
      } catch (e) {
        setActions((old) => ({
          ...old,
          trade: { phase: "error", message: errorMessage(e) },
        }));
      }
    }
  }
  const actionLabel = !isConnected
    ? "Connect to trade"
    : wrong
      ? "Switch network above"
      : pending(actions.approve)
        ? "Approving…"
        : pending(actions.trade)
          ? "Trading…"
          : !fresh || !verified
            ? "Waiting for verified state"
            : !walletFresh
              ? "Reading wallet…"
              : !input
                ? "Enter an amount"
                : balance !== undefined && balance < input
                  ? `Insufficient ${inputSymbol}`
                  : needsApproval
                    ? `Approve ${inputSymbol}`
                    : quote.isFetching
                      ? "Checking quote…"
                      : !quoteFresh
                        ? "Refresh quote"
                        : `${side === "buy" ? "Buy" : "Sell"} REKTD`;
  const inputError =
    text && !input
      ? "Enter a positive amount with no more than 18 decimal places."
      : walletFresh && balance !== undefined && input > balance
        ? `Your ${inputSymbol} balance is too low.`
        : "";
  const roundStatus = !s
    ? "Reading round"
    : !fresh
      ? "State unavailable"
      : !active
        ? "Waiting for first buy"
        : s.canSettle
          ? "Ready to settle"
          : expired
            ? "Awaiting next block"
            : "Round active";
  const dataProblem = state.error ?? verification.error;
  return (
    <>
      <a className="skip-link" href="#trade">
        Skip to trade
      </a>
      <header className="site-header">
        <a className="brand" href="#" aria-label="Rekt Blitz home">
          <img
            src={`${import.meta.env.BASE_URL}favicon.svg`}
            width="32"
            height="32"
            alt=""
          />
          Rekt Blitz
        </a>
        <div className="header-tools">
          <span className="network-name">
            <span className="network-dot" /> {r.chain.name}
          </span>
          <Wallet r={r} open={walletOpen} setOpen={setWalletOpen} />
        </div>
      </header>
      <main className="container">
        <div className="page-heading">
          <div>
            <h1>Trade. Take the lead.</h1>
            <p>Buy REKTD. Be the last qualifying buyer.</p>
          </div>
          <a className="text-link" href="#rules">
            How the blitz works ↘
          </a>
        </div>
        <div className="arena">
          <section className="round-panel" aria-labelledby="round-title">
            <div className="section-line">
              <h2 id="round-title">The blitz jackpot</h2>
              <span className="round-state">
                <span className={`status-dot ${fresh ? "live" : ""}`} />
                {roundStatus}
              </span>
            </div>
            <div className="jackpot-number">
              <span>{amount(s?.jackpotPool, r.imd.decimals, 6)}</span>
              <span className="unit">IMD</span>
            </div>
            <div className="clock-row">
              <div>
                <span className="small muted">
                  {active ? "Time remaining" : "10-minute blitz"}
                </span>
                <div
                  className="clock"
                  role="timer"
                  aria-label={
                    active
                      ? `${remaining} seconds remaining`
                      : "No active countdown"
                  }
                >
                  {s ? (active ? clockText(remaining) : "10:00") : "··:··"}
                </div>
              </div>
              <div className="round-number">
                <span className="small muted">Current round</span>
                <strong>#{s ? s.roundId.toString() : "…"}</strong>
              </div>
            </div>
            <div className="time-track" aria-hidden="true">
              <span
                style={{
                  width: `${active ? Math.min(100, remaining / 6) : 0}%`,
                }}
              />
            </div>
            <div className="leader-row">
              <span className="muted small">Current leader</span>
              {s ? (
                active ? (
                  <AddressValue
                    r={r}
                    address={s.currentLeader}
                    label="Current leader"
                  />
                ) : (
                  <span>
                    No leader yet. The next qualifying buy starts the clock.
                  </span>
                )
              ) : (
                <span>Reading from chain…</span>
              )}
            </div>
            <div className="round-facts">
              <div>
                <span className="muted small">Minimum ticket</span>
                <strong>
                  {amount(s?.minimumTicket, r.imd.decimals, 18)} IMD
                </strong>
              </div>
              <div>
                <span className="muted small">Winner’s share · 60%</span>
                <strong>
                  {amount(
                    s ? (s.jackpotPool * 6000n) / 10000n : undefined,
                    r.imd.decimals,
                  )}{" "}
                  IMD
                </strong>
              </div>
            </div>
            <p className="small round-footnote">
              {expired
                ? "The next buy settles this pot first. Its ticket uses the rollover."
                : "Qualifying buys add 2 minutes, capped at 10 minutes from the buy."}
            </p>
          </section>
          <section
            className="trade-panel"
            id="trade"
            aria-labelledby="trade-title"
          >
            <div className="section-line">
              <h2 id="trade-title">Trade REKTD</h2>
              <div className="slippage">
                <label htmlFor="slippage">Slippage</label>
                <select
                  id="slippage"
                  aria-label="Slippage limit"
                  value={slippage}
                  disabled={busy}
                  onChange={(e) => setSlippage(Number(e.target.value))}
                >
                  <option value={50}>0.5%</option>
                  <option value={100}>1%</option>
                  <option value={200}>2%</option>
                  <option value={300}>3%</option>
                </select>
              </div>
            </div>
            <div
              className="trade-tabs"
              role="group"
              aria-label="Trade direction"
            >
              <button
                aria-pressed={side === "buy"}
                onClick={() => {
                  setSide("buy");
                  setText("");
                }}
                disabled={busy}
              >
                Buy
              </button>
              <button
                aria-pressed={side === "sell"}
                onClick={() => {
                  setSide("sell");
                  setText("");
                }}
                disabled={busy}
              >
                Sell
              </button>
            </div>
            <div className="input-heading">
              <label htmlFor="amount">You pay</label>
              {walletFresh && (
                <button
                  className="text-button"
                  onClick={() => setText(formatUnits(balance ?? 0n, decimals))}
                  disabled={busy}
                >
                  Use max
                </button>
              )}
            </div>
            <div className="amount-field">
              <input
                id="amount"
                name="amount"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={busy}
                aria-invalid={!!inputError}
                aria-describedby="amount-hint"
              />
              <span>{inputSymbol}</span>
            </div>
            <div className="balance-line small muted">
              Balance:{" "}
              {walletFresh
                ? `${amount(balance, decimals, 6)} ${inputSymbol}`
                : "connect to view"}
            </div>
            <div className="receive-line">
              <span>
                You receive{" "}
                <small className="muted">
                  {exact ? "simulated" : "estimate"}
                </small>
              </span>
              <strong>
                {input > 0n && output === undefined
                  ? "Unavailable"
                  : `${input > 0n ? amount(output, outputDecimals, 6) : "0"} ${outputSymbol}`}
              </strong>
            </div>
            <button
              className="primary trade-action"
              onClick={() =>
                !isConnected
                  ? setWalletOpen(true)
                  : canQuote && !quoteFresh
                    ? void quote.refetch()
                    : trade()
              }
              disabled={
                isConnected &&
                (wrong ||
                  !ready ||
                  !walletFresh ||
                  !input ||
                  balance === undefined ||
                  balance < input ||
                  busy ||
                  quote.isFetching)
              }
            >
              {actionLabel}
              <span aria-hidden="true">↗</span>
            </button>
            <div
              id="amount-hint"
              className={`small trade-hint ${inputError ? "error" : "muted"}`}
            >
              {inputError ||
                (!isConnected
                  ? "Connect your wallet to approve and trade."
                  : !input
                    ? "Enter an amount to preview your trade."
                    : qualified
                      ? "This buy meets the current minimum ticket."
                      : side === "buy"
                        ? "This amount trades, but does not take the lead."
                        : "Selling does not change the current leader.")}
            </div>
            <TxStatus r={r} state={actions.approve} />
            <TxStatus r={r} state={actions.trade} />
            {quote.isError && (
              <p className="small error" role="status">
                {errorMessage(quote.error, [r.hookAbi, r.routerAbi])}{" "}
                <button
                  className="text-button"
                  onClick={() => void quote.refetch()}
                >
                  Retry quote
                </button>
              </p>
            )}
            {balances.isError && (
              <p className="small error" role="status">
                Wallet balances could not be read.{" "}
                <button
                  className="text-button"
                  onClick={() => void balances.refetch()}
                >
                  Retry balances
                </button>
              </p>
            )}
            <details className="trade-details">
              <summary>Trade details</summary>
              <dl className="detail-list">
                <div>
                  <dt>Minimum received</dt>
                  <dd>
                    {exact
                      ? amount(
                          minimumOutput(exact.amountOut, slippage),
                          outputDecimals,
                          8,
                        )
                      : "After approval"}{" "}
                    {exact ? outputSymbol : ""}
                  </dd>
                </div>
                <div>
                  <dt>Pool fee</dt>
                  <dd>1.25%</dd>
                </div>
                <div>
                  <dt>Hook fee</dt>
                  <dd>1% of IMD</dd>
                </div>
                <div>
                  <dt>Deadline</dt>
                  <dd>5 minutes</dd>
                </div>
              </dl>
              <p className="small muted">
                Estimates use current price and liquidity, include fees, and may
                change across liquidity ranges. After approval, the router
                simulates the exact trade. Sells can partially fill and refund
                unused input.
              </p>
              {exact && exact.amountIn < input && (
                <p className="small">
                  Partial fill: {amount(exact.amountIn, decimals, 8)}{" "}
                  {inputSymbol} will be spent.
                </p>
              )}
              <p className="small muted">
                Approval permits this router to spend only the entered amount.
                Network fees are paid separately in ETH. USD pricing is
                unavailable.
              </p>
              <AddressValue
                r={r}
                address={ROUTER}
                label="Approved swap router"
              />
            </details>
          </section>
        </div>
        <div className="sync-line">
          <span className={dataProblem ? "error" : "muted"}>
            {dataProblem
              ? errorMessage(dataProblem)
              : fresh
                ? `Updated from block ${s!.block.toLocaleString()} · refreshes every 5 seconds`
                : "Connecting to the chain…"}
          </span>
          <button
            className="text-button"
            onClick={() => {
              void state.refetch();
              void verification.refetch();
              if (address) void balances.refetch();
            }}
            disabled={state.isFetching || verification.isFetching}
          >
            Refresh state
          </button>
        </div>
        <section
          className="statistics"
          aria-label="Lifetime jackpot statistics"
        >
          <div>
            <span>Total burned</span>
            <strong>
              {amount(s?.totalIMDBurned, r.imd.decimals)} <small>IMD</small>
            </strong>
          </div>
          <div>
            <span>Total prizes allocated</span>
            <strong>
              {amount(s?.totalPrizesPaid, r.imd.decimals)} <small>IMD</small>
            </strong>
          </div>
          <div>
            <span>Total creator fees allocated</span>
            <strong>
              {amount(s?.totalCreatorFeesPaid, r.imd.decimals)}{" "}
              <small>IMD</small>
            </strong>
          </div>
        </section>
        <div className="lower-grid">
          <section className="settlement" aria-labelledby="settle-title">
            <h2 id="settle-title">Close the round</h2>
            <p>
              Once time runs out, anyone can settle. The last leader receives
              60%, 20% is burned, and 20% starts the next pot.
            </p>
            <button
              className="secondary"
              onClick={() => void run("settle", "settleRound")}
              disabled={!ready || !s?.canSettle || busy}
            >
              {pending(actions.settle) ? "Settling…" : "Settle round"}
            </button>
            <p className="small muted">
              {!isConnected
                ? "Connect to settle when the round ends."
                : s?.canSettle
                  ? "Ready. You pay the ETH network fee; the prize goes to the recorded leader."
                  : expired
                    ? "Waiting for a block strictly after the deadline."
                    : "Settlement opens after the onchain deadline."}
            </p>
            <TxStatus r={r} state={actions.settle} />
          </section>
          <section className="wallet-balances" aria-labelledby="balances-title">
            <h2 id="balances-title">Your balances</h2>
            <dl className="detail-list">
              <div>
                <dt>IMD</dt>
                <dd>
                  {walletFresh
                    ? amount(b.imd, r.imd.decimals, 6)
                    : "Connect to view"}
                </dd>
              </div>
              <div>
                <dt>REKTD</dt>
                <dd>
                  {walletFresh ? amount(b.rekt, 18, 6) : "Connect to view"}
                </dd>
              </div>
              <div>
                <dt>ETH · network fees</dt>
                <dd>
                  {walletFresh ? amount(b.eth, 18, 8) : "Connect to view"}
                </dd>
              </div>
              <div>
                <dt>Pending payout · IMD</dt>
                <dd>
                  {walletFresh
                    ? amount(b.payout, r.imd.decimals, 6)
                    : "Connect to view"}
                </dd>
              </div>
            </dl>
            <button
              className="secondary"
              disabled={!ready || !walletFresh || !b?.payout || busy}
              onClick={() =>
                address && void run("claim", "claimPayout", [address])
              }
            >
              {pending(actions.claim) ? "Retrying payout…" : "Retry my payout"}
            </button>
            <p className="small muted">
              A refused transfer stays claimable here. Retrying sends it only to
              your connected wallet.
            </p>
            <TxStatus r={r} state={actions.claim} />
          </section>
        </div>
        <section className="history-section" aria-labelledby="history-title">
          <div className="section-line">
            <h2 id="history-title">Round history</h2>
            <span className="muted small">Recorded on chain</span>
          </div>
          {!s ? (
            <p className="empty">
              History will appear when the chain connection is available.
            </p>
          ) : history.isPending ? (
            <p className="empty">Loading completed rounds…</p>
          ) : history.isError ? (
            <p className="error">
              History could not be loaded.{" "}
              <button
                className="text-button"
                onClick={() => void history.refetch()}
              >
                Retry history
              </button>
            </p>
          ) : history.data?.length === 0 ? (
            <p className="empty">
              No completed rounds yet. The first settled round will appear here.
            </p>
          ) : (
            <div className="history-list">
              {history.data?.map((round) => (
                <details key={round.id.toString()} className="history-item">
                  <summary>
                    <span>Round {round.id.toString()}</span>
                    <span>{amount(round.prize, r.imd.decimals)} IMD prize</span>
                    <span aria-hidden="true">+</span>
                  </summary>
                  <div className="history-body">
                    <AddressValue
                      r={r}
                      address={round.winner}
                      label={`Round ${round.id} winner`}
                    />
                    <dl className="detail-list">
                      <div>
                        <dt>Pot</dt>
                        <dd>{amount(round.pot, r.imd.decimals)} IMD</dd>
                      </div>
                      <div>
                        <dt>Burned</dt>
                        <dd>{amount(round.burned, r.imd.decimals)} IMD</dd>
                      </div>
                      <div>
                        <dt>Rollover</dt>
                        <dd>{amount(round.rollover, r.imd.decimals)} IMD</dd>
                      </div>
                      <div>
                        <dt>Ended</dt>
                        <dd>
                          {new Date(
                            Number(round.endTime) * 1000,
                          ).toLocaleString()}
                        </dd>
                      </div>
                      <div>
                        <dt>Settled</dt>
                        <dd>
                          {new Date(
                            Number(round.settledAt) * 1000,
                          ).toLocaleString()}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </details>
              ))}
            </div>
          )}
          <div className="pagination">
            <button
              onClick={() => setHistoryPage(Math.max(0, historyPage - 1))}
              disabled={historyPage === 0 || history.isFetching}
            >
              Newer
            </button>
            <span className="small">Page {historyPage + 1}</span>
            <button
              onClick={() => setHistoryPage(historyPage + 1)}
              disabled={
                !s ||
                s.roundId - 1n <= BigInt((historyPage + 1) * 5) ||
                history.isFetching
              }
            >
              Older
            </button>
          </div>
        </section>
        <section className="rules" id="rules" aria-labelledby="rules-title">
          <h2 id="rules-title">How the blitz works</h2>
          <div className="rules-grid">
            <div>
              <span className="rule-number">01</span>
              <h3>Buy to lead</h3>
              <p>
                Spend at least the live minimum ticket in IMD to take the lead.
                Smaller buys still trade and pay fees.
              </p>
            </div>
            <div>
              <span className="rule-number">02</span>
              <h3>Watch the clock</h3>
              <p>
                The first qualifying buy starts 10 minutes. Each later one adds
                2 minutes, with a 10-minute cap from that buy.
              </p>
            </div>
            <div>
              <span className="rule-number">03</span>
              <h3>Settle the pot</h3>
              <p>
                The leader at expiry gets 60%. Another qualifying buy can
                replace you before expiry. A trade does not guarantee a prize.
              </p>
            </div>
          </div>
          <p className="small muted">
            Every swap charges a 1% IMD hook fee: half to the pot, half to the
            creator, plus the pool fee. Lifetime totals include allocations
            whose transfers are pending. Burned IMD goes to the contract’s burn
            sink; token supply is not reduced.
          </p>
        </section>
        {address &&
          s &&
          (isAddressEqual(address, s.owner) ||
            isAddressEqual(address, s.pendingOwner)) && (
            <details className="owner-panel">
              <summary>Contract administration</summary>
              <p className="small">
                Only the owner can change the router or nominate a new owner.
                Router replacements must have identical runtime code. This app
                only authorizes the router approved for this deployment.
              </p>
              {isAddressEqual(address, s.owner) && (
                <>
                  <label htmlFor="router-address">Replacement router</label>
                  <input
                    id="router-address"
                    value={newRouter}
                    onChange={(e) => setNewRouter(e.target.value.trim())}
                    placeholder="Contract address"
                  />
                  <button
                    disabled={
                      !ready ||
                      busy ||
                      !isAddress(newRouter) ||
                      isAddressEqual(newRouter as Address, ROUTER)
                    }
                    onClick={() =>
                      void run("configure", "configureRouter", [
                        getAddress(newRouter),
                      ])
                    }
                  >
                    Configure router
                  </button>
                  <TxStatus r={r} state={actions.configure} />
                  <label htmlFor="owner-address">New owner</label>
                  <input
                    id="owner-address"
                    value={newOwner}
                    onChange={(e) => setNewOwner(e.target.value.trim())}
                    placeholder="Recipient address"
                  />
                  <button
                    disabled={
                      !ready ||
                      busy ||
                      !isAddress(newOwner) ||
                      noLeader(newOwner as Address)
                    }
                    onClick={() =>
                      void run("transfer", "transferOwnership", [
                        getAddress(newOwner),
                      ])
                    }
                  >
                    Nominate owner
                  </button>
                  <TxStatus r={r} state={actions.transfer} />
                </>
              )}
              {isAddressEqual(address, s.pendingOwner) && (
                <>
                  <button
                    disabled={!ready || busy}
                    onClick={() => void run("accept", "acceptOwnership")}
                  >
                    Accept ownership
                  </button>
                  <TxStatus r={r} state={actions.accept} />
                </>
              )}
            </details>
          )}
        <footer>
          <div className="footer-heading">
            <span className="brand">Rekt Blitz</span>
            <span className="small muted">On {r.chain.name}</span>
          </div>
          <details>
            <summary>Contract addresses & verification</summary>
            <div className="contract-list">
              {[
                ["RektJackpotHook", r.hook.address],
                ["REKTD token", r.token.address],
                ["IMD token", r.imd.address],
                ["RektSwapRouter", ROUTER],
              ].map(([name, a]) => (
                <div key={name}>
                  <span>{name}</span>
                  <AddressValue r={r} address={a as Address} label={name} />
                </div>
              ))}
            </div>
            <p className="small muted">
              {verified
                ? "Contract code, token metadata, router bindings, and pool settings verified on this connection."
                : "Contract verification is pending. Transactions remain disabled until it succeeds."}{" "}
              Source commit:{" "}
              <span className="address-full">{r.deployment.sourceCommit}</span>
            </p>
          </details>
          <p className="small muted">
            Amounts are in token units. USD pricing is unavailable.
          </p>
        </footer>
      </main>
    </>
  );
}
