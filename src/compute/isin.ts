// ISIN (ISO 6166): 2-letter country, 9 alphanumerics, 1 check digit.
// Validated locally so a typo never spends a request on a rate-limited lookup.

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

// "ie00 b5bm r087" -> "IE00B5BMR087"
export function normalizeIsin(s: string): string {
  return s.replace(/\s+/g, "").toUpperCase();
}

// Letters expand to two digits (A=10 … Z=35), then the whole digit string must
// pass the Luhn check (the last digit is the check digit).
export function isValidIsin(isin: string): boolean {
  if (!ISIN_RE.test(isin)) return false;
  const digits = [...isin].map((ch) => parseInt(ch, 36).toString()).join("");
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}
