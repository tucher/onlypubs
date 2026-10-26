import type { Holding, Quote, Quotes, SecurityKind, SecurityMeta } from "../domain/types";
import { HttpError, httpJson, isCoolingDown, markRateLimited, settleSerial } from "./http";

// Securities are priced from two keyless sources, both keyed by ISIN directly and
// both sending `access-control-allow-origin: *`:
//
// - Tradegate: a price in EUR and nothing else (no name, no type, and nothing for
//   an ISIN it does not trade). Light and lenient — its own page polls it every
//   10 s — so it prices every refresh.
// - Onvista: name, type, currency and a quote. In testing (2026-10) it answered
//   non-browser clients (curl's User-Agent) with 429s that lasted well over 10
//   minutes, while a browser was served fine. Not knowing its real limits, it is
//   used sparingly: once per ISIN when a holding is added, and as the price
//   fallback for ISINs Tradegate does not list.
const TRADEGATE = "https://www.tradegatebsx.com/refresh.php";
const ONVISTA = "https://api.onvista.de/api/v1";

const TRADEGATE_GAP_MS = 250;
// Not measured: a conservative spacing, since its limits for browsers are unknown.
const ONVISTA_GAP_MS = 1500;
const ONVISTA_COOLDOWN_MS = 15 * 60_000;
const ONVISTA_QUOTE_TTL_MS = 5 * 60_000;
// Accrued interest moves once a day; Onvista computes it as of its last price.
const ONVISTA_ACCRUED_TTL_MS = 6 * 60 * 60_000;

export type LookupFailure = "notFound" | "rateLimited" | "failed";

export class LookupError extends Error {
  readonly reason: LookupFailure;
  constructor(reason: LookupFailure) {
    super(`ISIN lookup failed: ${reason}`);
    this.name = "LookupError";
    this.reason = reason;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- Tradegate ----

interface TradegateResponse {
  bid?: unknown;
  ask?: unknown;
  last?: unknown;
  close?: unknown;
}

// Tradegate mixes JSON numbers with German-formatted strings ("740,70",
// "1.234,56") and writes "./." for "no value".
export function tradegateNumber(v: unknown): number | null {
  let n: number;
  if (typeof v === "number") n = v;
  else if (typeof v === "string") {
    const s = v.trim();
    n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  } else return null;
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Last trade, else the bid/ask midpoint (bonds often go a day without a trade),
// else the previous close.
async function tradegatePrice(isin: string, signal?: AbortSignal): Promise<number> {
  // An ISIN Tradegate does not trade comes back as an empty 200, which httpJson
  // rejects as invalid JSON — the same "no price here" outcome as below.
  const d = await httpJson<TradegateResponse | null>(
    `${TRADEGATE}?isin=${encodeURIComponent(isin)}`,
    { signal },
  );
  const bid = tradegateNumber(d?.bid);
  const ask = tradegateNumber(d?.ask);
  const price =
    tradegateNumber(d?.last) ?? (bid && ask ? (bid + ask) / 2 : null) ?? tradegateNumber(d?.close);
  if (price === null) throw new Error(`tradegate: no price for ${isin}`);
  return price;
}

function tradegateQuote(price: number, meta: SecurityMeta): Quote {
  const percent = meta.kind === "bond";
  // Tradegate trades in EUR, but a percent quote applies to the bond's own nominal.
  return { price, currency: percent ? meta.currency : "EUR", percent, venue: "Tradegate" };
}

// ---- Onvista ----

interface OnvistaSearchResult {
  entityType?: string;
  entitySubType?: string;
}

interface OnvistaSearch {
  facets?: { results?: OnvistaSearchResult[] }[];
}

interface OnvistaSnapshot {
  instrument?: { name?: string; isin?: string };
  quote?: {
    last?: number;
    isoCurrency?: string; // the venue's trading currency
    unitType?: string; // "STK" per piece, "PCT" percent of nominal
    market?: { name?: string };
  };
  bondsDetails?: { isoCurrency?: string }; // a bond's nominal currency
  bondsFigures?: { accruedInterest?: number }; // percent of nominal
}

const SNAPSHOT_PATH: Record<SecurityKind, string> = {
  stock: "stocks",
  etf: "funds",
  fund: "funds",
  bond: "bonds",
};

function kindOf(r: OnvistaSearchResult): SecurityKind | null {
  switch (r.entityType) {
    case "STOCK":
      return "stock";
    case "FUND":
      return r.entitySubType === "ETF" ? "etf" : "fund";
    case "BOND":
      return "bond";
    default:
      return null; // derivatives, indices, … are out of scope
  }
}

let onvistaNextSlot = 0;
let onvistaGapMs = ONVISTA_GAP_MS;

// Every Onvista call goes through here: spaced out, and skipped outright while a
// 429 has the host parked (retrying during the penalty only risks extending it).
async function onvista<T>(path: string, signal?: AbortSignal): Promise<T> {
  if (isCoolingDown(ONVISTA)) throw new LookupError("rateLimited");
  const now = Date.now();
  const slot = Math.max(onvistaNextSlot, now);
  onvistaNextSlot = slot + onvistaGapMs;
  if (slot > now) await sleep(slot - now);
  try {
    return await httpJson<T>(`${ONVISTA}${path}`, { signal });
  } catch (e) {
    if (e instanceof HttpError && e.status === 429) {
      markRateLimited(ONVISTA, ONVISTA_COOLDOWN_MS);
      throw new LookupError("rateLimited");
    }
    if (e instanceof HttpError && e.status === 404) throw new LookupError("notFound");
    throw e;
  }
}

// Onvista quotes are reused for a while, so a tab that keeps regaining focus
// does not spend the request budget on ISINs Tradegate does not list.
const quoteCache = new Map<string, { quote: Quote; at: number }>();
const accruedCache = new Map<string, { accrued: number; at: number }>();

function withAccrued(q: Quote, accrued: number | undefined): Quote {
  return accrued === undefined ? q : { ...q, accrued };
}

async function onvistaSnapshot(
  isin: string,
  kind: SecurityKind,
  signal?: AbortSignal,
): Promise<{ name: string; quote: Quote }> {
  const snap = await onvista<OnvistaSnapshot>(
    `/${SNAPSHOT_PATH[kind]}/ISIN:${encodeURIComponent(isin)}/snapshot`,
    signal,
  );
  const name = snap.instrument?.name;
  if (snap.instrument?.isin !== isin || !name) throw new LookupError("notFound");
  const q = snap.quote;
  if (typeof q?.last !== "number" || !(q.last > 0) || !q.isoCurrency) {
    throw new Error(`onvista: no quote for ${isin}`);
  }
  const percent = q.unitType === "PCT";
  const accrued = snap.bondsFigures?.accruedInterest;
  const quote: Quote = withAccrued(
    {
      price: q.last,
      // A percent quote applies to the nominal, in the bond's own currency: a US
      // Treasury quoted on a German venue is still a percent of USD, even though
      // that venue reports EUR.
      currency: (percent && snap.bondsDetails?.isoCurrency) || q.isoCurrency,
      percent,
      venue: q.market?.name ?? "Onvista",
    },
    percent && typeof accrued === "number" && accrued >= 0 ? accrued : undefined,
  );
  const now = Date.now();
  quoteCache.set(isin, { quote, at: now });
  if (quote.accrued !== undefined) accruedCache.set(isin, { accrued: quote.accrued, at: now });
  return { name, quote };
}

async function onvistaQuote(isin: string, kind: SecurityKind, signal?: AbortSignal): Promise<Quote> {
  const hit = quoteCache.get(isin);
  if (hit && Date.now() - hit.at < ONVISTA_QUOTE_TTL_MS) return hit.quote;
  return (await onvistaSnapshot(isin, kind, signal)).quote;
}

// Tradegate reports only the clean price, so a bond priced there takes its accrued
// interest from Onvista. When Onvista is unavailable the last known value stands
// in: dropping it would make the total jump by a couple of percent.
async function onvistaAccrued(isin: string, signal?: AbortSignal): Promise<number | undefined> {
  const hit = accruedCache.get(isin);
  if (hit && Date.now() - hit.at < ONVISTA_ACCRUED_TTL_MS) return hit.accrued;
  try {
    return (await onvistaSnapshot(isin, "bond", signal)).quote.accrued;
  } catch {
    return hit?.accrued;
  }
}

// ---- public API ----

export interface Lookup {
  meta: SecurityMeta;
  quote: Quote;
}

// Resolve an ISIN to its name, kind and currency, plus a first quote. Tradegate is
// asked in parallel so that, when it lists the ISIN, the preview shows the same
// price the list will show. Throws LookupError.
export async function lookupIsin(isin: string, signal?: AbortSignal): Promise<Lookup> {
  const tradegate = tradegatePrice(isin, signal).catch(() => null);
  try {
    const search = await onvista<OnvistaSearch>(
      `/instruments/search/facet?searchValue=${encodeURIComponent(isin)}`,
      signal,
    );
    const kind = (search.facets ?? [])
      .flatMap((f) => f.results ?? [])
      .map(kindOf)
      .find((k) => k !== null);
    if (!kind) throw new LookupError("notFound");

    const { name, quote } = await onvistaSnapshot(isin, kind, signal);
    const meta: SecurityMeta = { name, kind, currency: quote.currency };
    const tgPrice = await tradegate;
    return {
      meta,
      quote: tgPrice !== null ? withAccrued(tradegateQuote(tgPrice, meta), quote.accrued) : quote,
    };
  } catch (e) {
    if (e instanceof LookupError || signal?.aborted) throw e;
    throw new LookupError("failed");
  }
}

export interface QuotesRefresh {
  quotes: Quotes;
  metas: Record<string, SecurityMeta>; // lookups made for holdings that had no meta
}

// One price per ISIN (the same ISIN may be held under several tags). A holding
// without meta (a hand-written import) is looked up first, which also prices it.
// Throws only when every ISIN failed, like a chain adapter.
export async function refreshQuotes(
  holdings: Holding[],
  signal?: AbortSignal,
): Promise<QuotesRefresh> {
  const byIsin = new Map<string, SecurityMeta | null>();
  for (const h of holdings) if (!byIsin.get(h.isin)) byIsin.set(h.isin, h.meta);

  const quotes: Quotes = {};
  const metas: Record<string, SecurityMeta> = {};
  await settleSerial(
    [...byIsin],
    async ([isin, meta]) => {
      if (!meta) {
        const found = await lookupIsin(isin, signal);
        metas[isin] = found.meta;
        quotes[isin] = found.quote;
        return;
      }
      const quote = await tradegatePrice(isin, signal).then(
        (price) => tradegateQuote(price, meta),
        () => onvistaQuote(isin, meta.kind, signal),
      );
      quotes[isin] =
        quote.percent && quote.accrued === undefined
          ? withAccrued(quote, await onvistaAccrued(isin, signal))
          : quote;
    },
    TRADEGATE_GAP_MS,
  );
  return { quotes, metas };
}

// test seam: pacing and the caches are module state
export function resetSecuritiesState(gapMs: number = ONVISTA_GAP_MS): void {
  quoteCache.clear();
  accruedCache.clear();
  onvistaNextSlot = 0;
  onvistaGapMs = gapMs;
}
