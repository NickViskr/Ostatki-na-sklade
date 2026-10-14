# 03: The sender — unaccepted journal rows to KAN, verified by read-back

**What to build:** a server action (and a function the trigger of ticket 04 reuses) that takes every
journal row KAN has not accepted, groups them per (cabinet, article, date) with the last row
winning, maps the cabinet to the KAN shop by name (`list_shops`), checks the token has
`mcp:product_cost:write`, sends batches of ≤200 through `preview_product_cost_changes` (import) →
`apply_product_cost_changes` (confirm), turns deletion marks of ticket 02 into `delete` operations
(entry id from `get_product_costs`), then reads KAN back and compares `cost_price` with the journal
to the kopeck. Only a verified group is accepted: status «accepted» and the «Выгружено в КАН» stamp
on every journal row of the group. Anything else gets status «error» with a Russian reason the toast
can show («товара нет в КАН», «КАН записал 233,60 вместо 233,67», «КАН недоступен», «токен без
права записи себестоимости»). Rows in «manual» mode are skipped. Answers which groups were
accepted/failed, with article, cabinet, date, figure, and the OpIDs they came from (the browser maps
them to «История» rows). Spec: `../spec.md` (answers 1, 4, 5; KAN API facts; Implementation
Decisions). Money-critical.

**Blocked by:** 01 (token scope, KAN's answers on future dates / unknown article), 02 (deletion marks).

**Status:** ready-for-agent

- [ ] Journal gains the status/answer/time columns at the end; old sheets upgrade in place
- [ ] Stand fake KAN behind `UrlFetchApp.fetch`: accept; refuse (isError); wrong figure written; unknown article (skipped/issues); HTTP 500; missing scope; preview expired
- [ ] Stand: two groups of one article on different dates; a combined shipment; ≥201 rows → two batches
- [ ] Stand: a second call right after success sends nothing (idempotent); «manual» rows skipped
- [ ] Stand: a concurrent second sender returns «уже отправляется» without sending (script lock)
- [ ] Stand: deletion mark → KAN `delete` of that entry; nothing deleted when KAN has no entry
- [ ] New action in `doPost` and in `src/lib/gasActions.ts` (parity test green)
- [ ] Mutations 3–5; `TZ=Asia/Yekaterinburg` run

## Comments

- 2026-10-14, from ticket 02: the journal now carries drop markers. Read each (cabinet, article, date) by its
  LAST row: `isOzonCostDropRow(r)` (source «удалено из цепочки», «Отгружено» 0, «Себестоимость после» empty) →
  KAN `delete` of that date (entry id from `get_product_costs`); anything else → upsert «Себестоимость после».
  Markers are never stamped «Выгружено в КАН» and `getOzonCostExport` leaves marker-ended days out of the CSV.
  A chain rewrite appends ONE block with a single `setValues`; take the per-date view from one journal read.
  Status writes must not touch columns 1–12, and new columns go at the END (ensureColumns).
