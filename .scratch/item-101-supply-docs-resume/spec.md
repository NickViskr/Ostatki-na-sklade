# Item 101 — supply documents: no stale labels, no double runs, resume only what is missing

Found 2026-10-28 (owner report). Revised the same day after re-checking code, Cloud Run log and the Drive folder.

## Evidence
- Cloud Run, order 137416710 (number 135475876-1, 13 supplies, 17 cargoes): three runs of `/api/ozon/supply/docs`
  at 10:22 (wizard), 10:29, 10:36 UTC took 198 s / 178 s / 189 s; `SUPPLYDOCS` saved=28/27/29, warnings=2/3/1, ok=false.
  Earlier orders since 30.09 (1–15 supplies): 27–160 s, warnings=0. Failing clusters differ per run → Ozon rate limit.
  Three `/api/ozon/check` polls (22–25 s, same cabinet) overlapped run 1. 429s leave no log line.
- Drive folder «Озон 135475876-1» after run 3: 13 composition xlsx + 12 cargo-label PDFs + 4 product-label PDFs = 29
  (matches saved=29); the run-3 Drive save took ~63 s (10:37:58–10:39:01). The missing run-3 label is Новосибирск;
  `2000072172420.pdf` dated 10:31:26 (run 2) is still there although run 3 recreated that supply's cargoes and wrote
  `Новосибирск.xlsx` with the new ids → a STALE label in the folder (inferred from file order and times). Owner told
  not to print it and to take Новосибирск labels from Ozon Seller by hand.
- Cloud Run service: timeout 300 s, maxScale 1, concurrency 1000. Browser waits 180 s (`DOCS_BUILD_TIMEOUT_SEC`).

## Root causes
1. `collectSupplyDocs` has no memory: every run recreates the cargoes of EVERY cluster (`delete_current_version: true`)
   and re-requests every label (~5–6 Ozon calls per cluster), so a retry repeats the whole load and hits the same limit.
2. `fetchOzonApi` waits only 1+2+3+4 = 10 s after a 429.
3. `replaceFileInFolder` replaces files by name only on success, so a failed label after a recreation leaves the
   previous run's label (old cargo ids) in the folder next to the new composition file.
4. No server-side guard per order: after the browser's 180 s timeout the button is enabled while the server still runs.

## Rejected from the first draft (and why)
- Longer 429 waits inside the shared `fetchOzonApi`: it serves drafts (item 65 needs a fast 429), polls and syncs, and the
  docs request already takes up to 198 s against Cloud Run's hard 300 s — longer waits would kill the request before
  the journal record is written.
- Deciding reuse with `compareCargoWithPlan`: it compares only the COUNT of cargoes, not their content; and the
  composition file needs the box→cargo_id mapping, which Ozon does not return without per-box bundle reads.
- «Keep collected files» ticket: Drive already keeps files between runs (same folder, replace by name).

## Owner decisions (2026-10-28)
- Store the per-cluster cargo ids in the journal record «Документы» (reverses the item-24 «not needed» for this
  purpose only: comparison with Ozon, Ozon stays the source of truth) and DELETE them automatically after 20 days.

## Tickets (strictly in order; all touch server.ts)
01 safety and visibility · 02 stale-label cleanup (Code.gs) · 03 resume only what is missing.
Related, not in scope: item 100.5 R-048 (an incomplete composition is sent as a FULL cargo replacement) — ticket 03
must not weaken its guards. Background polls sharing the Ozon limit are not addressed.

## Live check (owner)
Next multi-cluster order: if some labels fail, press «Собрать документы» again — it takes seconds, cargo ids of
finished clusters stay the same, no stale label in the folder, the `SUPPLYDOCS` line and 429 log lines show it.
