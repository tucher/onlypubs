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

// ---- securities ----

export type SecurityKind = "stock" | "etf" | "fund" | "bond";

// Looked up once when a holding is added and stored with it, so a refresh only
// needs a price.
export interface SecurityMeta {
  name: string;
  kind: SecurityKind;
  currency: string; // the instrument's own currency (for a bond: its nominal currency)
}

// A watched securities position. The inverse of a wallet: the quantity is the
// user's own input and only the price is fetched.
export interface Holding {
  id: string;
  isin: string;
  qty: number; // pieces, or the nominal amount for a bond
  title: string | null; // tag, shared with wallets
  meta: SecurityMeta | null; // null until looked up (e.g. a hand-written import)
}

// `price` is per piece, or a percent of nominal when `percent` is set (bonds).
// A bond's price is "clean": the interest accrued since the last coupon, which a
// buyer pays on top, comes separately in `accrued` (also a percent of nominal).
export interface Quote {
  price: number;
  currency: string;
  percent: boolean;
  venue: string;
  accrued?: number;
}

export type Quotes = Record<string, Quote>; // keyed by ISIN

// Units of each currency per 1 USD, e.g. { USD: 1, EUR: 0.89 }.
export type FxRates = Record<string, number>;

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
