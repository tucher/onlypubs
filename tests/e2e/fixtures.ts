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

    // Tron (TronScan): native + all TRC-20 in one call
    if (url.includes("tronscanapi")) {
      return json(route, {
        balance: 5000000, // 5 TRX
        trc20token_balances: [
          { tokenId: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", balance: "100000000" }, // 100 USDT
        ],
      });
    }

    // TON
    if (url.includes("tonapi")) return json(route, { balance: 2500000000 }); // 2.5 TON
    if (url.includes("toncenter")) return json(route, { ok: true, result: "2500000000" });

    // anything else is an unexpected live call — fail loudly
    return route.abort();
  });
}
