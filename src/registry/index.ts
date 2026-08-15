import type {
  Asset,
  ChainConfig,
  ChainId,
  TokenConfig,
  TokenId,
  CoingeckoId,
} from "../domain/types";
import { CHAINS } from "./chains";
import { TOKENS } from "./tokens";

export { CHAINS } from "./chains";
export { TOKENS } from "./tokens";

// Verified addresses, ported from iOS `verified1` (AssetModel.swift). Cosmetic crown only.
export const VERIFIED_ADDRESSES = new Set<string>([
  "3Mt8QW6Q3pFU5663CBTvqaupuN4V54z2Zb",
  "0xA96783fF57be417D98F8D6d22343D9CcCC3c4f16",
]);

const CHAIN_BY_ID = new Map(CHAINS.map((c) => [c.id, c]));
const TOKEN_BY_ID = new Map(TOKENS.map((t) => [t.id, t]));

export function getChain(id: ChainId): ChainConfig {
  const c = CHAIN_BY_ID.get(id);
  if (!c) throw new Error(`Unknown chain: ${id}`);
  return c;
}

export function getToken(id: TokenId): TokenConfig {
  const t = TOKEN_BY_ID.get(id);
  if (!t) throw new Error(`Unknown token: ${id}`);
  return t;
}

// Tokens available on a given chain (drives the add-wallet token picker).
export function tokensForChain(chainId: ChainId): TokenConfig[] {
  return TOKENS.filter((t) => t.perChain[chainId] !== undefined);
}

// Decimals for an asset: token's per-chain decimals, else the chain's native decimals.
export function assetDecimals(asset: Asset): number {
  if (asset.token) return getToken(asset.token).perChain[asset.chain].decimals;
  return getChain(asset.chain).decimals;
}

export function isChainAsset(asset: Asset): boolean {
  return asset.token === null;
}

// The coingecko id used to price an asset.
export function assetCoingeckoId(asset: Asset): CoingeckoId {
  return asset.token ? getToken(asset.token).coingeckoId : getChain(asset.chain).coingeckoId;
}

export function assetColor(asset: Asset): string {
  return asset.token ? getToken(asset.token).color : getChain(asset.chain).color;
}

export function isVerified(adr: string): boolean {
  return VERIFIED_ADDRESSES.has(adr);
}

// Every coingecko id we need a price for (one batched request).
export function allCoingeckoIds(): CoingeckoId[] {
  const ids = new Set<CoingeckoId>();
  for (const c of CHAINS) ids.add(c.coingeckoId);
  for (const t of TOKENS) ids.add(t.coingeckoId);
  return [...ids];
}

// Stable identity for an asset — matches iOS `AssetModel.id`.
export function assetId(asset: Asset): string {
  return asset.adr + asset.chain + (asset.token ?? "");
}
