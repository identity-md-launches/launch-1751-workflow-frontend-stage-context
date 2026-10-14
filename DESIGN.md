# Rekt Blitz design

This documents the shipped React/CSS implementation in `web/src/`, reviewed against the pinned Better Interface guide. The visual direction is a compact trading dashboard: a dark jackpot scoreboard, a white trade form, and one lime primary action on a warm neutral page. The product and trade control take priority over explanation. There is one light page theme; the dark scoreboard is a component treatment, not a second theme.

## Colors

Tokens are defined in `web/src/style.css:1`. Semantic aliases keep components consistent.

| Token | Value | Implemented role |
| --- | --- | --- |
| `--neutral-50` / `--page` | `#f6f6ef` | Page background |
| `--neutral-100` / `--surface-muted` | `#eeefe6` | Disabled controls and hover surfaces |
| `--neutral-200` / `--line` | `#d6dacd` | Dividers and secondary borders |
| `--neutral-500` / `--muted` | `#616c60` | Supporting text and input borders |
| `--neutral-700` | `#3e4b40` | Wallet outline and network dot |
| `--neutral-900` / `--ink` / `--dark` | `#121716` | Main text and scoreboard background |
| `--surface` | `#ffffff` | Trade panel, inputs, dialog |
| `--lime-300` / `--accent` | `#c5f566` | Trade button, live dot, dark-panel focus |
| `--lime-400` / `--accent-hover` | `#b3e650` | Primary-button hover |
| `--red-700` / `--error` | `#a52c28` | Error text and invalid-field outline |
| `--on-dark` | `#f3f5e9` | Scoreboard text |
| `--muted-dark` | `#b8c1b5` | Scoreboard supporting text |
| `--focus` | `#31570b` | Three-pixel keyboard focus outline |

The scoreboard locally sets its line to `#657064`, muted surface to `#263029`, and focus to lime. `--red-300: #ffb7ac` is defined but unused. State is also expressed in words, button availability, and status messages; color alone does not convey eligibility or success. The rendered probe measured all sampled text above its required 4.5:1 threshold, or 3:1 for large text. See the validation record for scope and evidence.

## Typography

The system stack is `Arial, Helvetica, sans-serif`; no font download is required. The root is 16px with a 1.5 line height. Six source sizes are available: small 14px, body 16px, subtitle 20px, section 24px, title 32px, and display 48px, expressed in `rem`. Only weights 400, 600, and 700 are used. The main heading is the heaviest at 700; controls, values, and section headings use 600.

The heading is 48px/1.08 on desktop and 32px/1.08 on phones. Section headings use 24px/1.2; smaller headings use 20px/1.3. Body text is not tracked or uppercased. Tight tracking is limited to larger headings and numeric displays; unit labels retain natural spacing. Paragraphs have a 70-character maximum measure. Amounts, timers, and history use tabular numbers. Long addresses and large numeric values wrap instead of being silently truncated. Minimum-ticket eligibility uses integer units, and the displayed minimum preserves all token decimals.

## Layout and responsive behavior

The centered content container is at most 1248px including 32px side padding. The header has a minimum height of 84px and can wrap. The main arena uses two `minmax(0, …)` columns in a 1.18:1 ratio with a 32px gap. Settlement and balances share a two-column area; rules use three columns. Lower sections use dividers instead of more cards.

At 60rem (960px), side padding and the arena gap become 24px, panels tighten, and the header network label and redundant introduction link are hidden. At 44rem (704px), the arena, lower sections, rules, and contract list stack into one column. Page gutters become 16px; the header is at least 68px; panels use 16px by 20px padding. The scoreboard keeps jackpot and timer side by side, with leader and ticket details underneath. Its redundant round-number block and timer footnote are hidden; the full rule remains below the form. Slippage stays beside the trade heading to keep the main action visible.

At 390 × 844 with live chain state and a one-IMD estimate, the entire main action ends at 826.125px. Automated stress cases cover 320, 390, 768, and 1440px, full addresses, open history, and unusually large balances. A 200% root text-size test also passes without horizontal overflow. Content remains vertically scrollable; there are no sticky overlays. No native browser-zoom or physical-device claim is made.

## Shape, spacing, and depth

The interface is flat: no shadows, gradient text, or card-within-card hierarchy. White and dark surfaces establish the main groups. Desktop panels and the wallet dialog have 16px radii; mobile panels use 12px. Controls and amount fields use 8px, the compact wallet control uses 6px, and timer tracks use 4px. The phone wallet sheet has 16px top corners and safe-area bottom padding.

Common spacing is 4, 8, 12, 16, 20, 24, and 32px, with local optical adjustments. Ordinary buttons and inputs have at least 44px height; the main action is at least 48px. Compact address-copy controls remain at least 32px on phones. The brand link is the sole initial-screen target below 44px; it measures 30px high and passes the probe’s minimum target/spacing requirement.

## Components and states

| Component | Behavior and treatment |
| --- | --- |
| Header and introduction | Product mark, named chain on desktop, one wallet control, four-word heading and one plain explanatory line |
| Jackpot scoreboard | Live IMD amount, one-second countdown, round state, full leader address, exact minimum ticket and winner share; inactive and expired states are explicit |
| Trade panel | Buy/sell pressed-state buttons, labeled decimal input, wallet balance and Max, estimate/simulation distinction, slippage selector, explicit approval step, primary action, expandable execution details |
| Transaction status | Separate action states for simulation, wallet confirmation, pending receipt, refresh, success, and error; explorer link and shared signing lock; uncertain receipts continue polling |
| Statistics and settlement | Three IMD lifetime metrics; settlement enabled only by fresh `canSettle()` and wallet/network verification |
| Balances and payout | IMD, REKTD, ETH for network fees, pending payout, and recipient-bound retry control |
| Round history | Five round IDs per page, native disclosures with winner and allocation details, bounded pagination; expansion icon stays square when text grows |
| Wallet dialog | Native modal focus containment, Escape/backdrop/close, restored trigger focus, discovered EIP-6963 wallets, Coinbase SDK, four mobile wallet links; bottom sheet on phones |
| Owner panel | Conditional router configuration and two-step ownership controls with independent transaction status |
| Verification details | Full checksummed addresses, explorer/copy controls, deployment verification state, and token-unit pricing explanation |

Inputs have visible labels, inline errors, and `aria-describedby`; action status uses `role="status"`. There is a skip link and semantic heading structure. Timer changes do not repeatedly announce through an assertive live region. Loading, unavailable RPC, disconnected, wrong-chain, insufficient funds, stale state, rejection, and pending states each have a visible explanation. Wallet connection remains usable if RPC reads fail.

Hover and pressed states use explicit properties, not `transition: all`. The optional transition lasts 120ms; pressing a button scales it to 0.96. These effects only apply when reduced motion is not requested. Forced-colors mode uses the system Highlight color for focus and timer fill. No continuous decorative animation runs.

## Maintaining the design

- Keep the jackpot state, trade form, and wallet action above explanatory content. Recheck the 390px first screen after adding form copy or controls.
- Use existing semantic colors, six type sizes, and three weights. Keep the main heading heaviest.
- Keep complete addresses accessible and let long values wrap. Test open disclosures and enlarged text, not just default fixtures.
- Preserve distinct estimate, approval, signing, and receipt states. A pool estimate must never become a signed minimum output.
- Use meaningful action labels and token units. Do not add an invented USD price, promise a prize, or describe allocated totals as necessarily delivered transfers.
- Update the generated export and manifest together after source changes. Retest all hash inventory entries.

Review coverage, measured results, screenshots, and remaining limitations are in [docs/frontend/VALIDATION.md](docs/frontend/VALIDATION.md).
