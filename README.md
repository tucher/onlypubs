# WalletWatch — Web

A standalone, backend-less rebuild of the WalletWatch iOS app. Watches public crypto
addresses across BTC, ETH, BNB, TRX, TON (+ USDT/USDC/BUSD), shows per-wallet and total
balances in USD, and stores the wallet list as JSON in the browser's `localStorage`.

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
- `src/compute/` — normalization, USD math, the three grouping modes (byChain/byToken/
  byTag), formatting. Pure functions, unit-tested.
- `src/store/walletStore.ts` — Zustand store mirroring the iOS `ChainsMan` (add/remove/
  edit/check/import/export, 10s refresh throttle, per-chain loading/failed).
- `src/persistence/` — localStorage; import/export uses the **identical** JSON schema to
  iOS (`[{ chain, token, adr, title }]`), so files move between the two unchanged.
- `src/ui/` — React components: list, proportional bars, grouping picker, add/manage
  dialogs (native `<dialog>`, bottom-sheet on mobile), overflow menus, toast.

## Reused iOS assets

Coin logos (`public/icons/*.png`), the cosmonaut empty-state image (`public/cosmo.png`),
and the app icon (`public/app-icon.png`) are copied from the iOS asset catalog. Coin icons
fall back to a colored letter badge if a logo is missing. The Telegram / Terms / Privacy
links (Manage sheet) point to the same URLs as the app. A PWA manifest
(`public/manifest.webmanifest`) makes it installable.

## Notes

Intentionally **online-only**: balances require live network calls, so there is no service
worker / offline mode — it would only surface stale numbers while adding cache-invalidation
complexity. The app is still installable via the PWA manifest.
