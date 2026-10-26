import { describe, it, expect, beforeEach } from "vitest";
import type { Asset, Holding } from "../domain/types";
import {
  loadAssets,
  saveAssets,
  loadHoldings,
  saveHoldings,
  exportPortfolio,
  parseImport,
  mergeAssets,
  mergeHoldings,
} from "./storage";

const A = (chain: string, token: string | null, adr: string, title: string | null = null): Asset => ({
  chain,
  token,
  adr,
  title,
});

const H = (id: string): Holding => ({
  id,
  isin: "IE00B5BMR087",
  qty: 10,
  title: "ibkr",
  meta: { name: "iShares Core S&P 500 UCITS ETF USD (Acc)", kind: "etf", currency: "EUR" },
});

beforeEach(() => localStorage.clear());

describe("persistence", () => {
  it("round-trips assets through localStorage", () => {
    const assets = [A("btc", null, "bc1", "cold"), A("eth", "usdt", "0x1", null)];
    saveAssets(assets);
    expect(loadAssets()).toEqual(assets);
  });

  it("migrates data from the legacy walletwatch key on load", () => {
    localStorage.setItem("walletwatch.assets.v1", JSON.stringify([A("btc", null, "bc1", "old")]));
    expect(loadAssets()).toEqual([A("btc", null, "bc1", "old")]);
    // migrated to the new key, legacy removed
    expect(localStorage.getItem("onlypubs.assets.v1")).not.toBeNull();
    expect(localStorage.getItem("walletwatch.assets.v1")).toBeNull();
  });

  it("returns [] when empty or corrupt", () => {
    expect(loadAssets()).toEqual([]);
    localStorage.setItem("onlypubs.assets.v1", "{not json");
    expect(loadAssets()).toEqual([]);
  });

  it("de-dupes and drops malformed entries on load", () => {
    localStorage.setItem(
      "onlypubs.assets.v1",
      JSON.stringify([
        A("btc", null, "bc1"),
        A("btc", null, "bc1"), // dup
        { adr: "nochain" }, // malformed
        { chain: "eth" }, // malformed
      ]),
    );
    expect(loadAssets()).toEqual([A("btc", null, "bc1")]);
  });

  it("export writes wallets and securities side by side", () => {
    const json = exportPortfolio({ assets: [A("btc", null, "bc1", "cold")], holdings: [H("h1")] });
    expect(JSON.parse(json)).toEqual({
      wallets: [{ chain: "btc", token: null, adr: "bc1", title: "cold" }],
      securities: [H("h1")],
    });
  });

  it("export round-trips through import", () => {
    const portfolio = { assets: [A("btc", null, "bc1", "cold")], holdings: [H("h1")] };
    expect(parseImport(exportPortfolio(portfolio))).toEqual(portfolio);
  });

  it("still imports a pre-securities backup (bare wallets array)", () => {
    const legacy = JSON.stringify([A("btc", null, "bc1", "cold")]);
    expect(parseImport(legacy)).toEqual({ assets: [A("btc", null, "bc1", "cold")], holdings: [] });
  });

  it("parseImport normalizes and merge de-dupes by identity", () => {
    const incoming = parseImport(JSON.stringify([A("eth", null, "0x1"), A("btc", null, "bc1")]));
    const merged = mergeAssets([A("btc", null, "bc1", "old")], incoming.assets);
    // btc kept once (incoming overrides), eth added
    expect(merged).toHaveLength(2);
    expect(mergeHoldings([H("h1"), H("h2")], [H("h2"), H("h3")]).map((h) => h.id)).toEqual([
      "h1",
      "h2",
      "h3",
    ]);
  });
});

describe("persistence — securities", () => {
  it("round-trips holdings through localStorage", () => {
    saveHoldings([H("h1"), { ...H("h2"), meta: null }]);
    expect(loadHoldings()).toEqual([H("h1"), { ...H("h2"), meta: null }]);
  });

  it("drops invalid ISINs and quantities, keeps a holding without meta", () => {
    const { holdings } = parseImport(
      JSON.stringify({
        securities: [
          { isin: "ie00 b5bm r087", qty: 3 }, // hand-written: no id, no meta, loose ISIN
          { isin: "IE00B5BMR088", qty: 1 }, // bad check digit
          { isin: "IE00B5BMR087", qty: "3" }, // qty not a number
          { isin: "IE00B5BMR087", qty: -1 },
          { isin: "IE00B5BMR087", qty: 1, meta: { name: "x", kind: "warrant", currency: "EUR" } },
        ],
      }),
    );
    expect(holdings).toHaveLength(2);
    expect(holdings[0]).toMatchObject({ isin: "IE00B5BMR087", qty: 3, title: null, meta: null });
    expect(holdings[0].id).not.toBe("");
    expect(holdings[1].meta).toBeNull(); // unknown kind -> looked up again
  });
});
