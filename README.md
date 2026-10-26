# OnlyPubs — Web

A standalone, backend-less portfolio watcher (originally a rebuild of the OnlyPubs iOS app,
which is retired). Watches public crypto addresses across BTC, ETH, BNB, TRX, GRAM on TON
(+ USDT/USDC/BUSD) and securities entered by ISIN + quantity (stocks, ETFs, funds, bonds),
shows per-wallet and total balances in USD, and stores everything as JSON in the browser's
`localStorage`.

No server, no API keys — every balance/price source is a keyless, CORS-enabled public
endpoint called straight from the browser.

## Commands

```bash
npm install
npm run dev            # local dev server
npm run build          # typecheck + production build -> dist/
npm run preview        # serve the production build
npm test               # unit tests (Vitest)
npm run test:e2e       # end-to-end tests (Playwright, network fully mocked)
npm run test:e2e:update  # regenerate visual snapshot baselines
```

> **Rate-limit rule:** unit and E2E tests never hit a live endpoint — all network is
> mocked (`tests/e2e/fixtures.ts`). Do not add live calls to the test suites.

## Architecture

Data-driven **registry** + per-**family** adapters:

- `src/registry/` — `chains.ts`, `tokens.ts`: the single source of truth. Adding a
  stablecoin = one record; adding an EVM chain = one record; a new protocol = one adapter.
- `src/adapters/` — one adapter per *family* (`utxo`, `evm`, `tron`, `ton`) + `prices`.
  The store dispatches by `chain.family`; it never names a specific chain.
  `securities` + `fx` price holdings (see below).
- `src/compute/` — normalization, USD math, the three grouping modes (byChain/byToken/
  byTag), formatting. Pure functions, unit-tested.
- `src/store/walletStore.ts` — Zustand store mirroring the iOS `ChainsMan` (add/remove/
  edit/check/import/export, 10s refresh throttle, per-chain loading/failed).
- `src/persistence/` — localStorage; export is `{ wallets, securities }`. Import also
  reads older backups, which are a bare wallets array (`[{ chain, token, adr, title }]`).
- `src/ui/` — React components: list, proportional bars, grouping picker, add/manage
  dialogs (native `<dialog>`, bottom-sheet on mobile), overflow menus, toast.


## Securities

A holding is the inverse of a wallet: the user enters the quantity (or a bond's nominal),
and only the price is fetched.

- **Lookup, once per ISIN** (add dialog): Onvista (`api.onvista.de`) resolves name, kind
  and currency (for a bond: its nominal currency). Onvista answers non-browser clients
  (curl) with long-lasting 429s; browsers were served fine. Its limits are unknown, so calls
  are spaced out, and a 429 parks the host for 15 minutes.
- **Price, every refresh**: Tradegate (`tradegatebsx.com/refresh.php?isin=…`, EUR), with
  Onvista as the fallback for ISINs Tradegate does not trade (cached for 5 minutes).
- **FX**: Frankfurter (ECB reference rates), falling back to open.er-api.com.
- Bonds are valued at clean price + accrued interest, both in percent of the nominal and
  in the bond's own currency. Tradegate has no accrued interest, so it comes from Onvista
  (cached for 6 hours; the last known value is kept if Onvista is unavailable).
- ISINs are checksum-validated locally, so a typo never spends a lookup.

All of these are undocumented endpoints that serve the providers' own websites: no SLA,
and they may change without notice.

## Notes

Intentionally **online-only**: balances require live network calls, so there is no service
worker / offline mode — it would only surface stale numbers while adding cache-invalidation
complexity. The app is still installable via the PWA manifest.
