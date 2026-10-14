import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, webkit } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { parseEther } from "viem";
import { serveExport } from "./preview.mjs";
import { mockChain, injectWallet, WALLET } from "./mock-chain.mjs";
const root = resolve(import.meta.dirname, "../../dist");
const out = resolve(
  process.env.REKT_TEST_OUT ??
    resolve(import.meta.dirname, "../../test/scratch/browser-tests"),
);
await mkdir(out, { recursive: true });
const report = { runs: [], screenshots: [], failures: [] };
const engines =
  process.env.REKT_BROWSER === "webkit"
    ? ["webkit"]
    : process.env.REKT_BROWSER === "both"
      ? ["chromium", "webkit"]
      : ["chromium"];
async function waitFor(test, label, timeout = 15000) {
  const start = Date.now();
  while (!(await test())) {
    if (Date.now() - start > timeout) throw Error("Timed out: " + label);
    await new Promise((r) => setTimeout(r, 100));
  }
}
for (const engine of engines) {
  let browser;
  try {
    browser = await (engine === "webkit"
      ? webkit.launch({ headless: true })
      : chromium.launch({ channel: "chrome", headless: true }));
    const chain = await mockChain(root),
      { mock, rpc, manifest } = chain;
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let httpFailure = false;
    await injectWallet(page, rpc);
    await page.route("**/*", async (route) => {
      const url = route.request().url();
      if (url.startsWith("http://rekt.test/")) return serveExport(route, root);
      if (manifest.network.rpcUrls.some((u) => url.startsWith(u))) {
        if (httpFailure)
          return route.fulfill({ status: 503, body: "Public RPC unavailable" });
        const payload = route.request().postDataJSON();
        const reply = async (q) => {
          try {
            return { jsonrpc: "2.0", id: q.id, result: await rpc(q) };
          } catch (e) {
            return {
              jsonrpc: "2.0",
              id: q.id,
              error: { code: e.code ?? -32000, message: e.message },
            };
          }
        };
        return route.fulfill({
          json: Array.isArray(payload)
            ? await Promise.all(payload.map(reply))
            : await reply(payload),
        });
      }
      return route.abort();
    });
    await page.goto("http://rekt.test/preview/");
    await page.getByText("1,000", { exact: true }).waitFor();
    await page.locator("footer details").evaluate((e) => (e.open = true));
    await page
      .getByText(/Contract code, token metadata, router bindings/)
      .waitFor();
    await page.locator("footer details").evaluate((e) => (e.open = false));
    await page.getByLabel("You pay", { exact: true }).fill("50");
    await waitFor(
      async () =>
        !(await page.locator(".receive-line").innerText()).includes("…"),
      "disconnected estimate",
    );
    assert.match(await page.locator(".receive-line").innerText(), /estimate/);
    assert.ok(!mock.calls.some((q) => q.method === "eth_sendTransaction"));
    const action = await page.locator(".trade-action").boundingBox();
    assert.ok(
      action.y + action.height <= 844,
      `Primary action ends at ${action.y + action.height}`,
    );
    report.runs.push(
      `${engine}: disconnected pool estimate and primary action at 390 passed (bottom ${Math.round(action.y + action.height)}px).`,
    );
    await page.screenshot({
      path: resolve(out, `${engine}-390.png`),
      fullPage: true,
    });
    report.screenshots.push(`${engine}-390.png`);
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    assert.equal(
      await dialog
        .getByRole("button", { name: "Browser wallet", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await dialog
        .getByRole("button", { name: "Test wallet", exact: true })
        .count(),
      1,
    );
    assert.equal(
      await dialog
        .getByRole("button", { name: "Coinbase Wallet", exact: true })
        .count(),
      1,
    );
    await page.keyboard.press("Escape");
    assert.equal(await dialog.isVisible(), false);
    assert.equal(
      await page.evaluate(() => document.activeElement.textContent.trim()),
      "Connect",
    );
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    mock.reject = true;
    await dialog
      .getByRole("button", { name: "Test wallet", exact: true })
      .click();
    await dialog.getByText(/Request declined/).waitFor();
    mock.rejectSwitch = true;
    await dialog
      .getByRole("button", { name: "Test wallet", exact: true })
      .click();
    await dialog.getByText("Switch to Robinhood Chain to continue.").waitFor();
    assert.equal(await page.locator(".trade-action").isDisabled(), true);
    await dialog
      .getByRole("button", { name: "Switch network", exact: true })
      .click();
    await waitFor(() => mock.walletChain === 4663, "network switched");
    await dialog
      .getByRole("button", { name: "Close wallet menu", exact: true })
      .click();
    await waitFor(async () => !(await dialog.isVisible()), "wallet connection");
    assert.deepEqual(mock.added, manifest.walletAddChain);
    const switchCalls = mock.calls.filter(
      (q) => q.method === "wallet_switchEthereumChain",
    );
    assert.ok(switchCalls.length >= 2);
    await page
      .getByRole("button", { name: "Approve IMD", exact: true })
      .waitFor();
    report.runs.push(
      `${engine}: EIP-6963 picker, Escape/focus restoration, rejection recovery, wrong-chain safety, unknown-chain add and switch passed.`,
    );
    mock.holdReceipt = true;
    await page
      .getByRole("button", { name: "Approve IMD", exact: true })
      .click();
    await waitFor(() => mock.sent.length === 1, "approval submission");
    assert.equal(mock.sent[0].functionName, "approve");
    assert.equal(mock.sent[0].args[0].toLowerCase(), chain.router);
    assert.equal(mock.sent[0].args[1], parseEther("50"));
    assert.equal(mock.sent[0].tx.to.toLowerCase(), chain.imd.toLowerCase());
    assert.equal(await page.locator(".trade-action").isDisabled(), true);
    await page.locator(".trade-action").dispatchEvent("click");
    assert.equal(mock.sent.length, 1);
    mock.holdReceipt = false;
    await waitFor(
      async () =>
        await page
          .getByRole("button", { name: "Buy REKTD", exact: true })
          .isVisible(),
      "buy ready",
      20000,
    );
    await page.locator(".trade-details").evaluate((e) => (e.open = true));
    assert.match(await page.locator(".trade-details").innerText(), /99 REKTD/);
    await page.locator(".trade-details").evaluate((e) => (e.open = false));
    await page.getByRole("button", { name: "Buy REKTD", exact: true }).click();
    await waitFor(() => mock.sent.length === 2, "buy");
    assert.equal(mock.sent[1].tx.to.toLowerCase(), chain.router);
    assert.deepEqual(mock.sent[1].args.slice(0, 4), [
      true,
      -parseEther("50"),
      parseEther("99"),
      4295128740n,
    ]);
    assert.ok(!mock.sent[1].tx.value || BigInt(mock.sent[1].tx.value) === 0n);
    await waitFor(
      async () =>
        !(await page
          .getByRole("button", { name: "Sell", exact: true })
          .isDisabled()),
      "buy confirmation",
    );
    await page.getByRole("button", { name: "Sell", exact: true }).click();
    await page.getByLabel("You pay", { exact: true }).fill("20");
    await page
      .getByLabel("Slippage limit", { exact: true })
      .selectOption("200");
    await page.clock.install();
    mock.holdReceipt = true;
    await page
      .getByRole("button", { name: "Approve REKTD", exact: true })
      .click();
    await waitFor(() => mock.sent.length === 3, "sell approval sent");
    await page.clock.fastForward(121000);
    await page.getByText(/Confirmation is still pending/).waitFor();
    assert.equal(await page.locator(".trade-action").isDisabled(), true);
    mock.holdReceipt = false;
    await page.clock.fastForward(5100);
    await waitFor(
      async () =>
        await page
          .getByRole("button", { name: "Sell REKTD", exact: true })
          .isVisible(),
      "sell quote",
    );
    assert.equal(mock.sent[2].tx.to.toLowerCase(), chain.token.toLowerCase());
    assert.equal(mock.sent[2].args[0].toLowerCase(), chain.router);
    mock.reject = true;
    await page.getByRole("button", { name: "Sell REKTD", exact: true }).click();
    await page
      .locator(".trade-panel")
      .getByText(/Request declined/)
      .waitFor();
    await waitFor(
      async () =>
        !(await page
          .getByRole("button", { name: "Sell REKTD", exact: true })
          .isDisabled()),
      "sell retry",
    );
    await page.getByRole("button", { name: "Sell REKTD", exact: true }).click();
    await waitFor(() => mock.sent.length === 4, "sell");
    assert.deepEqual(mock.sent[3].args.slice(0, 4), [
      false,
      -parseEther("20"),
      parseEther("9.8"),
      1461446703485210103287273052203988822378723970341n,
    ]);
    report.runs.push(
      `${engine}: exact approval amounts, receipt lock and timeout recovery, protected buy/sell calldata, zero ETH swap value, wallet rejection and retry passed.`,
    );
    await waitFor(
      async () =>
        !(await page
          .getByRole("button", { name: "Sell", exact: true })
          .isDisabled()),
      "sell confirmed",
    );
    mock.end = BigInt(Math.floor(Date.now() / 1000) - 1);
    await page
      .getByRole("button", { name: "Refresh state", exact: true })
      .click();
    await waitFor(
      async () =>
        !(await page
          .getByRole("button", { name: "Settle round", exact: true })
          .isDisabled()),
      "settle enabled",
    );
    await page
      .getByRole("button", { name: "Settle round", exact: true })
      .click();
    await waitFor(
      () => mock.sent.some((x) => x.functionName === "settleRound"),
      "settle sent",
    );
    await waitFor(
      async () =>
        !(await page
          .getByRole("button", { name: "Retry my payout", exact: true })
          .isDisabled()),
      "claim ready",
    );
    await page
      .getByRole("button", { name: "Retry my payout", exact: true })
      .click();
    await waitFor(
      () => mock.sent.some((x) => x.functionName === "claimPayout"),
      "claim sent",
    );
    assert.deepEqual(
      mock.sent.find((x) => x.functionName === "claimPayout").args,
      [WALLET],
    );
    await page.getByRole("button", { name: "Older", exact: true }).click();
    await page.getByText("Round 3", { exact: true }).waitFor();
    await page.getByText("Round 3", { exact: true }).click();
    await page.getByRole("link", { name: /Round 3 winner/ }).waitFor();
    report.runs.push(
      `${engine}: expiry/settlement, recipient-bound payout retry, paginated onchain history passed.`,
    );
    await page.getByRole("button", { name: "Buy", exact: true }).click();
    await page
      .getByLabel("You pay", { exact: true })
      .fill("0.0000000000000000001");
    assert.equal(
      await page
        .getByLabel("You pay", { exact: true })
        .getAttribute("aria-invalid"),
      "true",
    );
    await page.getByLabel("You pay", { exact: true }).fill("10000000");
    assert.match(await page.locator("#amount-hint").innerText(), /too low/);
    await page.getByLabel("You pay", { exact: true }).fill("1");
    mock.imdAllowance = parseEther("1000");
    mock.failSimulation = true;
    await page
      .getByRole("button", { name: "Refresh state", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Retry quote", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Buy REKTD", exact: true })
        .count(),
      0,
    );
    mock.failSimulation = false;
    await page
      .getByRole("button", { name: "Retry quote", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Buy REKTD", exact: true })
      .waitFor();
    mock.missingCode = true;
    await page
      .getByRole("button", { name: "Refresh state", exact: true })
      .click();
    await page.getByText(/required contract has no deployed code/).waitFor();
    assert.equal(await page.locator(".trade-action").isDisabled(), true);
    mock.missingCode = false;
    await page
      .getByRole("button", { name: "Refresh state", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Buy REKTD", exact: true })
      .waitFor();
    const walletReadCount = mock.calls.filter(
      (q) => q.wallet && q.method === "eth_call",
    ).length;
    httpFailure = true;
    await page
      .getByRole("button", { name: "Refresh state", exact: true })
      .click();
    await waitFor(
      async () =>
        !(await page
          .getByRole("button", { name: "Buy REKTD", exact: true })
          .isDisabled()),
      "wallet RPC fallback",
    );
    await waitFor(
      () =>
        mock.calls.filter((q) => q.wallet && q.method === "eth_call").length >
        walletReadCount,
      "wallet read fallback observed",
    );
    httpFailure = false;
    report.runs.push(
      `${engine}: amount validation, insufficient balance, simulation failure/retry, deployed-code safety gate and wallet RPC fallback passed.`,
    );
    // Maximum-size numeric strings, full addresses and an edge-of-header menu.
    mock.imd = parseEther("12345678901234567890.123456789");
    mock.pot = parseEther("98765432109876543210.123456789");
    mock.leader = WALLET;
    await page
      .getByRole("button", { name: "Refresh state", exact: true })
      .click();
    await page.waitForTimeout(300);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => scrollTo(0, 0));
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        `Overflow ${width}`,
      );
      await page.screenshot({
        path: resolve(out, `${engine}-${width}-stress.png`),
        fullPage: true,
      });
      report.screenshots.push(`${engine}-${width}-stress.png`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("html").evaluate((el) => (el.style.fontSize = "200%"));
    await page.screenshot({
      path: resolve(out, `${engine}-text-200.png`),
      fullPage: true,
    });
    if (
      !(await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ))
    )
      console.log(
        JSON.stringify(
          await page.evaluate(() => {
            const result = [];
            const walk = document.createTreeWalker(
              document.body,
              NodeFilter.SHOW_TEXT,
            );
            let node;
            while ((node = walk.nextNode())) {
              const range = document.createRange();
              range.selectNodeContents(node);
              for (const rect of range.getClientRects())
                if (
                  rect.width &&
                  rect.height &&
                  (rect.right > innerWidth + 1 || rect.left < 0)
                )
                  result.push({
                    text: node.textContent.slice(0, 80),
                    parent: node.parentElement.tagName,
                    class: node.parentElement.className,
                    right: rect.right,
                    left: rect.left,
                  });
            }
            return {
              width: innerWidth,
              scroll: document.documentElement.scrollWidth,
              text: result.slice(0, 20),
            };
          }),
          null,
          2,
        ),
      );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      "200% text resize overflow",
    );
    await page.screenshot({
      path: resolve(out, `${engine}-text-200.png`),
      fullPage: true,
    });
    report.screenshots.push(`${engine}-text-200.png`);
    await page.locator("html").evaluate((el) => (el.style.fontSize = ""));
    await page.getByRole("button", { name: /0x1111/ }).click();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.screenshot({ path: resolve(out, `${engine}-wallet.png`) });
    report.screenshots.push(`${engine}-wallet.png`);
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Copy Current leader", exact: true })
      .click();
    await page
      .getByText("Select the address to copy it.", { exact: true })
      .waitFor();
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    await writeFile(
      resolve(out, `${engine}-axe.json`),
      JSON.stringify(axe.violations, null, 2),
    );
    assert.deepEqual(
      axe.violations.map((x) => ({
        id: x.id,
        impact: x.impact,
        nodes: x.nodes.map((n) => n.target),
      })),
      [],
    );
    assert.deepEqual(errors, []);
    // No universal router, Permit2, or quoter is ever contacted, including reads.
    const forbidden = ["universalRouter", "permit2", "quoter"].map((k) =>
      manifest.network.uniswapV4[k].toLowerCase(),
    );
    assert.ok(
      mock.calls.every(
        (q) =>
          !(
            q.params?.[0]?.to &&
            forbidden.includes(q.params[0].to.toLowerCase())
          ),
      ),
    );
    report.runs.push(
      `${engine}: 320/390/768/1440 long-value reflow, 200% text resize, wallet sheet, copy fallback, axe accessibility, zero script errors, forbidden routing addresses absent passed.`,
    );
    // Wrong chain remains visible when the visitor rejects switching.
    await context.close();
    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile Safari/604.1",
    });
    const mp = await mobile.newPage();
    await mp.route("**/*", (route) =>
      route.request().url().startsWith("http://rekt.test/")
        ? serveExport(route, root)
        : route.abort(),
    );
    await mp.goto("http://rekt.test/preview/");
    await mp.getByRole("button", { name: "Connect", exact: true }).click();
    for (const name of ["MetaMask", "Coinbase Wallet", "Rabby", "Phantom"])
      assert.equal(
        await mp
          .getByRole("link", { name: `Open in ${name}`, exact: true })
          .count(),
        1,
      );
    assert.equal(
      await mp
        .getByRole("button", { name: "Coinbase Smart Wallet", exact: true })
        .count(),
      1,
    );
    const rabby = new URL(
      await mp
        .getByRole("link", { name: "Open in Rabby", exact: true })
        .getAttribute("href"),
    );
    assert.equal(rabby.searchParams.get("_cmd"), "open-dapp");
    assert.equal(rabby.searchParams.get("dapp"), "http://rekt.test/preview/");
    await mp.screenshot({ path: resolve(out, `${engine}-mobile-wallet.png`) });
    report.screenshots.push(`${engine}-mobile-wallet.png`);
    report.runs.push(
      `${engine}: four mobile wallet links preserve current gateway subpath; Coinbase Smart Wallet entry passed.`,
    );
    await mobile.close();
    const offline = await browser.newContext();
    const op = await offline.newPage();
    await op.route("**/*", (route) =>
      route.request().url().startsWith("http://rekt.test/")
        ? serveExport(route, root)
        : route.fulfill({ status: 503, body: "RPC unavailable" }),
    );
    await op.goto("http://rekt.test/preview/");
    await op.getByText(/The network could not be reached/).waitFor();
    await op.getByLabel("You pay", { exact: true }).fill("1");
    await op
      .locator(".receive-line")
      .getByText("Unavailable", { exact: true })
      .waitFor();
    assert.equal(
      await op
        .getByRole("button", { name: "Connect", exact: true })
        .isDisabled(),
      false,
    );
    await op.getByRole("button", { name: "Connect", exact: true }).focus();
    await op.keyboard.press("Enter");
    await op
      .getByRole("button", { name: "Browser wallet", exact: true })
      .click();
    await op.getByText(/No browser wallet was found/).waitFor();
    report.runs.push(
      `${engine}: unavailable RPC leaves input/connect usable; keyboard-opened dialog and missing-wallet recovery passed.`,
    );
    await offline.close();
    const invalid = await browser.newContext();
    const ip = await invalid.newPage();
    await ip.route("**/*", async (route) => {
      if (route.request().url().endsWith("abi/RektSwapRouter.json"))
        return route.fulfill({ json: [] });
      if (route.request().url().startsWith("http://rekt.test/"))
        return serveExport(route, root);
      return route.abort();
    });
    await ip.goto("http://rekt.test/preview/");
    await ip
      .getByRole("heading", { name: "Configuration unavailable", exact: true })
      .waitFor();
    await ip.getByText(/Integrity check failed/).waitFor();
    assert.equal(
      await ip.getByRole("button", { name: "Connect", exact: true }).count(),
      0,
    );
    report.runs.push(
      `${engine}: tampered router ABI fails closed before wallet setup.`,
    );
    await invalid.close();
  } catch (e) {
    report.failures.push({ engine, error: e.stack });
    console.error(e);
  } finally {
    await browser?.close();
  }
}
await writeFile(resolve(out, "results.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.failures.length) process.exitCode = 1;
