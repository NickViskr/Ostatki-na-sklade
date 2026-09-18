# Architecture

Rewritten 2026-09-18 (the previous version dated from the first weeks and still mentioned a
Gemini-only proxy and no Ozon integration). Current state and open items are in the
«Очередь дальше» block at the end of `docs/OZON_PLAN.md`; rules in `CLAUDE.md`.

## Three parts, one repository

| Part | Where it runs | What it does |
|---|---|---|
| **Frontend** `src/` — React 19, TypeScript, Vite 6, Zustand 5, Tailwind 4, lucide icons | Browser; static files served by the proxy | The whole UI: warehouse stock, receipts/expenses, history, SKU base, kits, Ozon stocks and recommendations, Ozon supply wizard, supplies tab, factory orders, cost export for KAN, users and settings |
| **Proxy** `server.ts` — Node 22, Express, `tsx` | Cloud Run service `sklad`, `europe-central2`, one container built by the `Dockerfile` (`npm ci` → `vite build` → `npm start`) | Serves `dist/`; forwards app calls to Apps Script with caching; holds the Ozon Seller API keys and does every Ozon call; parses supplier invoices with Gemini (`/api/parse-invoice`) |
| **Backend** `Code.gs` — Google Apps Script bound to the spreadsheet «БД Склад» | Google; web app deployment `/exec` pinned to a version, plus time triggers | All accounting writes and reads, sessions and users, the nightly jobs. The spreadsheet is the database |

The browser talks only to the proxy. The proxy talks to Apps Script (`POST /api/gas` → `/exec`)
and to Ozon. Apps Script calls the proxy back for the scheduled Ozon sync (`PROXY_URL` in
`Code.gs`).

```
browser ──/api/gas──▶ server.ts ──▶ Code.gs /exec ──▶ «БД Склад» (sheets)
   │                     │  ▲
   │                     ▼  │ scheduled sync: Code.gs → proxy → Ozon → sheets
   └──/api/ozon/*──▶ server.ts ──▶ Ozon Seller API
```

## Frontend layout

- `src/App.tsx` — login gate and tab switch; a tab is unmounted when another is active, so
  state that must survive a switch lives in `src/store/useUIStore.ts` (localStorage).
- `src/store/useWarehouseStore.ts` — the data store: stock, transactions, SKUs, kits, Ozon
  stocks/sales/clusters, supply requests, factory orders, settings; every server action goes
  through it. `useSettingsStore.ts` — local UI preferences.
- `src/components/*` — one file per tab or modal. The big ones: `Dashboard.tsx` (tab «Склад»
  with alerts), `OzonStocksTab.tsx` (coverage table and recommendations), `OzonSupplyModal.tsx`
  (supply wizard), `OzonSuppliesTab.tsx` (created requests, documents), `HistoryTab.tsx`,
  `ManualTab.tsx`/`UploadTab.tsx` (receipts and expenses), `ShipmentCostTab.tsx` (write-off of
  Ozon requests with extra costs).
- `src/lib/*` — pure logic with tests next to it (`*.test.ts`, vitest). Key modules:
  `ozonCoverage.ts` (speed, corrections, demand growth, trend, recommendations),
  `ozonPending.ts` (reserve of created requests), `ozonAlerts.ts`, `ozonCargo.ts` /
  `ozonComposition.ts` / `ozonSupplyDocs.ts` (cargoes, composition files, documents),
  `ozonDirectDraft.ts` / `ozonDirectSupply.ts` (direct supplies), `ozonSupplyLines.ts` /
  `ozonManualSupply.ts` (wizard lines), `ozonJson.ts` (int64-safe parsing of Ozon answers),
  `kanCostExport.ts` (cost file for KAN), `utils.ts` (destination parsing, formatting).
  Server-side code imports from here too (`server.ts` uses `ozonComposition`, `ozonSupplyDocs`,
  `ozonJson`), so the logic is shared and testable.

## Proxy (`server.ts`)

- `/api/gas` — the one door to Apps Script. Actions are classified in three lists
  (`getCacheTtlMs`, `CACHE_INVALIDATION`, `READ_ONLY_ACTIONS`): reads are cached per action,
  writes invalidate, unknown actions count as writes. Retries only for reads.
- `/api/ozon/*` — stocks, sales, clusters, seller info, drop-off search, draft / create of a
  supply request, cargo state, and `supply/docs` (rebuilds cargoes, labels, composition files
  and the Drive folder for an existing order by its id, then records the result in the journal).
  Ozon answers are read as text and parsed by `parseOzonJson` because ids are int64.
- `/api/parse-invoice` — Gemini reads a supplier invoice photo into positions.
- `/api/version` — the build label shown at the bottom of the sidebar (МСК time).
- Logs: `GASDIAG action= ms= len=` per Apps Script call, `SUPPLYDOCS …` per documents build.

## Backend (`Code.gs`) and the spreadsheet

`doPost` dispatches ~70 actions by name; every write takes a document lock and is idempotent by
`opId`. Sessions and users are sheets; passwords of new users are hashed.

Sheets of «БД Склад»:

| Sheet | Holds |
|---|---|
| `SKU` | Article base: pcs per box, min stock, barcodes, Ozon barcode, lead time |
| `Остатки` | Stock per article with the moving average cost and capitalisation |
| `История` | Every operation (receipt, expense, write-off, correction); «Объект» is free text with appended tails |
| `Удаленное` | Deleted operations (restorable) |
| `Комплекты` | Kit specifications (`legacy` = kit is its own stock, `virtual` = components only) |
| `Услуги`, `Тарифы услуг` | Extra works and their rates |
| `Пользователи`, `Сессии` | Auth (the admin row still stores a plaintext password — known tail) |
| `Остатки Ozon`, `Кластеры Ozon` | Mirror of Ozon FBO stocks per warehouse/cluster |
| `Продажи Ozon`, `Продажи Ozon Архив` | Weekly sales per article and cluster; the fresh zone is 13 weeks, older weeks move to the archive on every sync |
| `Внешние отгрузки` | One row per Ozon supply (cluster) of a request: status, composition, write-off flag — the reserve is built from these rows |
| `Заявки Ozon` | Journal of requests created by the app, with the «Документы» record |
| `Себестоимость Озон` | Cost journal for KAN: one row per shipment, last row = current cost |
| `Заказы на фабрике` | Factory orders (the «pipeline» of goods on order) |
| `Настройки Ozon` | Coverage settings (key/value with defaults filled by `Code.gs`) |
| `Капитализация склада` | Daily stock value; one number is also pushed to the owner's payment-calendar spreadsheet (id in Script Properties) |

Time triggers (Apps Script, HEAD version): Ozon sync at 05:00 and 17:00 МСК (writes to the DB named
by Script Property `ozon_autoSyncTarget`, normally `prod`), stock summary at 02:00, monthly
archive at 03:00, daily analytics at 04:00, session clean-up at 03:00.

## Two databases

Production «БД Склад» and a test copy. The admin's dev-mode toggle switches only the browser to
the test DB; the scheduled sync keeps writing to production. Script Properties hold every id and
token (Ozon keys are on the proxy as environment variables) — nothing secret is in the repository,
which is public.

## Build, test, deploy

`npx vitest run` (frontend logic), `npm run test:gas` (Apps Script stand in
`tests/apps-script/`, fakes the spreadsheet), `npx tsc --noEmit`, `npx vite build`. Deployment of
the proxy: `gcloud run deploy` from a clean `git archive` export; of `Code.gs`: `clasp push` +
`clasp deploy -i` by the owner. Details and the exact commands: `CLAUDE.md`.
