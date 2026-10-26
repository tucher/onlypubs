import type { Asset, Holding, SecurityKind, SecurityMeta } from "../domain/types";
import { assetId } from "../registry";
import { isValidIsin, normalizeIsin } from "../compute/isin";

// Wallets and securities, persisted as JSON in localStorage under separate keys.
// Wallets keep the original [{ chain, token, adr, title }] shape.
const STORAGE_KEY = "onlypubs.assets.v1";
const HOLDINGS_KEY = "onlypubs.holdings.v1";
const LEGACY_STORAGE_KEY = "walletwatch.assets.v1"; // pre-rename; migrated on first load

// Copy the wallet list from the old key to the new one, once.
function migrateLegacyKey(): void {
  try {
    if (localStorage.getItem(STORAGE_KEY) !== null) return;
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy !== null) {
      localStorage.setItem(STORAGE_KEY, legacy);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
  } catch {
    /* ignore */
  }
}

function normalize(raw: unknown): Asset[] {
  if (!Array.isArray(raw)) return [];
  const out: Asset[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (typeof o.chain !== "string" || typeof o.adr !== "string") continue;
    const asset: Asset = {
      chain: o.chain,
      token: typeof o.token === "string" ? o.token : null,
      adr: o.adr,
      title: typeof o.title === "string" ? o.title : null,
    };
    const id = assetId(asset);
    if (seen.has(id)) continue; // de-dupe (Set semantics from iOS)
    seen.add(id);
    out.push(asset);
  }
  return out;
}

export function loadAssets(): Asset[] {
  migrateLegacyKey();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return normalize(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function saveAssets(assets: Asset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(assets));
  } catch {
    // storage full / disabled — non-fatal for a read-only watcher
  }
}

// --- securities ---

const KINDS = new Set<string>(["stock", "etf", "fund", "bond"] satisfies SecurityKind[]);

function normalizeMeta(raw: unknown): SecurityMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.name !== "string" || typeof o.currency !== "string") return null;
  if (typeof o.kind !== "string" || !KINDS.has(o.kind)) return null;
  return { name: o.name, kind: o.kind as SecurityKind, currency: o.currency };
}

export function newHoldingId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// A holding without meta is kept: the store looks it up on the next refresh.
function normalizeHoldings(raw: unknown): Holding[] {
  if (!Array.isArray(raw)) return [];
  const out: Holding[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (typeof o.isin !== "string" || typeof o.qty !== "number") continue;
    const isin = normalizeIsin(o.isin);
    if (!isValidIsin(isin) || !Number.isFinite(o.qty) || o.qty < 0) continue;
    const id = typeof o.id === "string" && o.id !== "" ? o.id : newHoldingId();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      isin,
      qty: o.qty,
      title: typeof o.title === "string" ? o.title : null,
      meta: normalizeMeta(o.meta),
    });
  }
  return out;
}

export function loadHoldings(): Holding[] {
  try {
    const raw = localStorage.getItem(HOLDINGS_KEY);
    if (!raw) return [];
    return normalizeHoldings(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function saveHoldings(holdings: Holding[]): void {
  try {
    localStorage.setItem(HOLDINGS_KEY, JSON.stringify(holdings));
  } catch {
    // storage full / disabled — non-fatal for a read-only watcher
  }
}

// --- import / export ---

export interface Portfolio {
  assets: Asset[];
  holdings: Holding[];
}

// { wallets, securities }. Backups from before securities are a bare wallets
// array (the old iOS schema); parseImport still reads those.
export function exportPortfolio({ assets, holdings }: Portfolio): string {
  return JSON.stringify({ wallets: assets, securities: holdings }, null, 2);
}

export function parseImport(text: string): Portfolio {
  const raw: unknown = JSON.parse(text);
  if (Array.isArray(raw)) return { assets: normalize(raw), holdings: [] };
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return { assets: normalize(o.wallets), holdings: normalizeHoldings(o.securities) };
}

// merge two lists, de-duping by asset identity (import "merge" option)
export function mergeAssets(current: Asset[], incoming: Asset[]): Asset[] {
  const byId = new Map<string, Asset>();
  for (const a of current) byId.set(assetId(a), a);
  for (const a of incoming) byId.set(assetId(a), a);
  return [...byId.values()];
}

export function mergeHoldings(current: Holding[], incoming: Holding[]): Holding[] {
  const byId = new Map<string, Holding>();
  for (const h of current) byId.set(h.id, h);
  for (const h of incoming) byId.set(h.id, h);
  return [...byId.values()];
}
