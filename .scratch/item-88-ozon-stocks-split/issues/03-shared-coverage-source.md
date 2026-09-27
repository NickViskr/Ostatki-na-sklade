# 03: One shared coverage source for the dashboard, the tab, the wide window and the settings impact

**What to build:** one pure function assembles the coverage input — availability incl. kit components, supply reserve, open factory orders, cabinet filtering of stocks, sales and stock history — from store data plus a cabinet choice plus settings, and runs the coverage build. The dashboard, the tab, the tab's wide window and the settings modal's «было → станет» all use it, so a new input reaches all four at once. Each screen still computes on its own (no shared cached result, Q3 а). The dashboard passes «all cabinets» and keeps not waiting for the cluster reference, now as a parameter (Q4 а). The two code comments that call open factory orders alone «ТРУБА» are corrected (Q9). Coder, then tester. Spec: `../spec.md`, step 2.

**Blocked by:** 01.

**Status:** done (2026-09-27)

- [x] The four coverage computations call the one function; no screen assembles coverage inputs itself
- [x] Checks (≈4–6): dashboard and tab with «all» give the same result; a cabinet choice filters stocks, sales, stock history and the supply reserve together; the cluster-reference wait is a parameter; the wide window only changes the speed weeks
- [x] Rendered HTML from ticket 01 identical for every cabinet and the dashboard
- [x] `OZONPERF` timings no worse than the ticket-01 record
- [x] «ТРУБА» in code means the pipeline only

**Carried over from ticket 02:** `src/lib/ozonClusterShare.test.ts` (~line 296, «the library
exports no trace of item 72») reads only `src/lib/ozonCoverage.ts`; make it read every coverage
library file (the split left it nearly empty). Also consider moving kit components out of
`ozonCoverage.ts` once the text guards of `ozonCoverage.test.ts` (~1445) and
`ozonSpeedCurrentWeek.test.ts` (~86) point at the right files.

## Result (2026-09-27)

Commits `3ebf6f1` and the review follow-up. `src/lib/ozonCoverageSource.ts`:
`buildCoverageSource(data, { cabinet, todayIso, waitForClusterRefs, clusterRefsLoaded? })` assembles
cabinet-filtered stocks, sales, stock history and supply reserve, open factory orders (never
filtered by cabinet) and availability with kit components; `computeCoverage(source, settings)`
runs the build. The dashboard (cabinet 'all', `waitForClusterRefs: false`), the tab, its wide
window and the settings impact all go through it. 11 behaviour checks in
`ozonCoverageSource.test.ts`, 5/5 mutations caught; old wiring guards rewritten for the new one;
the item-72 guard now reads every `src/lib/ozon*.ts` (carried over from ticket 02, proven to bite).
Ticket 01 snapshots byte-identical; coverage runs the same number of times (3 per mount, 1 per
cabinet switch, 1 wide).

**Known, accepted (review):** the small memos that used to depend on one input each (supply
reserve, open factory orders, cabinet filters and what reads them: totals, «Обновлено», hidden
manual orders, the dashboard's reserve alerts) now refresh whenever any source input changes.
Measured on the live export: the whole `buildCoverageSource` takes 0.3–0.4 ms, and every such
change already triggers the ~20 ms coverage run, so there is no visible cost. Side effect: the
date used for open factory orders is re-read on those refreshes instead of only when factory orders
change — it matters only across midnight and matches the coverage build, which reads the clock on
every run anyway. Not done (optional): moving kit components out of `ozonCoverage.ts` (the text
guards now allow it); the `todayIso` one-liner stays duplicated in both screens as before.
`buildOzonCoverage`/`buildPendingSupplies` are still not handed a `now` and read the clock
themselves, as before this item.
