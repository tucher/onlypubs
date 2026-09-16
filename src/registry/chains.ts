import type { ChainConfig } from "../domain/types";

// Neutral section-bar color, ported from the iOS `barSectionColor` asset
// (light #EEEEEF / dark #1C1C1F). Chains share this neutral color; tokens are colored.
export const SECTION_BAR_COLOR = "var(--section-bar)";

// --- Chains (data-driven registry; adding an EVM chain is a one-record edit) ---
//
// `decimals` are the TRUE native decimals. Every adapter returns a raw integer
// balance string, and compute divides by 10^decimals uniformly. Public, keyless,
// CORS-enabled endpoints only (validated live) — no API keys in the client.
export const CHAINS: ChainConfig[] = [
  {
    id: "btc",
    name: "Bitcoin",
    symbol: "BTC",
    family: "utxo",
    coingeckoId: "bitcoin",
    decimals: 8,
    rpcs: ["https://blockstream.info/api", "https://mempool.space/api"],
    color: SECTION_BAR_COLOR,
  },
  {
    id: "eth",
    name: "Eth",
    symbol: "ETH",
    family: "evm",
    coingeckoId: "ethereum",
    decimals: 18,
    rpcs: [
      "https://ethereum-rpc.publicnode.com",
      "https://eth.llamarpc.com",
      "https://cloudflare-eth.com",
    ],
    color: SECTION_BAR_COLOR,
  },
  {
    id: "bnb",
    name: "Binance/BSC",
    symbol: "BNB",
    family: "evm",
    coingeckoId: "binancecoin",
    decimals: 18,
    rpcs: ["https://bsc-rpc.publicnode.com", "https://binance.llamarpc.com"],
    color: SECTION_BAR_COLOR,
  },
  {
    id: "trx",
    name: "Tron",
    symbol: "TRX",
    family: "tron",
    coingeckoId: "tron",
    decimals: 6,
    // Measured 2026-09: TronScan now enforces allowed_rps(3) on keyless callers
    // and then SUSPENDS the caller for ~34s, which fails every later call too;
    // TronGrid's keyless tier 429s after ~2 requests. So keep three hosts and
    // alternate providers, so one provider's suspension still leaves a live path.
    // The adapter also paces its requests to stay under the cap (see tron.ts).
    rpcs: [
      "https://apilist.tronscan.org", // TronScan
      "https://api.trongrid.io", // TronGrid — different provider, real redundancy
      "https://apilist.tronscanapi.com", // TronScan, alternate host
    ],
    color: SECTION_BAR_COLOR,
  },
  {
    id: "ton",
    name: "Ton",
    symbol: "TON",
    family: "ton",
    coingeckoId: "the-open-network",
    decimals: 9,
    rpcs: ["https://tonapi.io", "https://toncenter.com/api/v2"],
    color: SECTION_BAR_COLOR,
  },
];
