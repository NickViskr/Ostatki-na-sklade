# 04: The watch trigger — hourly auto-retry and the 15-minute check of «Отправлю сам»

**What to build:** a time trigger every 15 minutes. Rows in «manual» mode are looked up in KAN by
read-back at 15/30/45/60 min after the switch: found with the journal's figure → accepted (stamp
«Выгружено в КАН»); not found after the 4th check → status «error», reason «в КАН не найдено», back
to auto-retry. Rows in «error» (and unsent rows older than a few minutes, e.g. the browser closed
before its step) are re-sent through ticket 03's function when their last attempt is ≥60 min old.
Also a server action that switches given groups to «manual» (called by the «Отправлю сам» button)
and returns the rows for the CSV. The trigger is installed by an admin action or a function the
owner runs once in the editor (like `kanTurnoverDaily`). Spec: `../spec.md` (answer 5).

**Blocked by:** 03.

**Status:** done 2026-10-15 (coder → tester → two-axis review → review fixes; result below); committed, not pushed. Not deployed: Code.gs goes live in ticket 06 together with 02, 03, 05; the trigger is installed there only AFTER the backlog send.

- [x] Stand with a fake clock: manual rows checked at 15/30/45/60, accepted as soon as found, back to auto after the 4th miss
- [x] Stand: error rows retried only after 60 min; accepted rows never touched again
- [x] Stand: switching to manual does NOT stamp «Выгружено в КАН» (unlike today's CSV button)
- [x] Installing the trigger twice leaves one trigger
- [x] Mutations 3–5

## Result (2026-10-15)

Code: `Code.gs` (+≈400 lines), `src/lib/gasActions.ts` (+1 action), `src/lib/gasActions.test.ts` (`EARLY_WRITES`, a test
that the two KAN actions are listed writes), `tests/apps-script/harness.cjs` (fake `ScriptApp`, per-cell number formats,
opt-in `setSheetAutoDates(zone)`), `tests/apps-script/run-tests.cjs` (blocks «93/04» A–H and P, `test93s04Gaps` I–N).

- **Ages** are read from the LAST journal row of a (cabinet, article, date) group and compared as TEXT: «Время КАН»
  'yyyy-MM-dd HH:mm:ss' against cut-offs `kanCostCutoffs(now)` formatted in the script zone (`kanCostIsOlder`; a time that
  is not in that pattern counts as old). Constants: `KAN_COST_RETRY_MS` 60 min, `KAN_COST_FRESH_MS` 5 min,
  `KAN_COST_MANUAL_CHECK_MS` 15 min, `KAN_COST_MANUAL_GIVE_UP_MS` 60 min.
- **`collectOzonCostKanGroups(journal, cut)` / `runKanCostSend(username, cut)`:** without `cut` unchanged (the browser
  sends every pending group at once). With `cut` (the trigger): «ошибка» / «отправляется» only when the last attempt is
  ≥60 min old; an unsent '' row with no time goes to `unseen`, with a time only when ≥5 min old; «вручную» groups come
  back in `manual`.
- **`kanCostWatch()`** (the trigger handler): a look WITHOUT the lease first — nothing due → no lease, no lock, no KAN
  request. Otherwise under the sender lease: (a) first-seen time on the last row of each unseen group (no request);
  (b) `kanCostCheckManual` on «вручную» groups ≥15 min after the switch: one `list_shops` (read scope is enough), one
  read per shop; exactly one KAN entry equal to the kopeck → «принято», «КАН принял 233,67 (загружено вручную)», stamp
  «<время> загружено вручную»; not found / other figure / unknown cabinet ≥60 min after the switch → «ошибка» / «в КАН
  не найдено»; KAN unreadable → nothing before 60 min, then «ошибка» with the read failure's own reason; (c)
  `runKanCostSend(null, cut)` — stamp «… автоотправка». One «now» per run. It NEVER throws (project rule: a throwing
  trigger mails the owner every run): errors go to `summary.error` and one `Logger.log` line; the lease is freed in
  `finally`.
- **`switchOzonCostToManual()`** (doPost early branch next to the sender, refused in dev mode, any signed-in user; proxy
  `write()`): under the same lease, every upsert group whose last row is '' unstamped / «отправляется» / «ошибка» / already
  «вручную», with an ISO date and cost > 0 → «вручную» / «ждём файл в КАН» / now on ALL its rows; «Выгружено в КАН» is
  never set. Answer `{busy, message, rows, switched, notWritten}`, `rows` = the last row of each switched group in the
  `getOzonCostExport` shape (`ozonCostExportRow`), journal order. Deletions, accepted, CSV-stamped, bad-date and zero
  groups are left alone.
- **`setupKanCostWatchTrigger()`**: deletes `kanCostWatch` triggers, creates one `everyMinutes(15)`; other triggers kept.
- **Review fix (root cause, also a ticket-03 latent defect):** the script zone is `Asia/Yekaterinburg` (appsscript.json)
  while the stand fakes `Europe/Moscow`. Text '2026-10-14 15:30:00' written into a General cell is parsed by Sheets as a
  date-time; `getValues` returns it as a Date in the SPREADSHEET's zone and `ozonCostRowsFromValues` formats it in the
  SCRIPT zone — with different zones every age shifts by the difference (Moscow sheet → checks ~2 h late; a sheet ahead
  of the script → «вручную» gives up on the first run). `writeOzonCostKanStatuses` now sets format '@' on the «Время КАН»
  cells of the written block and writes other rows' times back as text. Reproduced first with the opt-in
  `setSheetAutoDates` mode (19 checks red before the fix). The live spreadsheet's zone is unknown — irrelevant now.
- **Orchestrator's decisions (owner may object):** the switch takes ALL unaccepted groups, not only the failed
  shipment's (consistent with the spec: the file holds all unaccepted rows); checks are time-based (with a 15-min
  trigger: 15/30/45/60); after the give-up the row waits the normal 60 min before the API retry; a different figure
  in KAN is reported «в КАН не найдено» (the retry then overwrites KAN with the journal figure).
- **Tests:** stand 1373 → 1464, 0 failed, also under `TZ=Asia/Yekaterinburg`; `gasActions.test.ts` 13/13. Mutations:
  coder 28 (27 killed, 1 equivalent), tester 15 (7 survived at first → 16 checks added, then killed; 1 equivalent), review
  fixes 8/8 killed.
- **Review (two axes):** standards — no breach; the unused `username` parameter dropped, harness comment corrected,
  ARCHITECTURE trigger list updated; duplicated small shapes (startRows map, unwritten check) left as judgement calls.
  Spec — the zone defect (fixed), unreadable KAN leaving rows «вручную» forever (fixed), the throwing trigger (fixed);
  answer 7 on the server and the trigger order are recorded in tickets 05 and 06.
- **Known limits:** the hourly retry never gives up (a «товара нет в КАН» group costs 4 requests an hour); a pending
  group with a bad date or zero cost takes the lease once an hour and fails locally; a «Время КАН» Date written by hand
  is read in the script zone (possibly shifted); the watch reads the journal three times per working run.

## Comments

- 2026-10-14, from ticket 03 (details in its «Result»): reuse `sendOzonCostToKan(username)` (`Code.gs` ≈6662) — it
  sends EVERY pending group (last-row status '' / «отправляется» / «ошибка», except '' with a «Выгружено в КАН» stamp);
  the «≥60 min since the last attempt» filter is this ticket's to add (e.g. an option read from «Время КАН»). A call
  without a username stamps «… автоотправка». The status columns are «Статус КАН», «Ответ КАН», «Время КАН» at the END
  (`OZON_COST_KAN_HEADERS`; `ensureColumns` with `OZON_COST_HEADERS.concat(OZON_COST_KAN_HEADERS)`, never widen
  `OZON_COST_HEADERS`); «Время КАН» is 'yyyy-MM-dd HH:mm:ss' in the script zone, read back as text even when Sheets made
  it a Date (`ozonCostRowsFromValues`). The manual switch must take the SAME lease (`acquireKanCostLease` /
  `releaseKanCostLease`) and write through `writeOzonCostKanStatuses` (short script lock, fresh read, identity check, never
  touches columns 1–12); never call `ensureColumns` or `getOzonCostJournal` inside a script-lock section — its own
  `releaseLock` would release ours. The «вручную» status is already skipped by the sender (counted in `skippedManual`).
- OWNER 2026-10-14: the old «Себестоимость КАН» button stays AS IT IS. It stamps rows without any read-back, and a
  stamped row with an empty status counts as done for the sender — a row exported through that button is never
  verified; that is accepted (the button is the admin's manual path). Do not change the button in this ticket.
