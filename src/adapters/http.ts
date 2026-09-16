// Tiny fetch helpers. All network goes through here so tests (unit: stubbed
// global fetch; E2E: Playwright page.route) intercept a single choke point.
// NOTE: no API keys anywhere — only keyless, CORS-enabled public endpoints.

export interface HttpInit {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

// Carries the status so callers can tell "rate limited" (429) apart from a
// generic failure — they need very different handling.
export class HttpError extends Error {
  readonly status: number;
  readonly url: string;
  constructor(status: number, url: string) {
    super(`HTTP ${status} for ${url}`);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
  }
}

export async function httpJson<T = any>(url: string, init: HttpInit = {}): Promise<T> {
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: init.headers,
    body: init.body,
    signal: init.signal,
  });
  if (!res.ok) throw new HttpError(res.status, url);
  return (await res.json()) as T;
}

// ---- rate-limit cooldown ----
//
// Some keyless providers do not just refuse one request: TronScan answers a burst
// with `allowed_rps(3) ... suspended for 34 s`, so every later call fails too.
// Hammering a suspended host wastes the refresh and can extend the penalty, so we
// park it and let the next provider take over until the window passes.
const RATE_LIMIT_COOLDOWN_MS = 40_000;
const cooldownUntil = new Map<string, number>();

export function markRateLimited(base: string, ms: number = RATE_LIMIT_COOLDOWN_MS): void {
  cooldownUntil.set(base, Date.now() + ms);
}

export function isCoolingDown(base: string): boolean {
  const until = cooldownUntil.get(base);
  if (until === undefined) return false;
  if (Date.now() >= until) {
    cooldownUntil.delete(base);
    return false;
  }
  return true;
}

// test seam: cooldowns are module state, so tests reset them between cases
export function resetCooldowns(): void {
  cooldownUntil.clear();
}

function noteIfRateLimited(base: string, e: unknown): void {
  if (e instanceof HttpError && e.status === 429) markRateLimited(base);
}

// Try each base URL in order; return the first success, throw if all fail.
// Bases in a rate-limit cooldown are skipped — unless every base is parked, in
// which case we still try them rather than failing without attempting anything.
export async function withFallback<T>(
  bases: string[],
  fn: (base: string) => Promise<T>,
): Promise<T> {
  let lastErr: unknown;
  const parked: string[] = [];

  for (const base of bases) {
    if (isCoolingDown(base)) {
      parked.push(base);
      continue;
    }
    try {
      return await fn(base);
    } catch (e) {
      noteIfRateLimited(base, e);
      lastErr = e;
    }
  }

  for (const base of parked) {
    try {
      return await fn(base);
    } catch (e) {
      noteIfRateLimited(base, e);
      lastErr = e;
    }
  }

  throw lastErr ?? new Error("all endpoints failed");
}

// Run fn over items; keep the ones that succeed. One bad address/token must not
// sink the whole chain — but if EVERY item fails, throw so the chain is marked failed.
export async function settleAll<I, O>(
  items: I[],
  fn: (item: I) => Promise<O>,
): Promise<O[]> {
  const settled = await Promise.allSettled(items.map(fn));
  const ok: O[] = [];
  for (const r of settled) if (r.status === "fulfilled") ok.push(r.value);
  if (ok.length === 0 && items.length > 0) {
    const firstRejected = settled.find((r) => r.status === "rejected");
    throw firstRejected && firstRejected.status === "rejected"
      ? firstRejected.reason
      : new Error("all items failed");
  }
  return ok;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Same contract as settleAll, but strictly sequential with a gap between items.
// Firing one request per address in parallel is exactly what trips a per-second
// cap, so for those providers pacing is what keeps the chain working at all.
export async function settleSerial<I, O>(
  items: I[],
  fn: (item: I) => Promise<O>,
  gapMs = 0,
): Promise<O[]> {
  const ok: O[] = [];
  let firstErr: unknown;
  for (let i = 0; i < items.length; i++) {
    if (i > 0 && gapMs > 0) await sleep(gapMs);
    try {
      ok.push(await fn(items[i]));
    } catch (e) {
      if (firstErr === undefined) firstErr = e;
    }
  }
  if (ok.length === 0 && items.length > 0) {
    throw firstErr ?? new Error("all items failed");
  }
  return ok;
}
