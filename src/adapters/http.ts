// Tiny fetch helpers. All network goes through here so tests (unit: stubbed
// global fetch; E2E: Playwright page.route) intercept a single choke point.
// NOTE: no API keys anywhere — only keyless, CORS-enabled public endpoints.

export interface HttpInit {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export async function httpJson<T = any>(url: string, init: HttpInit = {}): Promise<T> {
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: init.headers,
    body: init.body,
    signal: init.signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return (await res.json()) as T;
}

// Try each base URL in order; return the first success, throw if all fail.
// This is the per-chain endpoint resilience from the plan (fail over on 429/500).
export async function withFallback<T>(
  bases: string[],
  fn: (base: string) => Promise<T>,
): Promise<T> {
  let lastErr: unknown;
  for (const base of bases) {
    try {
      return await fn(base);
    } catch (e) {
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
