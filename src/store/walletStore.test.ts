import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useWalletStore } from "./walletStore";
import { assetId } from "../registry";

function resetStore() {
  localStorage.clear();
  useWalletStore.setState({
    assets: [],
    balances: [],
    rates: {},
    loading: [],
    failed: [],
    lastUpdated: null,
    groupingMode: "byChain",
  });
}

function mockNetwork() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      let body: unknown = {};
      if (u.includes("coingecko")) body = { bitcoin: { usd: 60000 } };
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

beforeEach(resetStore);
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
});
