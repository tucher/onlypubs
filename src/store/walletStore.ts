import { create } from "zustand";
import type {
  Asset,
  Balance,
  ChainId,
  GroupingMode,
  Rates,
  TokenId,
} from "../domain/types";
import { assetId } from "../registry";
import {
  loadAssets,
  saveAssets,
  exportAssets,
  parseImport,
  mergeAssets,
} from "../persistence/storage";
import { fetchAllBalances, fetchRates } from "../adapters";

const GROUPING_KEY = "walletwatch.grouping.v1";
const REFRESH_THROTTLE_MS = 10_000; // iOS: min 10s between refreshes

function loadGrouping(): GroupingMode {
  try {
    const v = localStorage.getItem(GROUPING_KEY) || "";
    return v === "byToken" || v === "byTag" ? v : "byChain";
  } catch {
    return "byChain";
  }
}

export interface WalletState {
  assets: Asset[];
  balances: Balance[];
  rates: Rates;
  loading: ChainId[]; // chains currently fetching
  failed: ChainId[]; // chains whose last fetch failed
  lastUpdated: number | null;
  groupingMode: GroupingMode;

  add: (address: string, chain: ChainId, tokens: TokenId[], title: string) => boolean;
  remove: (id: string) => void;
  updateTitle: (adr: string, newTitle: string) => void;
  setGroupingMode: (mode: GroupingMode) => void;
  check: (force?: boolean) => void;
  exportJson: () => string;
  importText: (text: string, mode: "replace" | "merge") => number;
}

let abort: AbortController | null = null;

export const useWalletStore = create<WalletState>((set, get) => ({
  assets: loadAssets(),
  balances: [],
  rates: {},
  loading: [],
  failed: [],
  lastUpdated: null,
  groupingMode: loadGrouping(),

  add(address, chain, tokens, title) {
    const adr = address.trim();
    const label = title.trim();
    const additions: Asset[] = [
      { chain, token: null, adr, title: label || null },
      ...tokens.map((t): Asset => ({ chain, token: t, adr, title: label || null })),
    ];
    const existing = new Set(get().assets.map(assetId));
    if (additions.some((a) => existing.has(assetId(a)))) return false; // atomic dup guard
    const assets = [...get().assets, ...additions];
    saveAssets(assets);
    set({ assets });
    get().check(true);
    return true;
  },

  remove(id) {
    const assets = get().assets.filter((a) => assetId(a) !== id);
    const balances = get().balances.filter((b) => assetId(b.asset) !== id);
    saveAssets(assets);
    set({ assets, balances });
  },

  updateTitle(adr, newTitle) {
    const t = newTitle.trim() || null;
    const assets = get().assets.map((a) => (a.adr === adr ? { ...a, title: t } : a));
    saveAssets(assets);
    // balances carry their asset copy; update those too so grouping-by-tag reflects it
    const balances = get().balances.map((b) =>
      b.asset.adr === adr ? { ...b, asset: { ...b.asset, title: t } } : b,
    );
    set({ assets, balances });
  },

  setGroupingMode(mode) {
    try {
      localStorage.setItem(GROUPING_KEY, mode);
    } catch {
      /* ignore */
    }
    set({ groupingMode: mode });
  },

  check(force = false) {
    const { assets, loading, lastUpdated } = get();
    if (assets.length === 0) return;
    if (loading.length > 0) return; // already fetching
    if (!force && lastUpdated !== null && Date.now() - lastUpdated < REFRESH_THROTTLE_MS) return;

    abort?.abort();
    abort = new AbortController();
    const signal = abort.signal;

    const chainsInvolved = [...new Set(assets.map((a) => a.chain))];
    set({ lastUpdated: Date.now(), failed: [], loading: chainsInvolved });

    // prices (independent of balances)
    fetchRates(signal)
      .then((r) => set((s) => ({ rates: { ...s.rates, ...r } })))
      .catch(() => {
        /* keep prior rates */
      });

    // balances, per chain, each resolving independently
    fetchAllBalances(assets, signal).then((outcomes) => {
      set((s) => {
        let balances = s.balances;
        const failed = [...s.failed];
        for (const o of outcomes) {
          if (o.ok) {
            // replace this chain's balances (dropped assets fall away)
            balances = balances.filter((b) => b.asset.chain !== o.chain).concat(o.balances);
          } else if (!failed.includes(o.chain)) {
            failed.push(o.chain); // keep cached balances for this chain
          }
        }
        const loadingLeft = s.loading.filter(
          (c) => !outcomes.some((o) => o.chain === c),
        );
        return { balances, failed, loading: loadingLeft };
      });
    });
  },

  exportJson() {
    return exportAssets(get().assets);
  },

  importText(text, mode) {
    const incoming = parseImport(text);
    const assets = mode === "replace" ? incoming : mergeAssets(get().assets, incoming);
    // prune balances that no longer have an asset
    const ids = new Set(assets.map(assetId));
    const balances = get().balances.filter((b) => ids.has(assetId(b.asset)));
    saveAssets(assets);
    set({ assets, balances });
    get().check(true);
    return incoming.length;
  },
}));
