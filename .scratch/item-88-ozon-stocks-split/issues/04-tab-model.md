# 04: The tab model — everything the tab shows, computed in one tested module

**What to build:** the tab's calculations — coverage rows, component rows and kit bottlenecks, visible rows, cluster shares, the «Фабрика» cell state incl. hidden manual orders, supply recommendations incl. the wide-window enrichment, the supply plan from the ticked items — move out of the screen into one pure module with one input (store data, cabinet, settings, wide-window picks, ticked items, today's date) and one typed output. The screen keeps only UI state and drawing. Money-critical: coder, then tester with 3–5 deliberate mutations. Spec: `../spec.md`, step 3.

**Blocked by:** 03.

**Status:** ready-for-agent

- [ ] The screen computes no rows, recommendations, factory state or supply plan itself; it reads them from the model's output
- [ ] The model's output is typed (no `any` in recommendations, rows or supply plan); today's date is an input, never read inside
- [ ] Checks (≈15–25) through the model's input/output only: recommendations per cluster (pieces, boxes, limits), «Фабрика» cell incl. hidden manual orders, supply plan equals the ticked recommendations incl. wide-window clusters, cabinet filtering, component rows
- [ ] 3–5 mutations in recommendations, factory signal and supply plan, all killed
- [ ] Rendered HTML from ticket 01 identical for every cabinet and the dashboard; `OZONPERF` no worse
