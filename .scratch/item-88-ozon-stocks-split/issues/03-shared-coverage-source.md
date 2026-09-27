# 03: One shared coverage source for the dashboard, the tab, the wide window and the settings impact

**What to build:** one pure function assembles the coverage input — availability incl. kit components, supply reserve, open factory orders, cabinet filtering of stocks, sales and stock history — from store data plus a cabinet choice plus settings, and runs the coverage build. The dashboard, the tab, the tab's wide window and the settings modal's «было → станет» all use it, so a new input reaches all four at once. Each screen still computes on its own (no shared cached result, Q3 а). The dashboard passes «all cabinets» and keeps not waiting for the cluster reference, now as a parameter (Q4 а). The two code comments that call open factory orders alone «ТРУБА» are corrected (Q9). Coder, then tester. Spec: `../spec.md`, step 2.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] The four coverage computations call the one function; no screen assembles coverage inputs itself
- [ ] Checks (≈4–6): dashboard and tab with «all» give the same result; a cabinet choice filters stocks, sales, stock history and the supply reserve together; the cluster-reference wait is a parameter; the wide window only changes the speed weeks
- [ ] Rendered HTML from ticket 01 identical for every cabinet and the dashboard
- [ ] `OZONPERF` timings no worse than the ticket-01 record
- [ ] «ТРУБА» in code means the pipeline only

**Carried over from ticket 02:** `src/lib/ozonClusterShare.test.ts` (~line 296, «the library
exports no trace of item 72») reads only `src/lib/ozonCoverage.ts`; make it read every coverage
library file (the split left it nearly empty). Also consider moving kit components out of
`ozonCoverage.ts` once the text guards of `ozonCoverage.test.ts` (~1445) and
`ozonSpeedCurrentWeek.test.ts` (~86) point at the right files.
