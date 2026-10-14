# Rekt Blitz frontend

A static Vite + React + TypeScript app for the deployed REKTD/IMD blitz jackpot on Robinhood Chain. The publication entrypoint is `dist/index.html`; upload **all of `dist/` together**, including `imd-deployment.json`, `abi/`, images, wallet marks, and JavaScript/CSS chunks. The publisher does not need to rebuild it. Relative URLs and in-page anchors support gateway subpaths without server rewrites.

## Install, build, and preview

Use Node 22.12+ (worker: Node 24.21.0) and npm. The source manifest and npm lockfile are in this directory. Dependencies and build caches are not part of the submission; no ignore file was changed. This staged workflow keeps `node_modules` entirely outside the repository:

```sh
# Run from the repository root.
REKT_STAGE=$(mktemp -d /tmp/rekt-web.XXXXXX)
mkdir -p "$REKT_STAGE/web" "$REKT_STAGE/docs"
cp -R web/. "$REKT_STAGE/web/"
cp -R docs/abi "$REKT_STAGE/docs/abi"
cd "$REKT_STAGE/web"
npm ci --cache /tmp/rekt-npm-cache
npm run build
npm test
npm run verify
npm run preview
```

`npm run build` runs TypeScript checking, writes the static export to the staging root’s `dist/`, verifies attested ABIs, copies the router ABI, and inventories every exported file with SHA-256. `npm run typecheck` runs checking alone. The build reports a nonfatal 500 kB chunk-size advisory; the complete export is under 1 MiB.

After a successful staged build, replace the repository’s generated `dist/` with that entire staging `dist/` directory. Remove the previous export first so old hashed chunks cannot remain outside the manifest inventory. Keep all source edits in `web/`; copy them into the staging `web/` before rebuilding. Do not copy installed dependencies back. No submodules, package archives, caches, or registry mirrors are needed.

For hot reload in the staging tree, `npm run dev` first builds the runtime handoff, then starts Vite. Its development-only middleware serves the same generated deployment manifest and ABIs. Production requires only static hosting. The PNG share image is committed with its editable vector source at `artwork/share.svg`.

## Deployment and routing

`deployment/handoff.json` and `deployment/network.json` preserve the task inputs so builds still work after `.imd/reads/` is removed. `scripts/export.mjs` emits the handoff’s version, launch ID, chain, source commit, attestation hash, and complete contract set. The network and wallet-add-chain objects remain unchanged. The supplied handoff has **no `poolKey`**, so the app reads and validates it from `RektJackpotHook.poolKey()`; the exporter preserves it exactly if a future handoff contains one.

The app loads **`dist/imd-deployment.json` at runtime**. It is the deployment source of truth, not an independent compiled address map. `src/config.ts` owns its schema/loader, the approved router exception, price limits, ABI definitions, chain construction, transports, and wallet connector configuration. Token and hook ABI bytes are copied from `docs/abi/`; their canonical JSON Keccak-256 hashes match the handoff. Every loaded ABI, including the companion router, is also checked against the manifest’s SHA-256 inventory.

The owner explicitly approved this routing exception:

| Operation | Destination |
| --- | --- |
| IMD and REKTD ERC-20 `approve` | `RektSwapRouter`, `0xFc411Cb7123c94480BBF00095428c37cc5C94531` |
| Buy/sell execution and funded simulation | That router’s `swap(bool,int256,uint256,uint160,uint256)` |
| Disconnected/unapproved estimate | Live pool price/liquidity from the supplied StateView |
| Game reads, settlement, payout retry, ownership controls | Handoff `RektJackpotHook` |

The network’s UniversalRouter, Permit2, and Quoter remain in the unchanged manifest as network data. **None is called.** Buys use `zeroForOne=true`, negative exact input, and `4295128740`; sells use `false`, negative exact input, and `1461446703485210103287273052203988822378723970341`. No ETH value accompanies swaps. Approval is limited to the entered input amount.

Before enabling signing, the app checks the RPC chain ID; nonempty token, IMD, hook, router, and manager code; token symbols/decimals; initialized pool; router/hook/manager bindings; and exact pool currencies, fee, tick spacing, and hook. A router replacement that differs from this task’s approved address disables signing. It requires a separately authorized frontend configuration update, not automatic trust in an arbitrary replacement.

## Quotes, timing, and transactions

- Without sufficient balance/allowance, a clearly labeled estimate uses current square-root price, active liquidity, the LP/protocol fee, and the 1% IMD hook fee. It assumes the current liquidity range; crossing ticks can change the result. Missing pool state shows “Unavailable” without blocking the form or wallet connection.
- Once funded and approved, `eth_call` simulates the actual router from the wallet with `limit=1` to obtain output. That permissive limit is **never broadcast**. The selected 0.5%, 1%, 2%, or 3% slippage determines the minimum output; the protected call is simulated again before asking the wallet to sign. The deadline is five minutes from the sampled chain timestamp.
- Snapshot reads use one block number. A local one-second display interpolates from that block’s timestamp; a zero timer is not settlement authorization. The button uses the contract’s `canSettle()`, which requires a block strictly after expiry. An inactive round is explicitly labeled and shows its 10-minute starting duration.
- Public state and balances refresh every five seconds while visible. HTTP requests are batched; both supplied RPCs are tried, then a connected wallet provider on the correct chain. Signing is disabled on stale/error state. Runtime verification refreshes every 30 seconds and runs again before each signed action.
- Every action has its own simulation, wallet, confirmation, refresh, success, and error status. A shared submission lock prevents overlapping actions. Unknown confirmation status keeps signing locked and checks receipts automatically. Confirmed cancellation/revert is distinct from success; a failed post-confirmation refresh does not misreport the transaction itself.
- Successful exact-input sells may spend less and refund the rest; the simulated spend appears in trade details. Ticket eligibility is computed with integer units. The minimum ticket is displayed with full token precision.
- History reads at most five round IDs at a time. Allocated prize/fee totals can include parked payouts; the page explains this and offers `claimPayout(connectedWallet)`. Burning transfers IMD to the source-defined sink and does not reduce token supply.

Ownership controls appear only for the connected owner or pending owner. The contract has no unset post-launch setup required to trade. Callback-only functions and router-only fee redemption are intentionally not exposed as user actions. No distributor is invented: it is absent from the authoritative deployment contract set.

## Wallets

Wagmi EIP-6963 discovery lists installed extensions by name/icon; the generic “Browser wallet” row is hidden when named providers exist. Coinbase Wallet uses the bundled official SDK, including its Smart Wallet/passkey entry. Phones without an injected provider get MetaMask, Coinbase Wallet, Rabby, and Phantom “Open in” links preserving the full current page URL. There is no relay or WalletConnect project ID.

Connection attempts switch to the configured chain. An unknown-chain error offers `wallet_addEthereumChain` with the exact handoff parameters, then switches again. Rejected switching keeps the wrong-network control visible and transaction actions disabled. The native dialog traps focus, closes with Escape/backdrop/close, and restores focus.

Reference APIs: [Wagmi configuration](https://wagmi.sh/react/api/createConfig), [Viem simulation](https://viem.sh/docs/contract/simulateContract). Rabby’s link uses the vendor’s [`_cmd=open-dapp` and `dapp` handler](https://github.com/RabbyHub/rabby-mobile/blob/develop/apps/mobile/src/hooks/universalLink.ts). Vendor URLs can change; real mobile app handoffs and passkey onboarding were not performed on this worker.

## Validation

After building:

```sh
npm run typecheck
npm test
npm run verify
npx playwright install chromium webkit
REKT_BROWSER=both npm run test:browser
```

The browser suite uses installed Chrome for Chromium and Playwright WebKit. It serves the actual export byte-for-byte at `/preview/` through browser request interception and mocks all chain/wallet requests; it cannot send real transactions. Set `REKT_TEST_OUT` to an absolute scratch directory to place screenshots/results elsewhere. The suite checks calldata, approval destination/amount, chain switching, pending locks, errors, settlement, claims, history, long-value reflow, accessibility, and ABI integrity failure.

The pinned taste probe is an assignment input, not a runtime dependency. On a normal worker run it from the root with its documented command. On this worker, local Chrome rejected loopback HTTP, so `tests/loopback-transport.mjs` forwarded only the probe’s loopback requests through Node to the unchanged local HTTP server:

```sh
NODE_OPTIONS=--import=/absolute/staging/web/tests/loopback-transport.mjs \
IMD_PLAYWRIGHT=/absolute/staging/web/node_modules/playwright/index.mjs \
node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste
```

No test fixtures, mocked accounts, browser dependencies, or test adapters are exported in `dist/`. See [the final validation record](../docs/frontend/VALIDATION.md) for measured results, review findings, screenshot provenance, exact limitations, and live read evidence. These are worker checks, not an independent certification or proof of live signed transactions.
