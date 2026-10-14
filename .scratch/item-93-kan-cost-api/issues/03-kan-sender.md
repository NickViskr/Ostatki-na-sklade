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

**Status:** done 2026-10-14 (planner → coder → tester → two-axis review → orchestrator fixes; result below); commit `2a59a53`, pushed to GitHub 2026-10-14 on the owner's word. Not deployed: Code.gs goes live in ticket 06 together with 02, 04, 05.

- [x] Journal gains the status/answer/time columns at the end; old sheets upgrade in place
- [x] Stand fake KAN behind `UrlFetchApp.fetch`: accept; refuse (isError); wrong figure written; unknown article (skipped/issues); HTTP 500; missing scope; preview expired
- [x] Stand: two groups of one article on different dates; a combined shipment; ≥201 rows → two batches
- [x] Stand: a second call right after success sends nothing (idempotent); «manual» rows skipped
- [x] Stand: a concurrent second sender returns «уже отправляется» without sending (script lock)
- [x] Stand: deletion mark → KAN `delete` of that entry; nothing deleted when KAN has no entry
- [x] New action in `doPost` and in `src/lib/gasActions.ts` (parity test green)
- [x] Mutations 3–5; `TZ=Asia/Yekaterinburg` run

## Result (2026-10-14)

Code: `Code.gs` (+≈520 lines), `src/lib/gasActions.ts` (+1 action), `src/lib/gasActions.test.ts` (`EARLY_WRITES`),
`tests/apps-script/harness.cjs` (strict `setValues`, `tryLock`, lock tracking, `ContentService`, `callDoPost`),
`tests/apps-script/run-tests.cjs` (`fakeKanCost` + block «93/03», 80 checks).

- **Journal columns** `OZON_COST_KAN_HEADERS` = «Статус КАН», «Ответ КАН», «Время КАН» (`Code.gs` ≈5814), a list SEPARATE
  from `OZON_COST_HEADERS` (the journal writers write 12-wide rows sized by that constant; widening it would break every
  write in real Apps Script — the stand's fake `setValues` did not check widths and now does, 0 mismatches anywhere).
  Added at the end by `ensureColumns` on the first send; columns 1–12 never written except the stamp. Status values:
  '' / «отправляется» / «принято» / «ошибка» / «вручную» (the last one is written by ticket 04, only read here).
  `getOzonCostJournal` → `ozonCostRowsFromValues(values)` (pure, ≈5837) adds `kanStatus`, `kanAnswer`, `kanTime`
  (a Date cell in «Время КАН» is read back as 'yyyy-MM-dd HH:mm:ss').
- **Sender** (`Code.gs` ≈6295–6768): `sendOzonCostToKan(username)` = dev-mode refusal → lease → `runKanCostSend`.
  Groups (`collectOzonCostKanGroups`): (cabinet, article, date), last row decides — drop marker → delete, else upsert
  «Себестоимость после». Pending = last-row status '' / «отправляется» / «ошибка», EXCEPT '' with a «Выгружено в КАН»
  stamp (legacy CSV upload). Local refusals (bad date, cost ≤ 0) → `list_shops` (scope `mcp:product_cost:write`; shop
  by exact name among Ozon shops; two Ozon shops of one name → error, never a guess) → «отправляется» on the rows →
  per shop (`kanCostSendShop`): one pre-read only if there are deletes; upserts ≤200 per preview → apply
  (transport failure → ONE retry with the SAME preview_id; refusal/expiry not retried); one delete preview per entry
  (0 entries → nothing to delete, >1 → error); ONE read-back `get_product_costs` over all the shop's dates, always.
  Accepted iff the read-back holds exactly one entry equal to the kopeck (delete: none). Final statuses + stamp
  (`writeOzonCostKanStatuses`) under a short script lock, from a fresh read, only on rows whose identity (cabinet,
  article, date, OpID, source, «Себестоимость после») is unchanged; stamp only on accepted UPSERT rows with an empty
  stamp — never a drop marker, never a delete group, never overwritten. A group with a row the journal moved during
  the run is reported failed («журнал изменился во время отправки — отправится снова»), never accepted.
  Typical one-shipment run: 4 requests (list_shops, preview, apply, read-back); a second call after success: 0.
- **Reasons** (Russian, «Ответ КАН»): «товара нет в КАН», «КАН записал 233,60 вместо 233,67», «в КАН нет записи после
  отправки» (prefixed «КАН не сохранил изменения; » when apply said history_saved false), «КАН недоступен», «КАН
  отказал: …», «токен без права записи себестоимости», «токен КАН не задан», «КАН отверг токен», «кабинет «X» не найден в
  КАН», «в КАН два магазина с именем «X»», «в КАН несколько записей на эту дату», «запись в КАН не удалена», «КАН не
  вернул preview_id», «неверная дата в журнале», «нулевая себестоимость — не отправлено». Accepted: «КАН принял 233,67»,
  «КАН: запись удалена», «КАН: записи не было». A preview issue outranks a step error.
- **Concurrency:** lease in Script Property `kan_costSenderUntil` (10 min) taken under `getScriptLock().tryLock(10000)`;
  busy → `{busy: true, message: 'уже отправляется'}` (another sender) or 'таблица занята, отправка позже' (the global lock
  held); no request to KAN is ever made under a script lock (checked by the stand).
- **doPost:** `sendOzonCostToKan` answered before the global lock (any signed-in user), refused in dev mode (the test DB
  must never reach the real KAN). Proxy: `sendOzonCostToKan: write()`, parity test green (12/12).
- **Answer:** `{busy, message, accepted: [g], failed: [g], skippedManual, notWritten}`, g = `{cabinet, article, date,
  action: 'upsert'|'delete', cost (null for a delete), opIds, reason?}`.
- **Acceptance rule (orchestrator's decision, CONFIRMED by the owner 2026-10-14):** acceptance = the
  read-back equal to the kopeck; `history_saved` only words the reason. The live preview of an unchanged row answered
  `created 0 / updated 0 / history_saved false` — a literal «history_saved true AND read-back» would keep a correct
  re-send in «ошибка» forever.
- **Live KAN facts (2026-10-14):** `list_shops` shops carry `name`; `get_product_costs` `cost_price` is a STRING with 4
  decimals; ONE preview on the owner's word (BowlGrayMini_01 241.14 + an unknown article, NOT applied): `issues` and
  `history_saved` sit inside `summary`, `row_number` is 1-based in the sent rows, the issue's `sku_article` is
  lower-cased. The `apply` answer and the `delete` preview were NOT observed (the fake assumes `{summary:
  {history_saved}}`; the delete preview is sent as `{operation: 'delete', entry_id}` without `shop_id`).
- **Tests:** stand 1293 → 1373, 0 failed, also under `TZ=Asia/Yekaterinburg`. Mutations: tester 5/5 killed (stamp on
  drop markers/delete groups, tolerance 0.1, batch 201, lease check skipped, read-back trusted on history_saved) plus 3
  extra (two halves of M1, old reason precedence); orchestrator 2/2 (moved-row group reported accepted, duplicate shop
  name guessed).
- **Review (two axes):** spec — two defects fixed (answer vs sheet, duplicate shop name); standards — unused harness
  exports removed, a hoisted `var` replaced, a misplaced comment moved. Left as judgement calls: the day-key rule is also
  in `getOzonCostExport`; the action is a bare 'upsert'/'delete' string; a hand-typed ДД.ММ.ГГГГ journal date is refused
  by the sender («неверная дата в журнале») while the CSV accepts it.
- **Known limits:** any signed-in user may trigger a send of ALL pending rows (answer 7 is for the buttons — ticket 05);
  a row stamped by the unchanged «Себестоимость КАН» button with an empty status counts as done and is never read back
  (see ticket 04 Comments); the proxy gives a write 90 s (a long backlog run ends in Apps Script, the browser sees 504);
  if the final status write fails after KAN was updated, the rows stay «отправляется» and the next run re-sends them
  idempotently.

## Comments

- 2026-10-14, from ticket 02: the journal now carries drop markers. Read each (cabinet, article, date) by its
  LAST row: `isOzonCostDropRow(r)` (source «удалено из цепочки», «Отгружено» 0, «Себестоимость после» empty) →
  KAN `delete` of that date (entry id from `get_product_costs`); anything else → upsert «Себестоимость после».
  Markers are never stamped «Выгружено в КАН» and `getOzonCostExport` leaves marker-ended days out of the CSV.
  A chain rewrite appends ONE block with a single `setValues`; take the per-date view from one journal read.
  Status writes must not touch columns 1–12, and new columns go at the END (ensureColumns).
