import { test, expect, type Page } from "@playwright/test";
import { mockNetwork } from "./fixtures";

// Visual regression: deterministic screenshots with mocked data. Replaces manual
// visual QA (plan goal). The non-deterministic status line (timestamp) is masked.
// Run `npm run test:e2e:update` once to create baselines.

async function seed(page: Page) {
  await mockNetwork(page);
  await page.goto("/");
  // add BTC + ETH(USDT) deterministically
  const add = async (chain: string, address: string, tokens: string[] = [], tag = "") => {
    await page.getByTestId("add-btn").click();
    await page.locator(`.chip[data-chain="${chain}"]`).click();
    await page.getByTestId("address-input").fill(address);
    for (const t of tokens) await page.locator(`.chip[data-token="${t}"]`).click();
    if (tag) await page.getByTestId("tag-input").fill(tag);
    await page.getByTestId("add-submit").click();
  };
  await add("btc", "bc1qvisual", [], "cold");
  await add("eth", "0xvisual", ["usdt"], "hot");
  await expect(page.getByTestId("grand-total")).toHaveText("$ 63,100");
}

test("empty state snapshot", async ({ page }) => {
  await mockNetwork(page);
  await page.goto("/");
  await expect(page.getByTestId("empty-state")).toBeVisible();
  await expect(page).toHaveScreenshot("empty.png", { mask: [page.getByTestId("statusline")] });
});

test("main list snapshot (byChain)", async ({ page }) => {
  await seed(page);
  await expect(page).toHaveScreenshot("list-bychain.png", {
    mask: [page.getByTestId("statusline")],
  });
});
