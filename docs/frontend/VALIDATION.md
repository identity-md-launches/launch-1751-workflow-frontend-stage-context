# Frontend validation record

Validated on 2026-10-14 on this worker. This is a record of local checks, not independent certification. No real approval, swap, settlement, claim, ownership change, or deployment was broadcast.

## Delivered behavior

The source is in `web/`, the reproducible npm lockfile is `web/package-lock.json`, and the complete static site is in `dist/`. The existing Solidity, ABI exports, Foundry configuration, and contract dependencies are unchanged. The frontend loads the deployed handoff from `imd-deployment.json` at runtime and uses local ABI assets. Vite has a relative base; the browser suite loads the export at `/preview/` without rewrites.

| Requirement | Implementation and validation |
| --- | --- |
| Approved routing exception | Both token approvals target only `0xFc411Cb7123c94480BBF00095428c37cc5C94531`. Funded quotes and execution call that router. Buy/sell direction, negative input, exact price bounds, zero ETH value, and slippage minimums are asserted in both browser engines. UniversalRouter, Permit2, and Quoter are never called. |
| Nonblocking quotes | Disconnected/zero-allowance quotes use live StateView price, liquidity, LP/protocol fee and hook fee. They are labeled estimates and excluded from signed minimums. Funded execution requires a fresh router simulation and a second protected simulation. RPC failure leaves input and connection usable. |
| Live game state | Jackpot, leader, minimum ticket, three lifetime totals, round history, wallet balances, and claimable payout are read. Snapshot values share a block number. A one-second countdown interpolates chain time; actual settlement eligibility uses `canSettle()`. |
| Primary actions | Buy, sell, exact approval, settle, and own-wallet payout retry have controls. Owner/pending-owner controls cover router configuration and two-step ownership. Callbacks, disabled renunciation, and router-internal fee redemption are not visitor actions. |
| Wallets and wrong chain | EIP-6963, bundled Coinbase SDK entry, mobile deep links, rejection recovery, exact unknown-chain add parameters, and switch-again behavior are implemented. Signing is disabled on wrong/stale/unverified state. |
| Runtime handoff | Launch ID, chain, source commit, attestation hash and complete two-contract set match the supplied handoff. `network` and `walletAddChain` are unchanged. No extra routing/address/URL top-level field is added. The handoff has no `poolKey`; the app reads and validates it from the hook. |
| Integrity and static hosting | Canonical Keccak ABI hashes match both handoff entries. All 15 exported assets other than the manifest have verified SHA-256 entries. Runtime loading also checks ABI bytes, including the companion router. Relative paths, local assets, favicon, description, title, `og:title`, and `og:image` pass. |

The router is a constructor-deployed companion, not a third attested contract. Its source-derived ABI is exported and inventoried without inventing a handoff contract entry. The supplied generic Uniswap addresses remain intact as network data; the task’s explicit routing exception governs calls. No distributor contract is present in the handoff, so none is invented.

## Build and automated checks

Dependencies were installed in `/tmp/rekt-build/web`, with caches and browser runtimes outside the repository. Node 24.21.0 and npm 11.19.0 were used. The pinned lockfile includes the Coinbase SDK explicitly; no dependency directory or package archive is submitted.

| Check | Result |
| --- | --- |
| `npm run build` | Pass: TypeScript, Vite production output, ABI verification and manifest generation. One nonfatal Vite advisory for a JavaScript chunk over 500 kB. |
| `npm run typecheck` | Pass, no TypeScript errors. |
| `npm test` | 11 passing tests: decimal bounds, fee-aware estimate, router direction/limits, deadlines, add-chain recovery, rejected switching, replacement cancellation, reverted receipt, refresh failure after confirmation, and missing-code safety. |
| `npm run verify` | Pass: exact handoff fields and contract set, unchanged network, canonical ABI hashes, complete SHA-256 inventory, path safety and relative HTML. |
| Development server | Manifest, companion ABI, and TypeScript entry returned HTTP 200; development manifest bytes matched the generated export. |
| Chromium and WebKit interactions | Both engines pass all scenarios in `web/tests/browser.mjs`; retained [results](evidence/browser-results.json). |
| axe accessibility | No reported WCAG 2 A/AA, 2.1 AA or 2.2 AA violations in the tested connected state: [Chromium](evidence/chromium-axe.json), [WebKit](evidence/webkit-axe.json). This is not a complete accessibility audit. |
| Pinned design probe | 16/16 pass on the final source/export; retained [raw report](evidence/taste.json), timestamp 16:54:33 UTC. |

The browser suite exercises the actual exported bytes with mocked RPC and EIP-1193 wallet responses. It checks explicit approval amounts, input-token destinations, both swap directions, the selected 2% sell slippage, pending locks through receipt confirmation, and a simulated 120-second timeout with automatic recovery. It also covers wallet rejection/retry, wrong chain, chain addition, deployed-code failure, HTTP-to-wallet read fallback, insufficient balance, excess precision, simulation failure, expired-round settlement, recipient-bound claims, pagination, ABI tampering, unavailable RPC, keyboard dialog closure/focus restoration, clipboard absence, mobile links, and zero uncaught script errors. The clock is accelerated by the test; no real-time two-minute wait is required.

Local Chrome refused loopback HTTP in this environment. The suite therefore intercepts only its static preview origin and returns the real export bytes. The unmodified pinned taste probe used `web/tests/loopback-transport.mjs`, a Node transport adapter forwarding its loopback requests to its own static server. The adapter does not alter DOM, CSS, measurements, checks, or results. WebKit’s system libraries and browsers were provisioned under `/tmp`; none is a deliverable or runtime requirement.

## Live read-only observation

The available browser tool independently loaded the final static export over localhost and reached the configured public RPC. It observed chain ID 4663, nonempty deployed token/hook code, and the app’s successful contract/pool binding verification. At 16:58:23 UTC, block 88,527,709, the page displayed round 2, no current leader, a 1 IMD minimum ticket, approximately 0.004597 IMD in the pot, and the first settled history row. These are a dated observation, not fixed application values.

With 1 IMD entered and no wallet connected, the live pool estimate displayed 388,385.71048 REKTD. This is an estimate from that sampled pool state, not a promised output or a funded simulation. The connected-wallet balance/allowance path was tested with fixtures, not a funded real wallet.

A same-origin iframe created a true 390 × 844 CSS viewport in the browser tool. `scrollWidth` was 390 and the full primary action ended at y=826.125px. The product, wallet button, jackpot/timer, input, and action are visible on that first screen. The desktop viewport was 1280px with no horizontal overflow. The browser console reported zero errors and zero warnings. Retained evidence: [mobile screenshot](evidence/live-390.png), [desktop screenshot](evidence/live-1280.png), and [measurement/text record](evidence/live-observation.json).

## Better Interface review

The pinned guide’s workflow, all six core domains, and relevant supporting sections were applied while building, followed by a rendered and source review. The final token/component documentation is [DESIGN.md](../../DESIGN.md). The table records the scope actually checked.

| Domain | Coverage | Remaining limits |
| --- | --- | --- |
| Accessibility | Semantic regions/headings, labels/descriptions, visible keyboard focus, native dialog containment and restoration, rejection/status messaging, non-color state, target sizes, axe, reduced motion, 200% text reflow | No screen-reader session, switch device, physical touch hardware, or native browser-zoom test; forced-colors behavior reviewed in source only |
| Layout | First screen at 390, rendered 320/390/768/1440 stress cases, full addresses, large balances, open disclosures/dialog, input errors and 200% text sizing; no horizontal overflow in either engine | Dynamic arbitrary wallet extension content is outside the page; fixture amounts are representative rather than exhaustive |
| Writing | Four-word heading, plain description, contextual direction/approval labels, estimate caveat, fee/allocation/burn semantics, actionable errors, token-specific units | English only; no localization or RTL implementation; no USD source is available |
| Typography | Six source sizes, one system font stack, three weights, heading heaviest, natural small-text tracking, tabular numbers, wrapping and hierarchy | System font rendering varies; no custom font is downloaded |
| Colors | Semantic aliases, measured initial-page text contrast, distinct surface/text roles, focus and error states, no color-only eligibility | A single light theme is intended; all possible third-party wallet images/states were not contrast-audited |
| UI | Actual trade controls and explicit approval, fresh simulation, per-action feedback, pending lock, errors/retry, history/payout/settlement, wrong-chain recovery, owner-only visibility | Real phone deep-link launch, passkey enrollment, native extension prompts, and funded signatures were not performed |

The pinned probe measured no sideways scroll at 320/390/1440, no overlapping or clipped text, no covering floating controls, no small tracked capitals/kicker headings, and all measured text at 4.5:1 or 3:1 for large type. It found one 30px-high brand link below the comfortable 44px target; this still passes its target/spacing threshold. Other initial controls are at least 44px. The probe counted 29 prose words on the first phone screen and 41 on desktop, one font family and three weights, and no endless/reduced-motion animation.

### Findings and repairs

All listed applicable findings were fixed before the final export and checked again. Source references point to the repaired implementation.

| Severity / domain | Finding | Repair and evidence |
| --- | --- | --- |
| High / runtime | The Coinbase connector’s optional SDK was absent during the first build. | Explicit `@coinbase/wallet-sdk` dependency in `web/package.json:13`; correct connector preference in `web/src/config.ts:161`. Production build and wallet entry now pass. |
| High / transaction UI | A receipt timeout could incorrectly allow a second submission while the first was unresolved. | Unknown-receipt state and signing lock in `web/src/App.tsx:266`; automatic receipt checks retain the transaction link. Both browser engines force a timeout and verify recovery. Cancellation/revert/refresh outcomes are tested in `web/src/chain.ts:346`. |
| High / mobile layout | Live small-pot precision plus a long receive amount pushed the primary action below the 844px first screen. | Moved slippage beside the trade heading (`web/src/App.tsx:555`) and tightened phone form spacing (`web/src/style.css:1015`). Live final button bottom is 826.125px; fixture bottom is 780px. |
| Medium / enlarged text | The mobile refresh control and stretched, rotated history expansion glyph could extend outside the viewport at 200% text. | Relative width and wrapping in `web/src/style.css:1055`; bounded square glyph and flexible columns at `web/src/style.css:641`. Both engines now report no overflow at 200%. |
| Medium / color | Original muted text on disabled surfaces measured approximately 4.47:1. | Darkened `--neutral-500` to `#616c60` at `web/src/style.css:5`; final sampled disabled control text is approximately 4.74:1. |
| Low / typography | Small IMD unit labels inherited negative number tracking. | Reset small statistics-unit spacing; final probe’s tracking check passes. |
| Low / probe heuristic | The compact header wallet control was classified as a kicker label by its shape. | Preserved the button and made its compact radius 6px at `web/src/style.css:202`; final heading/eyebrow check passes. |
| Medium / error handling | Clipboard API can be absent on an insecure preview origin. | Copy failure now shows a selection instruction in `web/src/App.tsx:53`; both browser engines exercise the fallback without script errors. |
| Medium / financial UI | Truncated ticket precision and cached quote data after a failed refetch could mislead eligibility/output expectations. | Full-decimal minimum ticket at `web/src/App.tsx:528`; failed quote data is excluded at `web/src/App.tsx:237`. Integer validation and failing simulation paths pass. |

Selected stress evidence is retained as [320px large values](evidence/mock-320-stress.png), [1440px large values](evidence/mock-1440-stress.png), [200% text](evidence/mock-text-200.png), and [WebKit wallet dialog](evidence/mock-webkit-wallet.png). These images use deliberately synthetic chain balances/addresses and must not be interpreted as live balances. The suite’s other temporary screenshots are not delivered; their names remain in its raw results for traceability.

## Remaining limitations and publication boundary

Real approvals, buys, sells, settlement, payout transfer success, owner actions, replacement transactions, passkey onboarding, and mobile wallet app handoffs remain untested against live wallets. No private key is available or required. Owner controls were reviewed and typechecked; their authorization is also enforced by contract simulation, but no owner session was exercised. The current-range estimate can differ when liquidity ticks are crossed; only wallet-funded router simulation supplies the execution minimum.

The worker’s direct shell RPC route returned HTTP 403; the available browser route successfully read live state. Browser checks do not prove every user/network can reach either public endpoint. Chain state and prices can change between simulation and execution; slippage/deadline checks and surfaced reverts remain necessary.

No deployment/publishing request was made. CID, named hosting, and social crawler unfurl are not validated here; the relative Open Graph image is deliberate because no public site URL was supplied. No external font/image dependency is required. The complete `dist/` must be published together. The final file-budget audit is retained in `evidence/submission-audit.json`; no ignore file, protected build/dependency file, submodule, `.git/`, or `.github/` was changed.
