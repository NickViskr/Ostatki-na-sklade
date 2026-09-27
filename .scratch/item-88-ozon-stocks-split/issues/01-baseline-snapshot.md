# 01: Baseline snapshot — both screens rendered from the live export

**What to build:** a before-picture the whole item is checked against. From a fresh xlsx export of «БД Склад» (Drive connector), render the «Остатки Озон» tab (cabinet «all» and each cabinet separately) and the dashboard coverage block to HTML with the committed code, and record the `OZONPERF` timings on the same export. Everything lives in the scratchpad, nothing is committed except the paperwork below. Done by the orchestrator, no agents. Spec: `../spec.md` (Testing Decisions, seam 1).

**Blocked by:** None (can start immediately).

**Status:** done (2026-09-27)

- [x] One command renders the tab for «all» and every cabinet plus the dashboard coverage block to HTML files from the export, using a `git archive HEAD` copy of the code
- [x] Two runs of that command on the same export give identical HTML (the comparison itself is deterministic: fixed today's date, no timestamps)
- [x] The rendered HTML is non-trivial: it contains the coverage rows, recommendations and «Фабрика» cells seen on the live screen for a few sampled articles
- [x] `OZONPERF` timings of coverage, wide coverage and rows recorded for the export
- [x] The two tails (dashboard computes before the cluster reference loads; «Труба изменилась по артикулам» means open factory orders) added to the plan's tails list
- [x] `CONTEXT.md` and the spec/tickets committed

## Result (2026-09-27)

**Baseline code:** `src` of commit `dade6fe` (unchanged by this ticket's commit). Any later
session rebuilds the before-picture by rendering this commit on the same export — the HTML itself
is not kept.

**Export:** «БД Склад» downloaded 2026-09-27 ~16:45 UTC as xlsx through the Drive connector
(`download_file_content`, export type xlsx; the text form truncates sheets). Replayed with
settings speedWeeks 2, trendWeeks 8, target 20, minStock 10, factoryOrderDays 30,
maxClusterDays 60, returns 95 %, deliveryToOzonDays 7. Data: Ozon stock rows 274 (MaxiStore 82,
Mercurius 192), sales rows 2180, stock-history rows 1250, clusters 27, factory orders 15,
external shipments 184, supply requests 38, SKU 20, kits 2.

**Harness (scratchpad, not committed; rebuild from this recipe):**

1. `dump.cjs` — loads every sheet of the xlsx except «Сессии» and «Пользователи» into the Apps
   Script stand (`tests/apps-script/harness.cjs`: `setRegistrySheet`, `setSkuSheet`, the history
   sheet via `getHistorySheet().__setData`), date cells as the stand's `FakeDate` at Moscow wall
   clock, now = 2026-09-27 12:00 МСК, the real sheet-based `getOzonSettings` restored over the
   stand's stub; calls the Code.gs readers behind `getInitialData`, `getServiceRates`,
   `getOzonInitialData`, `getExternalShipments`, `getOzonSupplyRequests`, `getLastPurchasePrices`
   and writes their answers to `live.json`.
2. `render.mts` — jsdom (26.1.0, installed in the scratchpad only), `Date` fixed at
   2026-09-27 12:00 +05:00, `TZ=Asia/Yekaterinburg`, every toggleable column visible via
   localStorage, `fetch('/api/gas')` answered from `live.json`; fills the store through its real
   fetch functions, mounts the screen and drives it only through the DOM: cabinet select
   `#ozon-cabinet-filter`, the «Рекомендации» toggle `#ozon-recommendations > button`, every
   `tr[id^="ozon-art-row-"]` then every `tr[id^="ozon-cls-row-"]` clicked in one `act` per level;
   dashboard: `#ozon-alerts-block` expanded. Writes `#root` innerHTML.
3. `snapshot.sh <rev> <outdir>` — `git archive <rev> src tsconfig.json package.json` into a
   copy with the repo's `node_modules` linked, then six scenarios with `tsx`: `tab:all`,
   `tab:MaxiStore`, `tab:Mercurius`, `tab-wide` (every «Распределить весь остаток» pressed),
   `tab-ticked` (every enabled recommendation box ticked top to bottom — the supply plan line
   «Выбрано: 52 строк · 35 кор (230 шт) · кластеров: 18»), `dashboard`. ~7 s per scenario.

**Determinism:** two runs of `snapshot.sh HEAD` on the export — `diff -r` empty. Sizes and
sha256 (first 16 hex) on this export: `tab-all` 1 124 072 B `498cd2f5c9096e57`,
`tab-MaxiStore` 334 401 B `d4998b6e3a131ef1`, `tab-Mercurius` 820 083 B `9846ac782c24933f`,
`tab-wide` 1 127 609 B `f8cf6d31628e86ed`, `tab-ticked` 1 126 255 B `a38a6d0aef14fd0f`,
`dashboard` 74 450 B `3a859e5722b46361`.

**Non-trivial:** 13 article rows and 272 cluster rows («all»; MaxiStore 3/69, Mercurius
10/203); «Рекомендации» — 13 supplies, 6 factory orders; the dashboard alert block has 18
alerts incl. «Пора заказать на фабрике: Этажерка_25_белая … заказать 60 шт (15 кор.)» and
«Спрос вырос: Органайзер_2_пол_PureWhite +62 %». Cross-check with the independent live replay
of the audit (2026-09-26): «Миска_двойная» weeks 23, 13, 6, 1 → 28, 76, raw trend 2,09 clamped
to 1,50 — the same figures appear in the rendered row.

**`OZONPERF` on this export (jsdom, warm = 2nd/3rd computation of the mount):**
coverage 19–24 ms warm (44–46 ms cold, first computation), coverageRows 19–23 ms warm
(26–32 ms cold), rows 13; per cabinet after the switch: MaxiStore coverage 8 ms / rows 9 ms
(rows 3), Mercurius 13 ms / 11 ms (rows 10); wideCoverage 20 ms (weeks 8). The dashboard has
no `OZONPERF` line. Compare after each step on the same export in the same harness; the
numbers vary by a few ms run to run.

**Tails** recorded in `docs/OZON_PLAN.md` «Известные хвосты вне плана»: the dashboard computes
before the cluster reference loads; «Труба изменилась по артикулам» means open factory orders.
