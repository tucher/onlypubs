// Core domain types. `Asset` mirrors the iOS `AssetModel` field-for-field so the
// JSON import/export schema stays identical: [{ chain, token, adr, title }].

export type Family = "utxo" | "evm" | "tron" | "ton";

export type ChainId = string; // "btc" | "eth" | "bnb" | "trx" | "ton"
export type TokenId = string; // "usdt" | "usdc" | "busd"

export interface TokenOnChain {
  contract: string;
  decimals: number;
}

export interface ChainConfig {
  id: ChainId;
  name: string; // display name, e.g. "Bitcoin"
  symbol: string; // uppercase ticker, e.g. "BTC"
  family: Family;
  coingeckoId: string;
  decimals: number; // TRUE native decimals (adapters return raw integer balances)
  rpcs: string[]; // ordered; adapters fail over head-to-tail
  color: string; // CSS color for the proportional bar
}

export interface TokenConfig {
  id: TokenId;
  name: string; // "Tether"
  symbol: string; // "USDT"
  coingeckoId: string;
  color: string; // CSS color (HSL ported from iOS Token0.color)
  perChain: Record<ChainId, TokenOnChain>;
}

// A watched wallet entry. Serialized to localStorage / import-export as-is.
export interface Asset {
  chain: ChainId;
  token: TokenId | null; // null = native chain coin
  adr: string;
  title: string | null;
}

// A fetched raw balance: `raw` is the integer balance as a decimal string
// (satoshis / wei / sun / nanotons / raw token units). Normalization happens in compute.
export interface Balance {
  asset: Asset;
  raw: string;
}

export type CoingeckoId = string;
export type Rates = Record<CoingeckoId, number>;

// ---- view models (output of the grouping functions) ----

export interface RowVM {
  id: string;
  name: string;
  icons: string[]; // icon keys (chain/token ids); last is the primary
  coins: number;
  coinsStr: string;
  thisUsd: number;
  totalUsd: number; // denominator for this row's proportional bar
  color: string;
  addresses: string[];
  addressSubtitle: string | null;
}

export interface SectionVM {
  id: string;
  name: string;
  icon: string; // primary icon key
  coins: number;
  coinsStr: string;
  thisUsd: number;
  totalUsd: number; // sort key + denominator for the section bar (÷ grandTotal)
  color: string;
  skipNative: boolean; // hide the section's own native row when it has no native balance
  rows: RowVM[];
}

export type GroupingMode = "byChain" | "byToken" | "byTag";
