// Number formatting ported from iOS.
// `currency_formatted`: "$ " + whole-dollar, grouped, banker's rounding, 0 fraction digits.
// coins: 3 fraction digits.

const LOCALE = undefined; // use the runtime's autoupdating locale (matches format_locale)

const usdFmt = new Intl.NumberFormat(LOCALE, {
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
  // @ts-expect-error roundingMode is widely supported at runtime; types may lag
  roundingMode: "halfEven",
});

const coinsFmt = new Intl.NumberFormat(LOCALE, {
  maximumFractionDigits: 3,
});

export function usd(n: number): string {
  const value = Number.isFinite(n) ? n : 0;
  return "$ " + usdFmt.format(value);
}

export function coins(n: number): string {
  const value = Number.isFinite(n) ? n : 0;
  return coinsFmt.format(value);
}

// iOS `shortOf()` — head…tail of an address for compact display.
export function shortAddress(adr: string, head = 6, tail = 4): string {
  if (adr.length <= head + tail + 1) return adr;
  return `${adr.slice(0, head)}…${adr.slice(-tail)}`;
}
