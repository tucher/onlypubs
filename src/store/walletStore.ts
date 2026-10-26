import { create } from "zustand";
import type {
  Asset,
  Balance,
  ChainId,
  FxRates,
  GroupingMode,
  Holding,
  Quote,
  Quotes,
  Rates,
  SecurityMeta,
  TokenId,
} from "../domain/types";
import { assetId } from "../registry";
import {
  loadAssets,
  saveAssets,
  loadHoldings,
  saveHoldings,
  newHoldingId,
  exportPortfolio,
  parseImport,
  mergeAssets,
  mergeHoldings,
} from "../persistence/storage";
import { fetchAllBalances, fetchFx, fetchRates, refreshQuotes } from "../adapters";

const GROUPING_KEY = "onlypubs.grouping.v1";
const LEGACY_GROUPING_KEY = "walletwatch.grouping.v1"; // pre-rename; migrated on first load
const REFRESH_THROTTLE_MS = 10_000; // iOS: min 10s between refreshes

function loadGrouping(): GroupingMode {
  try {
    let v = localStorage.getItem(GROUPING_KEY);
    if (v === null) {
      const legacy = localStorage.getItem(LEGACY_GROUPING_KEY);
      if (legacy !== null) {
        localStorage.setItem(GROUPING_KEY, legacy);
        localStorage.removeItem(LEGACY_GROUPING_KEY);
        v = legacy;
      }
    }
    return v === "byToken" || v === "byTag" ? v : "byChain";
  } catch {
    return "byChain";
  }
}

const sameTag = (a: string | null, b: string | null) =>
  (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

export interface WalletState {
  assets: Asset[];
  balances: Balance[];
  rates: Rates;
  loading: ChainId[]; // chains currently fetching
  failed: ChainId[]; // chains whose last fetch failed
  holdings: Holding[];
  quotes: Quotes;
  fx: FxRates;
  secLoading: boolean; // securities quotes currently fetching
  secFailed: boolean; // last securities refresh failed
  lastUpdated: number | null;
  groupingMode: GroupingMode;

  add: (address: string, chain: ChainId, tokens: TokenId[], title: string) => boolean;
  remove: (id: string) => void;
  updateTitle: (adr: string, newTitle: string) => void;
  addHolding: (isin: string, qty: number, title: string, meta: SecurityMeta, quote: Quote) => boolean;
  updateHolding: (id: string, qty: number, title: string) => void;
  removeHolding: (id: string) => void;
  ensureFx: () => void;
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
  holdings: loadHoldings(),
  quotes: {},
  fx: {},
  secLoading: false,
  secFailed: false,
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

  // The quote comes from the lookup the add dialog already made, so the new
  // holding is priced at once. The same ISIN may sit under several tags (two
  // brokers); only the same ISIN under the same tag is a duplicate.
  addHolding(isin, qty, title, meta, quote) {
    const label = title.trim() || null;
    if (get().holdings.some((h) => h.isin === isin && sameTag(h.title, label))) return false;
    const holdings = [...get().holdings, { id: newHoldingId(), isin, qty, title: label, meta }];
    saveHoldings(holdings);
    set((s) => ({ holdings, quotes: { ...s.quotes, [isin]: quote } }));
    get().ensureFx();
    return true;
  },

  updateHolding(id, qty, title) {
    const t = title.trim() || null;
    const holdings = get().holdings.map((h) => (h.id === id ? { ...h, qty, title: t } : h));
    saveHoldings(holdings);
    set({ holdings });
  },

  removeHolding(id) {
    const holdings = get().holdings.filter((h) => h.id !== id);
    saveHoldings(holdings);
    set({ holdings });
  },

  // The add dialog needs rates to show a USD sum before any holding exists.
  ensureFx() {
    if (Object.keys(get().fx).length > 0) return;
    fetchFx()
      .then((fx) => set({ fx }))
      .catch(() => {
        /* the next refresh retries */
      });
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
    const { assets, holdings, loading, secLoading, lastUpdated } = get();
    if (assets.length === 0 && holdings.length === 0) return;
    if (loading.length > 0 || secLoading) return; // already fetching
    if (!force && lastUpdated !== null && Date.now() - lastUpdated < REFRESH_THROTTLE_MS) return;

    abort?.abort();
    abort = new AbortController();
    const signal = abort.signal;

    const chainsInvolved = [...new Set(assets.map((a) => a.chain))];
    set({
      lastUpdated: Date.now(),
      failed: [],
      loading: chainsInvolved,
      secFailed: false,
      secLoading: holdings.length > 0,
    });

    if (holdings.length > 0) refreshSecurities(holdings, signal);
    if (assets.length === 0) return;

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
    return exportPortfolio({ assets: get().assets, holdings: get().holdings });
  },

  importText(text, mode) {
    const incoming = parseImport(text);
    const replace = mode === "replace";
    const assets = replace ? incoming.assets : mergeAssets(get().assets, incoming.assets);
    const holdings = replace ? incoming.holdings : mergeHoldings(get().holdings, incoming.holdings);
    // prune balances that no longer have an asset
    const ids = new Set(assets.map(assetId));
    const balances = get().balances.filter((b) => ids.has(assetId(b.asset)));
    saveAssets(assets);
    saveHoldings(holdings);
    set({ assets, balances, holdings });
    get().check(true);
    return incoming.assets.length + incoming.holdings.length;
  },
}));

// Quotes and fx resolve independently; `secLoading` clears once both settle.
// Prior quotes and rates are kept for whatever fails, like crypto rates.
function refreshSecurities(holdings: Holding[], signal: AbortSignal): void {
  const set = useWalletStore.setState;
  const get = useWalletStore.getState;

  const fx = fetchFx(signal)
    .then((fx) => set({ fx }))
    .catch(() => {
      // without any rates, non-USD holdings cannot be valued at all
      if (Object.keys(get().fx).length === 0) set({ secFailed: true });
    });

  const quotes = refreshQuotes(holdings, signal)
    .then(({ quotes, metas }) => {
      set((s) => ({ quotes: { ...s.quotes, ...quotes } }));
      if (Object.keys(metas).length === 0) return;
      // holdings that arrived without meta (a hand-written import) keep what the lookup found
      const updated = get().holdings.map((h) =>
        !h.meta && metas[h.isin] ? { ...h, meta: metas[h.isin] } : h,
      );
      saveHoldings(updated);
      set({ holdings: updated });
    })
    .catch(() => set({ secFailed: true }));

  Promise.all([fx, quotes]).then(() => set({ secLoading: false }));
}
