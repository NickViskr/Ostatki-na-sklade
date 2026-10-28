# 03 — collect only what is missing (money-critical tier)
Status: ready-for-agent, after 02
- Record «Документы» gains `supplies[]`: {supplyId, cargoIds (sorted strings — int64 via parseOzonJson, never Number),
  composition: saved?, label: saved?}. Code.gs clears `supplies[].cargoIds` of records older than 20 days (owner
  decision) inside an existing daily path (find the journal-cleanup step of the poll; no new trigger unless none fits).
- server.ts: before any write, one `/v1/cargoes/get` + one `/v1/cargoes/rules/get` for all supplies. Pure decision in
  `src/lib/ozonSupplyDocs.ts` per supply: ids equal to the record AND rules satisfied AND both files saved → skip;
  ids equal AND rules satisfied AND label missing → label only; anything else (no record, ids differ, rules false,
  record expired) → recreate as today.
- Two passes: all cargo creations + composition files first, then all labels; failed labels get one more pass after a
  pause, within a time budget (stop new Ozon work at ~200 s from the request start; Drive ~65 s and the journal must
  finish before Cloud Run's 300 s).
- Confirmation text of «Собрать документы»: only clusters whose cargoes changed in Ozon are recreated.
Checks: decision-function tests (each branch, expired record); guard: a skipped/label-only supply never calls
`/v1/cargoes/create`; whole-path fake-Ozon test: run 1 with 429 on three labels, run 2 = 3 label calls, 0 creates,
journal record merged; budget test (fake clock); 3–5 mutations. Full set once before deploy.
