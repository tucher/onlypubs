import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useWalletStore } from "./walletStore";
import { assetId } from "../registry";
import type { Quote, SecurityMeta } from "../domain/types";
import { resetSecuritiesState } from "../adapters/securities";

function resetStore() {
  localStorage.clear();
  useWalletStore.setState({
    assets: [],
    balances: [],
    rates: {},
    loading: [],
    failed: [],
    holdings: [],
    quotes: {},
    fx: {},
    secLoading: false,
    secFailed: false,
    lastUpdated: null,
    groupingMode: "byChain",
  });
  resetSecuritiesState(0);
}

// Actions like add() kick off a refresh. Unless a test mocks the network, every
// request fails here instead of reaching a live endpoint.
function blockNetwork() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      throw new Error(`unexpected live call: ${url}`);
    }),
  );
}

function mockNetwork() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      let body: unknown = {};
      if (u.includes("coingecko")) body = { bitcoin: { usd: 60000 } };
      else if (u.includes("tradegatebsx")) body = { last: "800,00" };
      else if (u.includes("frankfurter")) body = { rates: { EUR: 0.8 } };
      else if (u.includes("blockstream") || u.includes("mempool")) {
        body = {
          chain_stats: { funded_txo_sum: 100000000, spent_txo_sum: 0 },
          mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
        };
      }
      return { ok: true, status: 200, json: async () => body } as Response;
    }),
  );
}

// flush pending promise microtasks
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  resetStore();
  blockNetwork();
});
afterEach(() => vi.unstubAllGlobals());

describe("walletStore", () => {
  it("add() creates native + token assets atomically and rejects dups", () => {
    const s = useWalletStore.getState();
    expect(s.add("bc1", "btc", [], "cold")).toBe(true);
    expect(useWalletStore.getState().assets).toHaveLength(1);
    // duplicate address+chain
    expect(useWalletStore.getState().add("bc1", "btc", [], "cold")).toBe(false);
    expect(useWalletStore.getState().assets).toHaveLength(1);
    // eth native + usdt token = 2 assets
    expect(useWalletStore.getState().add("0x1", "eth", ["usdt"], "hot")).toBe(true);
    expect(useWalletStore.getState().assets).toHaveLength(3);
  });

  it("remove() drops the asset and its balance", () => {
    const st = useWalletStore.getState();
    st.add("bc1", "btc", [], "");
    const id = assetId(useWalletStore.getState().assets[0]);
    useWalletStore.getState().remove(id);
    expect(useWalletStore.getState().assets).toHaveLength(0);
  });

  it("updateTitle() renames all assets with that address", () => {
    useWalletStore.getState().add("0x1", "eth", ["usdt"], "old");
    useWalletStore.getState().updateTitle("0x1", "new");
    expect(useWalletStore.getState().assets.every((a) => a.title === "new")).toBe(true);
  });

  it("check() fetches balances + rates and clears loading", async () => {
    mockNetwork();
    useWalletStore.getState().add("bc1", "btc", [], "cold"); // triggers check(true)
    await flush();
    await flush();
    const s = useWalletStore.getState();
    expect(s.balances).toHaveLength(1);
    expect(s.balances[0].raw).toBe("100000000");
    expect(s.rates.bitcoin).toBe(60000);
    expect(s.loading).toEqual([]);
    expect(s.failed).toEqual([]);
  });

  it("persists assets across store reloads via localStorage", () => {
    useWalletStore.getState().add("bc1", "btc", [], "cold");
    // simulate reload
    const persisted = JSON.parse(localStorage.getItem("onlypubs.assets.v1")!);
    expect(persisted).toEqual([{ chain: "btc", token: null, adr: "bc1", title: "cold" }]);
  });

  // ---- securities ----

  const SP500 = "IE00B5BMR087";
  const META: SecurityMeta = { name: "S&P 500 ETF", kind: "etf", currency: "EUR" };
  const QUOTE: Quote = { price: 741.2, currency: "EUR", percent: false, venue: "Tradegate" };

  it("addHolding() prices at once and rejects the same ISIN under the same tag", () => {
    const st = useWalletStore.getState();
    expect(st.addHolding(SP500, 10, "ibkr", META, QUOTE)).toBe(true);
    expect(useWalletStore.getState().quotes[SP500]).toEqual(QUOTE);
    // same tag (case-insensitive) is a duplicate; another broker is not
    expect(useWalletStore.getState().addHolding(SP500, 1, "IBKR", META, QUOTE)).toBe(false);
    expect(useWalletStore.getState().addHolding(SP500, 5, "bank", META, QUOTE)).toBe(true);
    expect(useWalletStore.getState().holdings.map((h) => [h.qty, h.title])).toEqual([
      [10, "ibkr"],
      [5, "bank"],
    ]);
    const persisted = JSON.parse(localStorage.getItem("onlypubs.holdings.v1")!);
    expect(persisted).toHaveLength(2);
  });

  it("updateHolding() and removeHolding() work by id", () => {
    useWalletStore.getState().addHolding(SP500, 10, "ibkr", META, QUOTE);
    const id = useWalletStore.getState().holdings[0].id;
    useWalletStore.getState().updateHolding(id, 12.5, " broker ");
    expect(useWalletStore.getState().holdings[0]).toMatchObject({ qty: 12.5, title: "broker" });
    useWalletStore.getState().removeHolding(id);
    expect(useWalletStore.getState().holdings).toEqual([]);
  });

  it("check() refreshes quotes + fx for holdings without touching crypto sources", async () => {
    mockNetwork();
    useWalletStore.setState({
      holdings: [{ id: "h1", isin: SP500, qty: 10, title: null, meta: META }],
    });
    useWalletStore.getState().check(true);
    expect(useWalletStore.getState().secLoading).toBe(true);
    await vi.waitFor(() => expect(useWalletStore.getState().secLoading).toBe(false));
    const s = useWalletStore.getState();
    expect(s.quotes[SP500].price).toBe(800);
    expect(s.fx.EUR).toBe(0.8);
    expect(s.secFailed).toBe(false);
    const urls = vi.mocked(fetch).mock.calls.map(([u]) => String(u));
    expect(urls.some((u) => u.includes("coingecko"))).toBe(false);
  });

  it("check() marks securities failed and keeps prior quotes when pricing fails", async () => {
    // blockNetwork() is in place: every source fails
    useWalletStore.setState({
      holdings: [{ id: "h1", isin: SP500, qty: 10, title: null, meta: META }],
      quotes: { [SP500]: QUOTE },
      fx: { USD: 1, EUR: 0.8 },
    });
    useWalletStore.getState().check(true);
    await vi.waitFor(() => expect(useWalletStore.getState().secLoading).toBe(false));
    const s = useWalletStore.getState();
    expect(s.secFailed).toBe(true);
    expect(s.quotes[SP500]).toEqual(QUOTE);
  });

  it("importText() reads wallets and securities, and old wallet-only backups", () => {
    const file = JSON.stringify({
      wallets: [{ chain: "btc", token: null, adr: "bc1", title: null }],
      securities: [{ id: "h1", isin: SP500, qty: 3, title: null, meta: META }],
    });
    expect(useWalletStore.getState().importText(file, "replace")).toBe(2);
    expect(useWalletStore.getState().holdings).toHaveLength(1);

    const legacy = JSON.stringify([{ chain: "eth", token: null, adr: "0x1", title: null }]);
    useWalletStore.getState().importText(legacy, "merge");
    const s = useWalletStore.getState();
    expect(s.assets).toHaveLength(2);
    expect(s.holdings).toHaveLength(1); // merge keeps what the file did not mention
  });
});
