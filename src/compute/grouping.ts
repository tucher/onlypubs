import type {
  Balance,
  ChainId,
  Holding,
  Rates,
  RowVM,
  SectionVM,
  TokenId,
} from "../domain/types";
import {
  assetCoingeckoId,
  getChain,
  getToken,
  isChainAsset,
} from "../registry";
import { normalizedCoins, priceOf } from "./normalize";
import { coins as fmtCoins, shortAddress } from "./format";
import { holdingUsd, NO_SECURITIES, type SecuritiesData } from "./securities";

const UNTITLED = "Untitled"; // iOS kUntitled
const SECURITIES = "Securities";
const SECURITY_COLOR = "hsl(265, 40%, 56%)";

function groupBy<K, T>(items: T[], key: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const it of items) {
    const k = key(it);
    const arr = m.get(k);
    if (arr) arr.push(it);
    else m.set(k, [it]);
  }
  return m;
}

const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);

// USD using iOS defaults (chain price -> 0, token price -> 1 when unquoted).
const usdDefaulted = (b: Balance, rates: Rates) =>
  normalizedCoins(b.raw, b.asset) * priceOf(b.asset, rates);

// USD that skips unquoted coins entirely (matches iOS `if let curs = ...`).
const usdStrict = (b: Balance, rates: Rates) => {
  const q = rates[assetCoingeckoId(b.asset)];
  return q === undefined ? 0 : normalizedCoins(b.raw, b.asset) * q;
};

function addressSubtitle(addresses: string[]): string | null {
  if (addresses.length === 0) return null;
  if (addresses.length === 1) return shortAddress(addresses[0]);
  return `(${addresses.length})`;
}

type RowInput = Omit<RowVM, "id" | "coinsStr" | "addressSubtitle"> & {
  addressSubtitle?: string; // overrides the one derived from `addresses`
};

function makeRow(r: RowInput): RowVM {
  return {
    ...r,
    id: r.icons.join("+") + r.name + r.thisUsd + r.addresses.join(","),
    coinsStr: fmtCoins(r.coins),
    addressSubtitle: r.addressSubtitle ?? addressSubtitle(r.addresses),
  };
}

const byTotalDesc = (a: { totalUsd: number }, b: { totalUsd: number }) =>
  b.totalUsd - a.totalUsd;
const byThisDesc = (a: { thisUsd: number }, b: { thisUsd: number }) =>
  b.thisUsd - a.thisUsd;

function finalizeSection(
  s: Omit<SectionVM, "id" | "coinsStr">,
): SectionVM {
  return {
    ...s,
    id: s.icon + s.name + s.totalUsd + s.thisUsd + s.coins,
    coinsStr: fmtCoins(s.coins),
  };
}

// ---- securities: one row (or section) per ISIN, summed across tags ----
function byIsin(holdings: Holding[], sec: SecuritiesData) {
  return [...groupBy(holdings, (h) => h.isin)].map(([isin, hs]) => {
    const meta = hs.find((h) => h.meta)?.meta;
    return {
      isin,
      name: meta?.name ?? isin,
      icon: meta?.kind ?? "security",
      qty: sum(hs.map((h) => h.qty)),
      usd: sum(hs.map((h) => holdingUsd(h, sec))),
    };
  });
}

function securityRows(holdings: Holding[], sec: SecuritiesData, totalUsd: number): RowVM[] {
  return byIsin(holdings, sec).map((s) =>
    makeRow({
      name: s.name,
      icons: [s.icon],
      coins: s.qty,
      thisUsd: s.usd,
      totalUsd,
      color: SECURITY_COLOR,
      addresses: [s.isin], // tapping the row copies the ISIN
      addressSubtitle: s.isin, // short enough to show whole
    }),
  );
}

// ---- byChain: sections per chain, token sub-rows ----
export function byChain(
  balances: Balance[],
  rates: Rates,
  sec: SecuritiesData = NO_SECURITIES,
): SectionVM[] {
  const groups = groupBy(balances, (b) => b.asset.chain);
  const sections: SectionVM[] = [];
  for (const [chainId, bals] of groups) {
    const chain = getChain(chainId);
    const curs = rates[chain.coingeckoId] ?? 0;

    const natives = bals.filter((b) => isChainAsset(b.asset));
    const totalCoins = sum(natives.map((b) => normalizedCoins(b.raw, b.asset)));
    const thisUsd = totalCoins * curs;

    const tokenBals = bals.filter((b) => !isChainAsset(b.asset));
    const tokensUsd = sum(tokenBals.map((b) => usdDefaulted(b, rates)));
    const totalUsd = thisUsd + tokensUsd;

    const tokenGroups = groupBy(tokenBals, (b) => b.asset.token as TokenId);
    const rows: RowVM[] = [...tokenGroups]
      .map(([tokenId, tbals]) => {
        const token = getToken(tokenId);
        const tCoins = sum(tbals.map((b) => normalizedCoins(b.raw, b.asset)));
        const tUsd = sum(tbals.map((b) => usdDefaulted(b, rates)));
        return makeRow({
          name: token.symbol,
          icons: [tokenId],
          coins: tCoins,
          thisUsd: tUsd,
          totalUsd,
          color: token.color,
          // iOS byChain token rows carry no addresses (no "(N)" subtitle / no copy)
          addresses: [],
        });
      })
      .sort(byThisDesc);

    sections.push(
      finalizeSection({
        name: chain.name,
        icon: chainId,
        coins: totalCoins,
        thisUsd,
        totalUsd,
        color: chain.color,
        skipNative: natives.length === 0,
        rows,
      }),
    );
  }

  // securities sit beside the chains as one more "place" holding value
  if (sec.holdings.length > 0) {
    const totalUsd = sum(sec.holdings.map((h) => holdingUsd(h, sec)));
    sections.push(
      finalizeSection({
        name: SECURITIES,
        icon: "securities",
        coins: 0,
        thisUsd: 0,
        totalUsd,
        color: "var(--section-bar)",
        skipNative: true,
        rows: securityRows(sec.holdings, sec, totalUsd).sort(byThisDesc),
      }),
    );
  }
  return sections.sort(byTotalDesc);
}

// ---- byToken: native chains + token sections (each token lists the chains it's on) ----
export function byToken(
  balances: Balance[],
  rates: Rates,
  sec: SecuritiesData = NO_SECURITIES,
): SectionVM[] {
  const sections: SectionVM[] = [];

  // native coins, grouped by chain
  const nativeGroups = groupBy(
    balances.filter((b) => isChainAsset(b.asset)),
    (b) => b.asset.chain,
  );
  for (const [chainId, bals] of nativeGroups) {
    const chain = getChain(chainId);
    const curs = rates[chain.coingeckoId];
    if (curs === undefined) continue; // iOS guard
    const totalCoins = sum(bals.map((b) => normalizedCoins(b.raw, b.asset)));
    const usd = totalCoins * curs;
    sections.push(
      finalizeSection({
        name: chain.symbol,
        icon: chainId,
        coins: totalCoins,
        thisUsd: usd,
        totalUsd: usd,
        color: chain.color,
        skipNative: false,
        rows: [],
      }),
    );
  }

  // tokens, grouped by token; sub-rows are the chains that hold the token
  const tokenGroups = groupBy(
    balances.filter((b) => !isChainAsset(b.asset)),
    (b) => b.asset.token as TokenId,
  );
  for (const [tokenId, bals] of tokenGroups) {
    const token = getToken(tokenId);
    const curs = rates[token.coingeckoId];
    if (curs === undefined) continue; // iOS guard
    const tokensUsd = sum(bals.map((b) => normalizedCoins(b.raw, b.asset))) * curs;

    const chainGroups = groupBy(bals, (b) => b.asset.chain as ChainId);
    const rows: RowVM[] = [...chainGroups]
      .map(([cid, cbals]) => {
        const chain = getChain(cid);
        const thisUsd =
          sum(cbals.map((b) => normalizedCoins(b.raw, b.asset))) * curs;
        return makeRow({
          name: chain.name,
          icons: [cid],
          coins: 0,
          thisUsd,
          totalUsd: tokensUsd,
          color: token.color,
          // iOS byToken sub-chain rows carry no addresses (no "(N)" subtitle)
          addresses: [],
        });
      })
      .sort(byThisDesc);

    sections.push(
      finalizeSection({
        name: token.symbol,
        icon: tokenId,
        coins: 0,
        thisUsd: 0,
        totalUsd: tokensUsd,
        color: token.color,
        skipNative: true,
        rows,
      }),
    );
  }

  // each security is its own asset, like a native coin
  for (const s of byIsin(sec.holdings, sec)) {
    sections.push(
      finalizeSection({
        name: s.name,
        icon: s.icon,
        coins: s.qty,
        thisUsd: s.usd,
        totalUsd: s.usd,
        color: SECURITY_COLOR,
        skipNative: false,
        rows: [],
      }),
    );
  }

  return sections.sort(byTotalDesc);
}

// ---- byTag: sections per custom label; sub-rows per asset kind ----
function tagKey(title: string | null): string {
  const t = (title ?? "").trim().toLowerCase();
  return t === "" ? UNTITLED.toLowerCase() : t;
}

function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

export function byTag(
  balances: Balance[],
  rates: Rates,
  sec: SecuritiesData = NO_SECURITIES,
): SectionVM[] {
  const groups = groupBy(balances, (b) => tagKey(b.asset.title));
  const holdingGroups = groupBy(sec.holdings, (h) => tagKey(h.title));
  const sections: SectionVM[] = [];

  // a tag can hold wallets, securities, or both (e.g. a broker next to a ledger)
  for (const tag of new Set([...groups.keys(), ...holdingGroups.keys()])) {
    const bals = groups.get(tag) ?? [];
    const holdings = holdingGroups.get(tag) ?? [];
    const totalUsd =
      sum(bals.map((b) => usdStrict(b, rates))) + sum(holdings.map((h) => holdingUsd(h, sec)));

    // sub-group by asset "kind": token-on-chain, or bare chain
    const kindGroups = groupBy(bals, (b) => {
      const a = b.asset;
      return a.token
        ? `${getToken(a.token).symbol} on ${getChain(a.chain).name}`
        : getChain(a.chain).symbol;
    });

    const rows: RowVM[] = [...kindGroups]
      .map(([name, kbals]) => {
        const a0 = kbals[0].asset;
        const icons = a0.token ? [a0.chain, a0.token] : [a0.chain];
        // chain-native rows use a visible neutral bar (the chain "color" is the
        // section-grey, which is invisible against the section background bar)
        const color = a0.token ? getToken(a0.token).color : "var(--token-bar-neutral)";
        const thisUsd = sum(kbals.map((b) => usdStrict(b, rates)));
        const kCoins = sum(kbals.map((b) => normalizedCoins(b.raw, b.asset)));
        return makeRow({
          name,
          icons,
          coins: kCoins,
          thisUsd,
          totalUsd,
          color,
          addresses: kbals.map((b) => b.asset.adr),
        });
      })
      .concat(securityRows(holdings, sec, totalUsd))
      .sort(byThisDesc);

    sections.push(
      finalizeSection({
        name: capitalize(tag),
        icon: tag,
        coins: 0,
        thisUsd: 0,
        totalUsd,
        color: "var(--section-bar)",
        skipNative: true,
        rows,
      }),
    );
  }

  return sections.sort(byTotalDesc);
}

const BUILDERS = { byChain, byToken, byTag } as const;

export function buildSections(
  mode: keyof typeof BUILDERS,
  balances: Balance[],
  rates: Rates,
  sec: SecuritiesData = NO_SECURITIES,
): SectionVM[] {
  return BUILDERS[mode](balances, rates, sec);
}

export function grandTotal(
  balances: Balance[],
  rates: Rates,
  sec: SecuritiesData = NO_SECURITIES,
): number {
  return (
    sum(balances.map((b) => usdStrict(b, rates))) + sum(sec.holdings.map((h) => holdingUsd(h, sec)))
  );
}
