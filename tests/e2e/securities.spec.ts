import { test, expect, type Page } from "@playwright/test";
import { mockNetwork, SP500, SP500_NAME, type MockOptions } from "./fixtures";

async function goto(page: Page, opts?: MockOptions) {
  await mockNetwork(page, opts);
  await page.goto("/");
}

async function openSecurityForm(page: Page) {
  await page.getByTestId("add-btn").click();
  await page.getByTestId("add-kind-security").click();
}

async function addSecurity(page: Page, opts: { isin: string; qty: string; tag?: string }) {
  await openSecurityForm(page);
  await page.getByTestId("isin-input").fill(opts.isin);
  await expect(page.getByTestId("security-preview")).toBeVisible();
  await page.getByTestId("qty-input").fill(opts.qty);
  if (opts.tag) await page.getByTestId("tag-input").fill(opts.tag);
  await page.getByTestId("add-submit").click();
}

test("looks an ISIN up, previews the sum, and adds the holding", async ({ page }) => {
  await goto(page);
  await openSecurityForm(page);
  await page.getByTestId("isin-input").fill(SP500);

  const preview = page.getByTestId("security-preview");
  await expect(preview).toContainText(SP500_NAME);
  await expect(preview).toContainText("ETF · 800.00 EUR · Tradegate");

  await page.getByTestId("qty-input").fill("10");
  await expect(page.getByTestId("security-sum")).toHaveText("= 8,000.00 EUR ≈ $ 10,000");

  await page.getByTestId("add-submit").click();
  await expect(page.getByTestId("grand-total")).toHaveText("$ 10,000");
  const section = page.locator('[data-testid="section"][data-name="Securities"]');
  await expect(section).toBeVisible();
  await expect(section.getByTestId("token-row")).toContainText(SP500);
});

test("rejects a mistyped ISIN without looking it up", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await goto(page);
  await openSecurityForm(page);
  await page.getByTestId("isin-input").fill("IE00B5BMR088"); // wrong check digit
  await expect(page.getByTestId("isin-status")).toContainText("Not a valid ISIN");
  await expect(page.getByTestId("add-submit")).toBeDisabled();
  expect(requests.filter((u) => u.includes("onvista"))).toEqual([]);
});

test("explains a rate-limited lookup", async ({ page }) => {
  await goto(page, { onvistaStatus: 429 });
  await openSecurityForm(page);
  await page.getByTestId("isin-input").fill(SP500);
  await expect(page.getByTestId("isin-status")).toContainText("limiting requests");
  await expect(page.getByTestId("add-submit")).toBeDisabled();
});

test("edits a holding's quantity from the manage menu", async ({ page }) => {
  await goto(page);
  await addSecurity(page, { isin: SP500, qty: "10", tag: "broker" });
  await expect(page.getByTestId("grand-total")).toHaveText("$ 10,000");

  await page.getByTestId("settings-btn").click();
  await page.getByTestId("manage-holding").getByRole("button", { name: "Actions" }).click();
  await page.getByRole("menuitem", { name: "Edit quantity & tag" }).click();
  await page.getByTestId("edit-qty-input").fill("12,5");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("manage-holding")).toContainText(`${SP500} · 12.5`);

  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("grand-total")).toHaveText("$ 12,500");
});

test("holdings persist across reload and share tags with wallets", async ({ page }) => {
  await goto(page);
  await addSecurity(page, { isin: SP500, qty: "10", tag: "broker" });
  await page.reload();
  await expect(page.getByTestId("grand-total")).toHaveText("$ 10,000");

  await page.locator('.segmented button[data-mode="byTag"]').click();
  const broker = page.locator('[data-testid="section"][data-name="Broker"]');
  await expect(broker).toBeVisible();
  await expect(broker.getByTestId("token-row")).toContainText(SP500_NAME);
});
