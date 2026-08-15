import type { Asset } from "../domain/types";
import { assetId } from "../registry";

// Wallet list persisted as JSON in localStorage. The array shape
// [{ chain, token, adr, title }] is identical to the iOS import/export schema,
// so files move between the app and the web version unchanged.
const STORAGE_KEY = "walletwatch.assets.v1";

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

// --- import / export (matches iOS JSON schema) ---

export function exportAssets(assets: Asset[]): string {
  return JSON.stringify(assets, null, 2);
}

export function parseImport(text: string): Asset[] {
  return normalize(JSON.parse(text));
}

// merge two lists, de-duping by asset identity (import "merge" option)
export function mergeAssets(current: Asset[], incoming: Asset[]): Asset[] {
  const byId = new Map<string, Asset>();
  for (const a of current) byId.set(assetId(a), a);
  for (const a of incoming) byId.set(assetId(a), a);
  return [...byId.values()];
}
