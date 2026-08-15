import type { TokenConfig } from "../domain/types";

// Token colors ported verbatim from iOS `Token0.color` (HSL).
const USDT_COLOR = "hsl(162, 62%, 39%)";
const USDC_COLOR = "hsl(210, 67%, 46%)";
const BUSD_COLOR = "hsl(42, 86%, 58%)";

// Contracts + per-chain decimals ported from iOS `chains1` (ChainsConsts.swift).
// Adding a stablecoin on an existing chain = one entry in `perChain`.
export const TOKENS: TokenConfig[] = [
  {
    id: "usdt",
    name: "Tether",
    symbol: "USDT",
    coingeckoId: "tether",
    color: USDT_COLOR,
    perChain: {
      eth: { contract: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
      bnb: { contract: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 },
      trx: { contract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", decimals: 6 },
    },
  },
  {
    id: "usdc",
    name: "USD Coin",
    symbol: "USDC",
    coingeckoId: "usd-coin",
    color: USDC_COLOR,
    perChain: {
      eth: { contract: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", decimals: 6 },
      trx: { contract: "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8", decimals: 6 },
    },
  },
  {
    id: "busd",
    name: "Binance USD",
    symbol: "BUSD",
    coingeckoId: "binance-usd",
    color: BUSD_COLOR,
    perChain: {
      eth: { contract: "0x4Fabb145d64652a948d72533023f6E7A623C7C53", decimals: 18 },
      bnb: { contract: "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56", decimals: 18 },
    },
  },
];
