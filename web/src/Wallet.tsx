import { useEffect, useRef, useState } from "react";
import {
  useConnection,
  useConnect,
  useConnectors,
  useDisconnect,
  type Connector,
} from "wagmi";
import { getAddress, type EIP1193Provider } from "viem";
import { ensureChain, type Runtime } from "./config";
import { errorMessage } from "./domain";

export const OPEN_IN = [
  {
    id: "metaMask",
    name: "MetaMask",
    href: (url: string) =>
      `https://link.metamask.io/dapp/${url.replace(/^https?:\/\//, "")}`,
  },
  {
    id: "coinbase",
    name: "Coinbase Wallet",
    href: (url: string) =>
      `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(url)}`,
  },
  {
    id: "rabby",
    name: "Rabby",
    href: (url: string) =>
      `https://go.rabby.io/mobile/?_cmd=open-dapp&dapp=${encodeURIComponent(url)}`,
  },
  {
    id: "phantom",
    name: "Phantom",
    href: (url: string) =>
      `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(new URL(url).origin)}`,
  },
];
export const short = (address: string) =>
  `${address.slice(0, 6)}…${address.slice(-4)}`;
export function Wallet({
  r,
  open,
  setOpen,
}: {
  r: Runtime;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const { address, isConnected, chainId, connector } = useConnection();
  const { connectAsync } = useConnect();
  const connectors = useConnectors();
  const { disconnect } = useDisconnect();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const wrong = isConnected && chainId !== r.chain.id;
  const named = connectors.some(
    (c) => c.type === "injected" && c.id !== "injected",
  );
  const mobile =
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) &&
    !named &&
    !(window as Window & { ethereum?: unknown }).ethereum;
  const listed = [
    ...connectors.filter((c) => c.type === "injected"),
    ...connectors.filter((c) => c.type !== "injected"),
  ].filter(
    (c) =>
      !(named && c.id === "injected") && !(mobile && c.type === "injected"),
  );
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    else if (!open && dialog.current?.open) dialog.current?.close();
  }, [open]);
  async function connect(c: Connector) {
    setBusy(c.uid);
    setError("");
    try {
      await connectAsync({ connector: c });
      const p = (await c.getProvider()) as EIP1193Provider;
      await ensureChain(p, r);
      setOpen(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy("");
    }
  }
  async function switchNetwork() {
    if (!connector) return;
    setBusy("switch");
    setError("");
    try {
      await ensureChain((await connector.getProvider()) as EIP1193Provider, r);
    } catch (e) {
      setError(errorMessage(e));
      setOpen(true);
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <button
        className="wallet-control"
        onClick={() => (wrong ? void switchNetwork() : setOpen(true))}
        disabled={!!busy}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <rect x="3" y="5" width="18" height="15" rx="3" />
          <path d="M3 9h18M16 14h2" />
        </svg>
        {busy === "switch"
          ? "Switching…"
          : wrong
            ? `Switch to ${r.chain.name}`
            : isConnected && address
              ? short(getAddress(address))
              : "Connect"}
      </button>
      <dialog
        ref={dialog}
        className="wallet-dialog"
        onCancel={() => setOpen(false)}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === dialog.current) {
            const rect = dialog.current.getBoundingClientRect();
            if (
              e.clientX < rect.left ||
              e.clientX > rect.right ||
              e.clientY < rect.top ||
              e.clientY > rect.bottom
            )
              setOpen(false);
          }
        }}
        aria-labelledby="wallet-title"
      >
        <div className="dialog-heading">
          <h2 id="wallet-title">
            {isConnected ? "Your wallet" : "Connect a wallet"}
          </h2>
          <button
            className="icon-button"
            aria-label="Close wallet menu"
            onClick={() => setOpen(false)}
          >
            ×
          </button>
        </div>
        {isConnected && address ? (
          <>
            <p className="address-full">{getAddress(address)}</p>
            <p>
              {wrong ? `Switch to ${r.chain.name} to continue.` : r.chain.name}
            </p>
            {wrong && (
              <button
                className="wallet-row"
                onClick={switchNetwork}
                disabled={!!busy}
              >
                Switch network
              </button>
            )}
            <button
              className="wallet-row"
              onClick={() => {
                disconnect();
                setOpen(false);
              }}
            >
              Disconnect
            </button>
          </>
        ) : (
          <>
            {mobile &&
              OPEN_IN.map((w) => (
                <a
                  className="wallet-row"
                  key={w.id}
                  href={w.href(location.href)}
                >
                  <img
                    src={`${import.meta.env.BASE_URL}wallets/${w.id}.svg`}
                    alt=""
                    width="28"
                    height="28"
                  />
                  Open in {w.name}
                  <span aria-hidden="true">↗</span>
                </a>
              ))}
            {listed.map((c) => (
              <button
                className="wallet-row"
                key={c.uid}
                onClick={() => void connect(c)}
                disabled={!!busy}
              >
                {c.icon ? (
                  <img src={c.icon} alt="" width="28" height="28" />
                ) : c.id === "coinbaseWalletSDK" ? (
                  <img
                    src={`${import.meta.env.BASE_URL}wallets/coinbase.svg`}
                    alt=""
                    width="28"
                    height="28"
                  />
                ) : (
                  <svg
                    width="28"
                    height="28"
                    viewBox="0 0 28 28"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <rect x="3" y="5" width="22" height="19" rx="4" />
                    <path d="M3 10h22m-7 6h3" />
                  </svg>
                )}
                {busy === c.uid
                  ? "Opening wallet…"
                  : c.id === "injected"
                    ? "Browser wallet"
                    : c.id === "coinbaseWalletSDK"
                      ? mobile
                        ? "Coinbase Smart Wallet"
                        : "Coinbase Wallet"
                      : c.name}
              </button>
            ))}
            {!mobile && !named && (
              <p className="muted small">
                Use a browser wallet or Coinbase Wallet. On a phone, open this
                page in your wallet’s browser.
              </p>
            )}
          </>
        )}
        <p className="error small" role="status">
          {error}
        </p>
      </dialog>
    </>
  );
}
