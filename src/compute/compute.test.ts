import { describe, it, expect } from "vitest";
import type { Balance } from "../domain/types";
import { normalizedCoins, priceOf, usdValue } from "./normalize";
import { usd, coins, shortAddress } from "./format";
import { byChain, byToken, byTag, grandTotal } from "./grouping";

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
    expect(untitled?.totalUsd).toBe(5); // 1 TON * $5
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
