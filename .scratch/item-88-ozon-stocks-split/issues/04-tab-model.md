# 04: The tab model — everything the tab shows, computed in one tested module

**What to build:** the tab's calculations — coverage rows, component rows and kit bottlenecks, visible rows, cluster shares, the «Фабрика» cell state incl. hidden manual orders, supply recommendations incl. the wide-window enrichment, the supply plan from the ticked items — move out of the screen into one pure module with one input (store data, cabinet, settings, wide-window picks, ticked items, today's date) and one typed output. The screen keeps only UI state and drawing. Money-critical: coder, then tester with 3–5 deliberate mutations. Spec: `../spec.md`, step 3.

**Blocked by:** 03.

**Status:** done (2026-09-28)

- [x] The screen computes no rows, recommendations, factory state or supply plan itself; it reads them from the model's output
- [x] The model's output is typed (no `any` in recommendations, rows or supply plan); today's date is an input, never read inside
- [x] Checks (≈15–25) through the model's input/output only: recommendations per cluster (pieces, boxes, limits), «Фабрика» cell incl. hidden manual orders, supply plan equals the ticked recommendations incl. wide-window clusters, cabinet filtering, component rows
- [x] 3–5 mutations in recommendations, factory signal and supply plan, all killed
- [x] Rendered HTML from ticket 01 identical for every cabinet and the dashboard; `OZONPERF` no worse

## Result (2026-09-28)

Commits `40be572` (model), `aa18163` (tests), `83d590d` + the final test commit (review follow-up).
`src/lib/ozonStocksTabModel.ts` — pure stage functions and `buildOzonStocksTabModel(input)`;
`src/components/useOzonStocksTabModel.ts` — the same stages, one memo each with the dependencies of
the memo it replaced, taking exactly the model's input; `OzonStocksTab.tsx` 2499 → 2077 lines, keeps
UI state, the settings-impact callback, formatting and drawing. «Фабрика» cell = typed state with a
`kind` per drawn branch (article: overdue, order, clusterDeficitWaiting, clusterDeficit, waiting,
bottleneck, noLeadTime, notNeeded; component: overdue, order, clusterDeficit, waiting, notNeeded).

Tests: 35 checks in `ozonStocksTabModel.test.ts` through the model's input/output — recommendations
(pieces, boxes, cluster ceiling, «Мой склад» limit, deficit, order, leftover), every cell kind incl.
hidden manual orders, supply plan = ticked recommendations incl. the wide window replacing a row's
clusters and figures (the owner's «отметил восемь, в окне оказалось четыре»), cabinet filtering,
visible rows, components, shares, off-Ozon factory orders, today's date as input; one full-object
hook ↔ model parity test on a rich input (wide, ticks, manual picks, kit, modal article). Mutations
9/9 killed over two rounds (one survivor in the hook's wide stage led to a richer parity fixture).
Ticket 01 snapshots byte-identical after every commit; `OZONPERF` line count unchanged.

**Facts found:** the cluster-share window is `max(trendWeeks, speedWeeks)`, so the wide window keeps
an article's cluster set and changes magnitudes; a cluster appears only in the wide result when the
narrow need was covered by its own stock or the narrow speed was zero. The remaining `any` casts in
the screen's JSX maps (rows, supplies, clusters) stay until ticket 05 splits the screen.
