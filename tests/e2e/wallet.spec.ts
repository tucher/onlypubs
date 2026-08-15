import { test, expect, type Page } from "@playwright/test";
import { mockNetwork, type MockOptions } from "./fixtures";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

async function addWallet(
  page: Page,
  opts: { chain: string; address: string; tokens?: string[]; tag?: string; fromManage?: boolean },
) {
  await page.getByTestId(opts.fromManage ? "manage-add" : "add-btn").click();
  await page.locator(`.chip[data-chain="${opts.chain}"]`).click();
  await page.getByTestId("address-input").fill(opts.address);
  for (const t of opts.tokens ?? []) await page.locator(`.chip[data-token="${t}"]`).click();
  if (opts.tag) await page.getByTestId("tag-input").fill(opts.tag);
  await page.getByTestId("add-submit").click();
}

async function goto(page: Page, opts?: MockOptions) {
  await mockNetwork(page, opts);
  await page.goto("/");
}

test("shows the empty state initially", async ({ page }) => {
  await goto(page);
  await expect(page.getByTestId("empty-state")).toBeVisible();
  await expect(page.getByTestId("grand-total")).toHaveText("OnlyPubs");
});

test("adds a BTC wallet and shows balance + grand total", async ({ page }) => {
  await goto(page);
  await addWallet(page, { chain: "btc", address: "bc1qexample", tag: "cold" });
  await expect(page.getByTestId("grand-total")).toHaveText("$ 60,000");
  await expect(page.locator('[data-testid="section"][data-name="Bitcoin"]')).toBeVisible();
});

test("adds a Tron wallet with USDT (TronScan path)", async ({ page }) => {
  await goto(page);
  await addWallet(page, { chain: "trx", address: "TXYZexample", tokens: ["usdt"], tag: "cold" });
  await expect(page.locator('[data-testid="section"][data-name="Tron"]')).toBeVisible();
  await expect(page.getByTestId("statusline")).not.toContainText("Failed");
});

test("switches grouping modes", async ({ page }) => {
  await goto(page);
  await addWallet(page, { chain: "btc", address: "bc1qexample", tag: "cold" });
  await addWallet(page, { chain: "eth", address: "0xabc", tokens: ["usdt"], tag: "hot" });

  // byChain (default): Bitcoin + Eth sections
  await expect(page.locator('[data-testid="section"][data-name="Bitcoin"]')).toBeVisible();
  await expect(page.locator('[data-testid="section"][data-name="Eth"]')).toBeVisible();

  // byToken: a USDT section appears
  await page.locator('.segmented button[data-mode="byToken"]').click();
  await expect(page.locator('[data-testid="section"][data-name="USDT"]')).toBeVisible();

  // byTag: Cold + Hot sections
  await page.locator('.segmented button[data-mode="byTag"]').click();
  await expect(page.locator('[data-testid="section"][data-name="Cold"]')).toBeVisible();
  await expect(page.locator('[data-testid="section"][data-name="Hot"]')).toBeVisible();
});

test("copies an address from the manage menu and shows a toast", async ({ page }) => {
  await goto(page);
  await addWallet(page, { chain: "btc", address: "bc1qcopyme", tag: "cold" });
  await page.getByTestId("settings-btn").click();
  await page.getByRole("button", { name: "Actions" }).first().click();
  await page.getByRole("menuitem", { name: "Copy address" }).click();
  await expect(page.getByTestId("toast")).toBeVisible();
});

test("persists wallets across reload", async ({ page }) => {
  await goto(page);
  await addWallet(page, { chain: "btc", address: "bc1qpersist", tag: "cold" });
  await expect(page.getByTestId("grand-total")).toHaveText("$ 60,000");
  await page.reload();
  await expect(page.locator('[data-testid="section"][data-name="Bitcoin"]')).toBeVisible();
  await expect(page.getByTestId("grand-total")).toHaveText("$ 60,000");
});

test("edits a tag from the manage menu", async ({ page }) => {
  await goto(page);
  await addWallet(page, { chain: "btc", address: "bc1qedit", tag: "cold" });
  await page.getByTestId("settings-btn").click();
  await page.getByRole("button", { name: "Actions" }).first().click();
  await page.getByRole("menuitem", { name: "Edit tag" }).click();
  await page.getByTestId("edit-tag-input").fill("vault");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("manage-row").getByText("vault")).toBeVisible();
});

test("deletes a wallet with confirmation", async ({ page }) => {
  await goto(page);
  await addWallet(page, { chain: "btc", address: "bc1qdelete", tag: "cold" });
  await page.getByTestId("settings-btn").click();
  await page.getByRole("button", { name: "Actions" }).first().click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByTestId("confirm-delete").click();
  await expect(page.getByText("No wallets yet.")).toBeVisible();
});

test("fails over to the second BTC endpoint when the first errors", async ({ page }) => {
  await goto(page, { failBlockstream: true });
  await addWallet(page, { chain: "btc", address: "bc1qfailover", tag: "cold" });
  // blockstream 500 -> mempool succeeds -> balance still shows
  await expect(page.getByTestId("grand-total")).toHaveText("$ 60,000");
});

test("marks a chain failed when all endpoints error", async ({ page }) => {
  await goto(page, { btcStatus: 500 });
  await addWallet(page, { chain: "btc", address: "bc1qallfail", tag: "cold" });
  await expect(page.getByTestId("statusline")).toContainText("Failed to update: BTC");
});
