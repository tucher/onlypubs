import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import type { Holding } from "../domain/types";
import { LookupError, lookupIsin, refreshQuotes, resetSecuritiesState, tradegateNumber } from "./securities";
import { fetchFx } from "./fx";
import { resetCooldowns } from "./http";

// Reply shapes: a JSON body, an HTTP error status, or Tradegate's empty 200 for
// an ISIN it does not trade. `undefined` = network error.
const EMPTY = { __empty: true };
const status = (code: number) => ({ __status: code });

function mockFetch(handler: (url: string) => unknown) {
  const fn = vi.fn(async (url: string) => {
    const r = handler(String(url)) as Record<string, unknown> | undefined;
    if (r === undefined) throw new Error(`network error for ${url}`);
    if (r === EMPTY) {
      return {
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected end of JSON input");
        },
      } as unknown as Response;
    }
    if (typeof r.__status === "number") {
      return { ok: false, status: r.__status, json: async () => ({}) } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => r } as unknown as Response;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

// Shapes as observed live (2026-10), trimmed to the fields the adapter reads.
const SP500 = "IE00B5BMR087";
const BUND = "DE0001102580";
const APPLE = "US0378331005";
const TREASURY = "US912810TM09";

const SEARCH: Record<string, unknown> = {
  [SP500]: { facets: [{ results: [{ entityType: "FUND", entitySubType: "ETF" }] }] },
  [BUND]: { facets: [{ results: [{ entityType: "BOND" }] }] },
  [APPLE]: { facets: [{ results: [{ entityType: "STOCK" }] }] },
  [TREASURY]: { facets: [{ results: null }, { results: [{ entityType: "BOND" }] }] },
};

const SNAPSHOT: Record<string, unknown> = {
  [SP500]: {
    instrument: { name: "iShares Core S&P 500 UCITS ETF USD (Acc)", isin: SP500 },
    quote: { last: 741.5, isoCurrency: "EUR", unitType: "STK", market: { name: "Xetra" } },
  },
  [BUND]: {
    instrument: { name: "Bundesanleihe v. 2022 (15.02.2032)", isin: BUND },
    quote: { last: 84.648, isoCurrency: "EUR", unitType: "PCT", market: { name: "Stuttgart" } },
    bondsFigures: { accruedInterest: 1.5 },
  },
  [APPLE]: {
    instrument: { name: "Apple", isin: APPLE },
    quote: { last: 343.47, isoCurrency: "USD", unitType: "STK", market: { name: "Nasdaq" } },
  },
  // live: the default venue is German and reports EUR, the nominal is USD
  [TREASURY]: {
    instrument: { name: "United States of America DL-Bonds 2022(42)", isin: TREASURY },
    quote: { last: 86.19, isoCurrency: "EUR", unitType: "PCT", market: { name: "Baader Trading" } },
    bondsDetails: { nominal: 100, isoCurrency: "USD" },
    bondsFigures: { accruedInterest: 1.819178082191781 },
  },
};

const TRADEGATE: Record<string, unknown> = {
  [SP500]: { bid: "740,70", ask: "741,20", last: "741,20", close: 734.78 },
  [BUND]: { bid: 84.591, ask: 84.741, last: "./.", close: 84.7 }, // no trade today
  [APPLE]: EMPTY, // pretend Tradegate does not list it
  [TREASURY]: EMPTY, // live: not traded on Tradegate
};

function isinOf(url: string): string {
  return url.match(/[A-Z]{2}[A-Z0-9]{9}[0-9]/)?.[0] ?? "";
}

function liveLike(url: string): unknown {
  const isin = isinOf(url);
  if (url.includes("tradegatebsx")) return TRADEGATE[isin] ?? EMPTY;
  if (url.includes("/search/")) return SEARCH[isin] ?? { facets: [] };
  if (url.includes("/snapshot")) return SNAPSHOT[isin] ?? status(404);
  return undefined;
}

const holding = (isin: string, meta: Holding["meta"]): Holding => ({
  id: isin,
  isin,
  qty: 1,
  title: null,
  meta,
});

beforeEach(() => resetSecuritiesState(0)); // no pacing waits in tests
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetCooldowns();
});

describe("tradegateNumber", () => {
  it("reads JSON numbers and German-formatted strings", () => {
    expect(tradegateNumber(741.2)).toBe(741.2);
    expect(tradegateNumber("740,70")).toBe(740.7);
    expect(tradegateNumber("1.234,56")).toBe(1234.56);
    expect(tradegateNumber("741.20")).toBe(741.2);
  });

  it("treats './.', empty and missing values as no value", () => {
    expect(tradegateNumber("./.")).toBeNull();
    expect(tradegateNumber("")).toBeNull();
    expect(tradegateNumber(undefined)).toBeNull();
    expect(tradegateNumber(0)).toBeNull();
  });
});

describe("lookupIsin", () => {
  it("resolves an ETF via Onvista and prices it from Tradegate", async () => {
    mockFetch(liveLike);
    const { meta, quote } = await lookupIsin(SP500);
    expect(meta).toEqual({
      name: "iShares Core S&P 500 UCITS ETF USD (Acc)",
      kind: "etf",
      currency: "EUR",
    });
    expect(quote).toEqual({ price: 741.2, currency: "EUR", percent: false, venue: "Tradegate" });
  });

  it("prices a bond in percent of nominal, from the bid/ask midpoint when nothing traded", async () => {
    mockFetch(liveLike);
    const { meta, quote } = await lookupIsin(BUND);
    expect(meta.kind).toBe("bond");
    expect(quote.percent).toBe(true);
    expect(quote.price).toBeCloseTo(84.666, 6);
    expect(quote.currency).toBe("EUR");
    expect(quote.accrued).toBe(1.5); // Tradegate's clean price + Onvista's accrued interest
  });

  it("falls back to the Onvista quote when Tradegate does not list the ISIN", async () => {
    mockFetch(liveLike);
    const { meta, quote } = await lookupIsin(APPLE);
    expect(meta).toEqual({ name: "Apple", kind: "stock", currency: "USD" });
    expect(quote).toEqual({ price: 343.47, currency: "USD", percent: false, venue: "Nasdaq" });
  });

  it("values a bond's percent quote in its nominal currency, not the venue's", async () => {
    mockFetch(liveLike);
    const { meta, quote } = await lookupIsin(TREASURY);
    expect(meta).toEqual({
      name: "United States of America DL-Bonds 2022(42)",
      kind: "bond",
      currency: "USD",
    });
    expect(quote).toEqual({
      price: 86.19,
      currency: "USD",
      percent: true,
      venue: "Baader Trading",
      accrued: 1.819178082191781,
    });
  });

  it("reports notFound when the search has no stock, fund or bond", async () => {
    mockFetch((url) =>
      url.includes("/search/")
        ? { facets: [{ results: [{ entityType: "DERIVATIVE" }] }] }
        : liveLike(url),
    );
    await expect(lookupIsin(SP500)).rejects.toMatchObject({ reason: "notFound" });
  });

  it("reports rateLimited on a 429 and stops calling Onvista while parked", async () => {
    const fetch = mockFetch((url) => (url.includes("onvista") ? status(429) : liveLike(url)));
    await expect(lookupIsin(SP500)).rejects.toMatchObject({ reason: "rateLimited" });

    fetch.mockClear();
    const err = await lookupIsin(SP500).catch((e) => e);
    expect(err).toBeInstanceOf(LookupError);
    expect(err.reason).toBe("rateLimited");
    const onvistaCalls = fetch.mock.calls.filter(([u]) => String(u).includes("onvista"));
    expect(onvistaCalls).toHaveLength(0);
  });
});

describe("refreshQuotes", () => {
  const etfMeta = { name: "S&P 500", kind: "etf" as const, currency: "EUR" };
  const appleMeta = { name: "Apple", kind: "stock" as const, currency: "USD" };

  it("prices from Tradegate first and falls back to Onvista per ISIN", async () => {
    mockFetch(liveLike);
    const { quotes, metas } = await refreshQuotes([
      holding(SP500, etfMeta),
      holding(APPLE, appleMeta),
    ]);
    expect(quotes[SP500].venue).toBe("Tradegate");
    expect(quotes[APPLE].venue).toBe("Nasdaq");
    expect(metas).toEqual({});
  });

  it("asks once per ISIN even when it is held under several tags", async () => {
    const fetch = mockFetch(liveLike);
    await refreshQuotes([holding(SP500, etfMeta), { ...holding(SP500, etfMeta), id: "b" }]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("reuses a recent Onvista quote instead of asking again", async () => {
    const fetch = mockFetch(liveLike);
    await refreshQuotes([holding(APPLE, appleMeta)]);
    fetch.mockClear();
    const { quotes } = await refreshQuotes([holding(APPLE, appleMeta)]);
    expect(quotes[APPLE].price).toBe(343.47);
    expect(fetch.mock.calls.filter(([u]) => String(u).includes("onvista"))).toHaveLength(0);
  });

  const bundMeta = { name: "Bund", kind: "bond" as const, currency: "EUR" };

  it("adds Onvista's accrued interest to a Tradegate bond price, cached for hours", async () => {
    const fetch = mockFetch(liveLike);
    const { quotes } = await refreshQuotes([holding(BUND, bundMeta)]);
    expect(quotes[BUND]).toMatchObject({ venue: "Tradegate", accrued: 1.5 });

    fetch.mockClear();
    const again = await refreshQuotes([holding(BUND, bundMeta)]);
    expect(again.quotes[BUND].accrued).toBe(1.5);
    expect(fetch.mock.calls.filter(([u]) => String(u).includes("onvista"))).toHaveLength(0);
  });

  it("keeps the last known accrued interest when Onvista is unavailable", async () => {
    mockFetch(liveLike);
    await refreshQuotes([holding(BUND, bundMeta)]);

    const later = Date.now() + 7 * 60 * 60_000; // past the cache window
    vi.spyOn(Date, "now").mockReturnValue(later);
    mockFetch((url) => (url.includes("onvista") ? status(429) : liveLike(url)));
    const { quotes } = await refreshQuotes([holding(BUND, bundMeta)]);
    expect(quotes[BUND]).toMatchObject({ venue: "Tradegate", accrued: 1.5 });
  });

  it("still prices a bond when no accrued interest is known at all", async () => {
    mockFetch((url) => (url.includes("onvista") ? status(503) : liveLike(url)));
    const { quotes } = await refreshQuotes([holding(BUND, bundMeta)]);
    expect(quotes[BUND].price).toBeCloseTo(84.666, 6);
    expect(quotes[BUND].accrued).toBeUndefined();
  });

  it("looks up a holding that has no meta yet", async () => {
    mockFetch(liveLike);
    const { quotes, metas } = await refreshQuotes([holding(SP500, null)]);
    expect(metas[SP500].kind).toBe("etf");
    expect(quotes[SP500].price).toBe(741.2);
  });

  it("throws only when every ISIN failed", async () => {
    mockFetch(() => undefined);
    await expect(refreshQuotes([holding(SP500, etfMeta)])).rejects.toBeTruthy();
  });
});

describe("fetchFx", () => {
  it("reads ECB rates from Frankfurter and adds the USD base", async () => {
    mockFetch((url) => (url.includes("frankfurter") ? { rates: { EUR: 0.8938, GBP: 0.7492 } } : undefined));
    expect(await fetchFx()).toEqual({ EUR: 0.8938, GBP: 0.7492, USD: 1 });
  });

  it("falls back to open.er-api when Frankfurter fails", async () => {
    mockFetch((url) =>
      url.includes("er-api") ? { result: "success", rates: { USD: 1, EUR: 0.9 } } : status(503),
    );
    expect((await fetchFx()).EUR).toBe(0.9);
  });
});
