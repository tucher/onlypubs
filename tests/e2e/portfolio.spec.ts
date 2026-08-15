import { test, expect, type Page } from "@playwright/test";
import { mockNetwork } from "./fixtures";

// Mirrors the shape of a real exported portfolio: multiple addresses per token,
// all chains, and tags — to verify the "(2)" subtitle, bar nesting, and byTag
// chain-bar visibility fixes.
const ASSETS = [
  { chain: "btc", token: null, adr: "bc1a", title: "cold" },
  { chain: "btc", token: null, adr: "bc1b", title: "cold" },
  { chain: "btc", token: null, adr: "bc1c", title: null },
  { chain: "eth", token: null, adr: "0x1", title: "hot" },
  { chain: "eth", token: null, adr: "0x2", title: "hot" },
  { chain: "eth", token: "usdc", adr: "0x1", title: "hot" },
  { chain: "eth", token: "usdc", adr: "0x2", title: "hot" },
  { chain: "eth", token: "usdt", adr: "0x1", title: "hot" },
  { chain: "eth", token: "usdt", adr: "0x2", title: "hot" },
  { chain: "trx", token: null, adr: "Ta", title: null },
  { chain: "trx", token: null, adr: "Tb", title: null },
  { chain: "trx", token: "usdt", adr: "Ta", title: null },
  { chain: "trx", token: "usdt", adr: "Tb", title: null },
  { chain: "ton", token: null, adr: "EQa", title: null },
];

async function seed(page: Page) {
  await page.addInitScript((assets) => {
    localStorage.setItem("onlypubs.assets.v1", JSON.stringify(assets));
  }, ASSETS);
  await mockNetwork(page);
  await page.goto("/");
  await expect(page.getByTestId("wallet-list")).toBeVisible();
}

test("byChain: no address-count subtitle, bars nested", async ({ page }) => {
  await seed(page);
  await expect(page.getByTestId("wallet-list")).not.toContainText("(2)"); // no "(N)" in byChain
  await expect(page).toHaveScreenshot("portfolio-bychain.png", {
    mask: [page.getByTestId("statusline")],
  });
});

test("byToken: no subtitle, sub-chain bars nested within token bar", async ({ page }) => {
  await seed(page);
  await page.locator('.segmented button[data-mode="byToken"]').click();
  await expect(page.getByTestId("wallet-list")).not.toContainText("(2)");
  await expect(page).toHaveScreenshot("portfolio-bytoken.png", {
    mask: [page.getByTestId("statusline")],
  });
});

test("byTag: chain rows show a visible bar; (N) subtitle allowed here", async ({ page }) => {
  await seed(page);
  await page.locator('.segmented button[data-mode="byTag"]').click();
  await expect(page.locator('[data-testid="section"][data-name="Cold"]')).toBeVisible();
  await expect(page).toHaveScreenshot("portfolio-bytag.png", {
    mask: [page.getByTestId("statusline")],
  });
});
