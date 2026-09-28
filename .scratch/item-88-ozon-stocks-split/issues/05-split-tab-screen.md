# 05: The tab screen split into parts named after what the owner sees

**What to build:** the «Остатки Озон» screen becomes parts — header and filters, coverage table, coverage row, components table, notices and modals wiring — that receive the tab model's output and draw it; none of them computes. The owner sees nothing different. Coder; checks are the rendered comparison plus existing tests. Spec: `../spec.md`, step 4.

**Blocked by:** 04.

**Status:** done (2026-09-28)

- [x] No part above ~600 lines; each part is named after what the owner sees on screen
- [x] Parts take the model's output as props; none imports the coverage library's calculations
- [x] Rendered HTML from ticket 01 identical for every cabinet and the dashboard
- [x] `tsc` clean, existing tests green

## Result (2026-09-28)

`OzonStocksTab.tsx` 2077 → 574 lines: store reads, UI state, handlers, the model hook, and the
composition of the parts. Parts (flat in `src/components/`): `OzonStocksHeader` (128),
`OzonStocksNotices` (67 — sync warning, cabinets, summary cards), `OzonRecommendationsPanel` (273),
`OzonCoverageTable` (341 — filters, manual bar, head), `OzonCoverageRow` (519 — article row),
`OzonCoverageClusterRow` (198 — cluster + warehouse rows), `OzonComponentsTable` (259 — off-Ozon
factory orders, kit components, cluster shares), `OzonStocksModals` (185); shared formatting in
`ozonStocksFormat.tsx` (86). No `React.memo`, no new memo layers. Every `any` in the screen is gone
(JSX maps, `clustersRaw`, `kits.find`, `TREND_REASON_LONG`).

Source-text tests: 15 test files now read the whole screen through
`src/lib/ozonStocksScreen.fixture.ts` (`readOzonStocksScreen()`, explicit file list); assertions
unchanged. Guard `ozonStocksScreen.test.ts`: the list equals the `.tsx` parts reachable from
`OzonStocksTab.tsx` through `./` imports (stand-alone modals excluded by name); removing a nested
part from the list fails it.

Checks: the six ticket-01 snapshots byte-identical (`snapwt.sh`: temp index → tree hash →
`snapshot.sh`); `OZONPERF` 35 lines before and after, timings within run-to-run noise; `tsc`
clean; full vitest 2470 passed + 1 expected fail.

**Left as is (verbatim display code of the old screen, moving it would change the ticket-04
model):** `OzonCoverageRow` builds the manual-mode cluster list itself
(`manualClusterList(..., emptyManualCluster)`; the model's `manualInfos` keeps only ids/names);
row parts call `coverageTone` for the colour class; `remainingForArticle`, the direct/cabinet
tick guards, `resolveSupplyCabinet` and the «Итого резерв склада» sum stay inline in their parts.
Review judgement calls not taken: prop groups (manual supply, factory) travel Tab → Table → Row →
ClusterRow — bundling them fights the literal-expression source tests; `isAdmin` prop of the
panel is always true (pre-existing check).
