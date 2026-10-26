import { describe, it, expect } from "vitest";
import type { Balance, Holding } from "../domain/types";
import { normalizedCoins, priceOf, usdValue } from "./normalize";
import { usd, coins, shortAddress, parseAmount } from "./format";
import { byChain, byToken, byTag, grandTotal } from "./grouping";
import { isValidIsin, normalizeIsin } from "./isin";
import { holdingUsd, toUsd, type SecuritiesData } from "./securities";

// Fixed rates for deterministic math.
const RATES = {
  bitcoin: 60000,
  ethereum: 3000,
  binancecoin: 500,
  tron: 0.1,
  "the-open-network": 5,
  tether: 1,
  "usd-coin": 1,
  "binance-usd": 1,
};

const bal = (
  chain: string,
  token: string | null,
  adr: string,
  raw: string,
  title: string | null = null,
): Balance => ({ asset: { chain, token, adr, title }, raw });

describe("normalize", () => {
  it("divides raw by 10^decimals per asset", () => {
    // 1.5 BTC in satoshis
    expect(normalizedCoins("150000000", bal("btc", null, "a", "0").asset)).toBe(1.5);
    // 2 ETH in wei
    expect(normalizedCoins("2000000000000000000", bal("eth", null, "a", "0").asset)).toBe(2);
    // 100 USDT on eth (6 decimals)
    expect(normalizedCoins("100000000", bal("eth", "usdt", "a", "0").asset)).toBe(100);
    // 100 USDT on bnb (18 decimals)
    expect(normalizedCoins("100000000000000000000", bal("bnb", "usdt", "a", "0").asset)).toBe(100);
  });

  it("applies iOS price defaults: chain->0, token->1 when unquoted", () => {
    expect(priceOf(bal("btc", null, "a", "0").asset, {})).toBe(0);
    expect(priceOf(bal("eth", "usdt", "a", "0").asset, {})).toBe(1);
  });

  it("computes usd value", () => {
    expect(usdValue(bal("btc", null, "a", "150000000"), RATES)).toBe(1.5 * 60000);
  });
});

describe("format", () => {
  it("formats usd as whole-dollar with $ prefix", () => {
    expect(usd(42500.4)).toBe("$ 42,500");
    expect(usd(0)).toBe("$ 0");
  });
  it("formats coins to 3 decimals", () => {
    expect(coins(1.23456)).toBe("1.235");
  });
  it("shortens addresses", () => {
    expect(shortAddress("0xA96783fF57be417D98F8D6d22343D9CcCC3c4f16")).toBe("0xA967…4f16");
    expect(shortAddress("short")).toBe("short");
  });
});

describe("grouping — byChain", () => {
  const balances = [
    bal("btc", null, "btc1", "150000000"), // 1.5 BTC = $90,000
    bal("eth", null, "eth1", "2000000000000000000"), // 2 ETH = $6,000
    bal("eth", "usdt", "eth1", "100000000"), // 100 USDT = $100
  ];
  it("groups by chain, sums native + tokens, sorts desc", () => {
    const s = byChain(balances, RATES);
    expect(s.map((x) => x.name)).toEqual(["Bitcoin", "Eth"]);
    const btc = s[0];
    expect(btc.thisUsd).toBe(90000);
    expect(btc.totalUsd).toBe(90000);
    const eth = s[1];
    expect(eth.thisUsd).toBe(6000);
    expect(eth.totalUsd).toBe(6100);
    expect(eth.rows).toHaveLength(1);
    expect(eth.rows[0].name).toBe("USDT");
    expect(eth.rows[0].thisUsd).toBe(100);
    expect(eth.rows[0].totalUsd).toBe(6100); // bar denominator = chain total
  });
});

describe("grouping — byToken", () => {
  const balances = [
    bal("eth", null, "eth1", "1000000000000000000"), // 1 ETH = $3000
    bal("eth", "usdt", "eth1", "50000000"), // 50 USDT
    bal("bnb", "usdt", "bnb1", "50000000000000000000"), // 50 USDT
  ];
  it("emits native chain sections + token sections with per-chain rows", () => {
    const s = byToken(balances, RATES);
    const eth = s.find((x) => x.icon === "eth");
    const usdt = s.find((x) => x.icon === "usdt");
    expect(eth?.thisUsd).toBe(3000);
    expect(usdt?.totalUsd).toBe(100); // 50 + 50
    expect(usdt?.rows).toHaveLength(2);
  });
  it("skips a token section when its price is unquoted", () => {
    const s = byToken([bal("eth", "busd", "e", "1000000000000000000")], {
      ethereum: 3000,
    });
    expect(s.find((x) => x.icon === "busd")).toBeUndefined();
  });
});

describe("grouping — byTag", () => {
  const balances = [
    bal("btc", null, "b1", "100000000", "Trezor"), // 1 BTC = $60k
    bal("eth", null, "e1", "1000000000000000000", "trezor"), // 1 ETH = $3k, same tag (case-insensitive)
    bal("ton", null, "t1", "1000000000", null), // untitled
  ];
  it("groups case-insensitively by tag and lists asset kinds", () => {
    const s = byTag(balances, RATES);
    const trezor = s.find((x) => x.name === "Trezor");
    expect(trezor?.totalUsd).toBe(63000);
    expect(trezor?.rows).toHaveLength(2); // BTC row + ETH row
    const untitled = s.find((x) => x.name === "Untitled");
    expect(untitled?.totalUsd).toBe(5); // 1 GRAM * $5
  });
});

describe("grandTotal", () => {
  it("sums all quoted usd values", () => {
    const balances = [
      bal("btc", null, "b", "100000000"), // $60k
      bal("eth", null, "e", "1000000000000000000"), // $3k
    ];
    expect(grandTotal(balances, RATES)).toBe(63000);
  });
});

// ---- securities ----

const SP500 = "IE00B5BMR087";
const BUND = "DE0001102580";

const hold = (isin: string, qty: number, title: string | null, id = isin + title): Holding => ({
  id,
  isin,
  qty,
  title,
  meta:
    isin === BUND
      ? { name: "Bund 2032", kind: "bond", currency: "EUR" }
      : { name: "S&P 500 ETF", kind: "etf", currency: "EUR" },
});

// EUR at 0.8 per USD keeps the math round: 1 EUR = $1.25.
const SEC = (holdings: Holding[]): SecuritiesData => ({
  holdings,
  quotes: {
    [SP500]: { price: 800, currency: "EUR", percent: false, venue: "Tradegate" },
    [BUND]: { price: 80, currency: "EUR", percent: true, venue: "Tradegate" },
  },
  fx: { USD: 1, EUR: 0.8, GBP: 0.75 },
});

describe("isin", () => {
  it("accepts real ISINs and rejects a wrong check digit", () => {
    for (const i of [SP500, BUND, "US0378331005", "DE0007164600", "IE00B4L5Y983"]) {
      expect(isValidIsin(i)).toBe(true);
    }
    expect(isValidIsin("IE00B5BMR088")).toBe(false);
    expect(isValidIsin("IE00B5BMR08")).toBe(false);
  });

  it("normalizes spacing and case", () => {
    expect(normalizeIsin(" ie00 b5bm r087 ")).toBe(SP500);
  });

  it("parses typed amounts with either decimal separator", () => {
    expect(parseAmount("10,5")).toBe(10.5);
    expect(parseAmount("10 000")).toBe(10000);
    expect(parseAmount("")).toBeNaN();
    expect(parseAmount("abc")).toBeNaN();
  });
});

describe("securities valuation", () => {
  it("converts through fx, including minor units like pence", () => {
    expect(toUsd(100, "USD", {})).toBe(100);
    expect(toUsd(80, "EUR", { EUR: 0.8 })).toBe(100);
    expect(toUsd(7500, "GBX", { GBP: 0.75 })).toBe(100);
    expect(toUsd(80, "CHF", { EUR: 0.8 })).toBeNull(); // unknown, not zero
  });

  it("values pieces and percent-of-nominal bonds", () => {
    const data = SEC([]);
    expect(holdingUsd(hold(SP500, 10, null), data)).toBe(10000); // 10 * 800 EUR
    expect(holdingUsd(hold(BUND, 10000, null), data)).toBe(10000); // 10k nominal * 80 %
  });

  it("adds accrued interest to a bond's clean price", () => {
    const data = SEC([]);
    data.quotes[BUND] = { ...data.quotes[BUND], accrued: 2 };
    // 10k nominal * (80 % + 2 %) = 8,200 EUR = $10,250
    expect(holdingUsd(hold(BUND, 10000, null), data)).toBe(10250);
  });

  it("counts an unpriced holding as 0", () => {
    const data = { ...SEC([]), quotes: {} };
    expect(holdingUsd(hold(SP500, 10, null), data)).toBe(0);
  });
});

describe("grouping — securities", () => {
  const sec = SEC([hold(SP500, 10, "ibkr"), hold(SP500, 5, "bank"), hold(BUND, 10000, "bank")]);
  const balances = [bal("btc", null, "b1", "100000000", "IBKR")]; // 1 BTC = $60k

  it("byChain: one Securities section, one row per ISIN summed across tags", () => {
    const s = byChain(balances, RATES, sec);
    const secs = s.find((x) => x.name === "Securities");
    expect(secs?.totalUsd).toBe(25000); // 15 * $1000 + $10k
    expect(secs?.rows.map((r) => [r.name, r.coins, r.thisUsd])).toEqual([
      ["S&P 500 ETF", 15, 15000],
      ["Bund 2032", 10000, 10000],
    ]);
    expect(secs?.rows[0].addressSubtitle).toBe(SP500);
    expect(secs?.rows[0].addresses).toEqual([SP500]);
  });

  it("byToken: each security is its own section", () => {
    const s = byToken(balances, RATES, sec);
    expect(s.find((x) => x.name === "S&P 500 ETF")?.totalUsd).toBe(15000);
    expect(s.find((x) => x.name === "Bund 2032")?.totalUsd).toBe(10000);
  });

  it("byTag: holdings join the wallets under the same tag", () => {
    const s = byTag(balances, RATES, sec);
    const ibkr = s.find((x) => x.name === "Ibkr");
    expect(ibkr?.totalUsd).toBe(70000); // 1 BTC + 10 ETF
    expect(ibkr?.rows.map((r) => r.name)).toEqual(["BTC", "S&P 500 ETF"]);
    const bank = s.find((x) => x.name === "Bank");
    expect(bank?.totalUsd).toBe(15000); // 5 ETF + Bund
  });

  it("grandTotal includes securities", () => {
    expect(grandTotal(balances, RATES, sec)).toBe(85000);
  });
});
