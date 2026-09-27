# 02: Coverage library split by topic

**What to build:** the coverage library becomes several files by topic — speed and sales, trend, stock history, clusters, supply recommendation and coverage days, factory (open factory orders and factory signal), kit components, the top-level coverage build — while the old module stays the single re-export point, so no consumer changes an import. A mechanical move with no logic edits; the owner sees nothing. Coder only, no separate tester (no logic changes). Spec: `../spec.md`, step 1.

**Blocked by:** 01.

**Status:** done (2026-09-27)

- [x] No file of the coverage library is above ~600 lines; each file is one topic from `CONTEXT.md`
- [x] No consumer's import changed; the existing coverage tests (coverage, history, money invariants, tone, parity) pass without being edited
- [x] Moved code is byte-identical apart from imports/exports (diff shows only moves)
- [x] Rendered HTML from ticket 01 identical for every cabinet and the dashboard
- [x] `tsc` clean

## Result (2026-09-27)

Commits `cd69308` (the move) and the review follow-up. Files: `ozonSalesSpeed.ts` 517,
`ozonClusters.ts` 316, `ozonSupplyRecommendation.ts` 142, `ozonFactorySignal.ts` 165,
`ozonCoverageTypes.ts` 195, `ozonStockHistory.ts` 407, `ozonSalesTrend.ts` 295,
`ozonCoverage.ts` 750. Moved-lines multiset equal apart from imports, blank lines and one header
line per file; `MSK_OFFSET_MS`/`WEEK_MS` newly exported from `ozonSalesSpeed.ts` (not re-exported);
the old module re-exports exactly its 62 former names. tsc clean; 35 coverage-related test files
green (1860 + 1 expected fail); ticket 01 snapshots byte-identical.

**Known deviations (review):**
- `ozonCoverage.ts` stays at 750 lines and holds two topics (the coverage build and kit
  components): `ozonCoverage.test.ts` (~line 1445) and `ozonSpeedCurrentWeek.test.ts` (~line 86)
  match the TEXT of this file inside `buildComponentCoverage` and `buildOzonCoverage`, and the
  tests had to pass unedited. Kit components move out once those guards read the new file.
- `ozonClusterShare.test.ts` (~line 296, «no trace of item 72») reads only `ozonCoverage.ts`,
  so after the split it no longer covers the cluster code. Strengthen it in ticket 03.
- Left for a later touch (judgement calls): `OzonCoverageSettings` lives in `ozonClusters.ts`
  though six files import it; `daysBetweenIso` lives in `ozonFactorySignal.ts` though
  `ozonStockHistory.ts` uses it; the Russian header «Часть 2» in `ozonClusters.ts` still lists
  recommendations and the factory; Code.gs comments (8878, 9104) point at `ozonCoverage.ts`,
  which still re-exports `factoryOnOrderByArticle` (Code.gs is not touched in item 88).
