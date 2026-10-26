import type { Page, Route } from "@playwright/test";

// Deterministic mocks for EVERY external endpoint. Enforces the plan's
// non-negotiable rate-limit rule: E2E never touches a live endpoint.
// Same-origin (app) requests pass through; unmatched externals abort loudly.

const PRICES = {
  bitcoin: { usd: 60000 },
  ethereum: { usd: 3000 },
  binancecoin: { usd: 500 },
  tron: { usd: 0.1 },
  "the-open-network": { usd: 5 },
  tether: { usd: 1 },
  "usd-coin": { usd: 1 },
  "binance-usd": { usd: 1 },
};

const ESPLORA_1BTC = {
  chain_stats: { funded_txo_sum: 100000000, spent_txo_sum: 0 },
  mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
};

// Securities: an S&P 500 ETF at 800 EUR, with EUR at 0.8 per USD -> $1,000 a piece.
export const SP500 = "IE00B5BMR087";
export const SP500_NAME = "iShares Core S&P 500 UCITS ETF USD (Acc)";
const SP500_SEARCH = { facets: [{ results: [{ entityType: "FUND", entitySubType: "ETF" }] }] };
const SP500_SNAPSHOT = {
  instrument: { name: SP500_NAME, isin: SP500 },
  quote: { last: 801, isoCurrency: "EUR", unitType: "STK", market: { name: "Xetra" } },
};
const SP500_TRADEGATE = { bid: "799,50", ask: "800,50", last: "800,00", close: 790 };

function json(route: Route, body: unknown) {
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify(body),
  });
}

export interface MockOptions {
  btcStatus?: number; // override to simulate a failing BTC endpoint (per host)
  failBlockstream?: boolean; // fail blockstream so the app fails over to mempool
  onvistaStatus?: number; // e.g. 429 to simulate Onvista rate-limiting lookups
}

export async function mockNetwork(page: Page, opts: MockOptions = {}) {
  await page.route("**/*", async (route) => {
    const url = route.request().url();

    // let the app's own assets load
    if (url.startsWith("http://localhost") || url.startsWith("http://127.0.0.1")) {
      return route.continue();
    }

    if (url.includes("coingecko")) return json(route, PRICES);

    if (url.includes("blockstream")) {
      if (opts.failBlockstream || opts.btcStatus) {
        return route.fulfill({ status: opts.btcStatus ?? 500, body: "err" });
      }
      return json(route, ESPLORA_1BTC);
    }
    if (url.includes("mempool.space")) {
      if (opts.btcStatus) return route.fulfill({ status: opts.btcStatus, body: "err" });
      return json(route, ESPLORA_1BTC);
    }

    // EVM JSON-RPC
    if (url.includes("publicnode") || url.includes("llamarpc") || url.includes("cloudflare-eth")) {
      const body = route.request().postDataJSON();
      if (body?.method === "eth_getBalance") {
        return json(route, { jsonrpc: "2.0", id: 1, result: "0xde0b6b3a7640000" }); // 1 ETH
      }
      if (body?.method === "eth_call") {
        return json(route, {
          jsonrpc: "2.0",
          id: 1,
          result: "0x0000000000000000000000000000000000000000000000000000000005f5e100", // 100 USDT
        });
      }
      return json(route, { jsonrpc: "2.0", id: 1, result: "0x0" });
    }

    // Tron (TronScan, either host): native + all TRC-20 in one call
    if (url.includes("tronscan")) {
      return json(route, {
        balance: 5000000, // 5 TRX
        trc20token_balances: [
          { tokenId: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", balance: "100000000" }, // 100 USDT
        ],
      });
    }
    // Tron (TronGrid failover): same data, different envelope
    if (url.includes("trongrid")) {
      return json(route, {
        success: true,
        data: [
          {
            balance: 5000000,
            trc20: [{ TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t: "100000000" }],
          },
        ],
      });
    }

    // TON
    if (url.includes("tonapi")) return json(route, { balance: 2500000000 }); // 2.5 GRAM
    if (url.includes("toncenter")) return json(route, { ok: true, result: "2500000000" });

    // Securities: Tradegate prices, Onvista looks ISINs up, Frankfurter/er-api give fx.
    // Tradegate answers an ISIN it does not trade with an empty 200.
    if (url.includes("tradegatebsx")) {
      if (url.includes(SP500)) return json(route, SP500_TRADEGATE);
      return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*" }, body: "" });
    }
    if (url.includes("api.onvista.de")) {
      if (opts.onvistaStatus) {
        return route.fulfill({
          status: opts.onvistaStatus,
          headers: { "access-control-allow-origin": "*" },
          body: "{}",
        });
      }
      if (url.includes("/search/")) return json(route, url.includes(SP500) ? SP500_SEARCH : { facets: [] });
      if (url.includes("/snapshot") && url.includes(SP500)) return json(route, SP500_SNAPSHOT);
      return route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "{}" });
    }
    if (url.includes("frankfurter")) return json(route, { rates: { EUR: 0.8 } });
    if (url.includes("er-api")) return json(route, { result: "success", rates: { USD: 1, EUR: 0.8 } });

    // anything else is an unexpected live call — fail loudly
    return route.abort();
  });
}
