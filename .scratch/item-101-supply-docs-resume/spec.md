# Item 101 — supply documents: resume what is missing, wait out Ozon's rate limit

Found 2026-10-28 (owner report, order with many clusters). Cause established from code only
(`server.ts`, `OzonSuppliesTab.tsx`); Cloud Run logs and live Ozon calls NOT yet inspected.

## Symptom
«Собрать документы» ends with, per cluster (Воронеж, Санкт-Петербург и СЗО, Тверь):
«этикетки грузомест не получены — Ozon API: превышен лимит запросов, повторите синхронизацию через минуту».
A second click takes very long and ends the same way.

## Root cause
1. `fetchOzonApi` (server.ts ~637): after HTTP 429 it retries 4 times with 1+2+3+4 s = 10 s of waiting,
   then throws. Ozon's window is longer; the global gap between calls is only 400 ms.
2. `collectSupplyDocs` (server.ts ~2106) has no memory: every run re-reads every cluster, recreates the
   cargoes of EVERY cluster (`delete_current_version: true`) and re-requests every label —
   ~5–6 Ozon calls per cluster, ~70 for 13 clusters, in one burst (141 s measured in item 74).
   A retry therefore repeats the full load instead of the 3 missing labels, hits the same limit,
   and each run changes the cargo ids of already-finished clusters (printed labels go stale).

## Decisions (orchestrator, 2026-10-28; owner may overrule)
- Resume = per cluster, read `/v1/cargoes/get` once for all supplies; if cargoes exist and match the
  layout built from Ozon's bundle (`compareCargoWithPlan`), skip `cargoes/create`, reuse Ozon's cargo ids,
  request only the label. Mismatch or none → recreate as today.
- 429 patience: waits 20/30/40 s (up to 4 retries) instead of 1–4 s; gap between Ozon calls 1 s.
- The confirmation text (cargo ids change) must say only mismatching clusters are recreated.
- Related, NOT in scope: item 100.5 R-048 (an incomplete composition is sent as a FULL cargo replacement).
  Ticket 02 must not weaken the existing guards and should note the overlap.

## Tickets (strictly in order, all touch server.ts)
01 — 429 patience (small, orchestrator does it itself)
02 — resume missing pieces (money-critical tier: stand + mutations 3–5)
03 — keep already collected files, finish the Drive folder, clearer message (maybe Code.gs)

## Live check (owner)
Press «Собрать документы»; if some clusters hit 429, press again: the second run must take seconds,
cargo ids of finished clusters must not change, `SUPPLYDOCS` line in Cloud Run must show the reuse.
