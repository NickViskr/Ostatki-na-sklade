# Ticket 02 — design contract (orchestrator, 2026-10-31)

Owner's answers 2026-10-31: daytime light poll hourly 09:00–22:00 Asia/Yekaterinburg plus exact runs at
23:00, 23:30, 23:45; supplies already departed before this ticket get NO handover and an empty week (the owner
sets the week by hand; the filter offers «без недели»); only an admin sets the manual week.
Measured 2026-10-31 (Cloud Run log, 27 runs of `/api/ozon/check` over 7 days): 18–43 s, median 28 s. Budget:
17 light runs × ≤ 53 s + two full polls ≈ 21 min/day of the 90 min trigger quota.

## Part A — handover detection, week, status log (Code.gs + server.ts)

### Proxy (`server.ts`, `/api/ozon/check`)
- Record `polledAt = new Date().toISOString()` right BEFORE step 4 (the `/v3/supply-order/get` calls) and send it
  in the `saveExternalShipments` payload: `data: { shipments, polledAt }`. doPost passes it on:
  `saveExternalShipments(data.shipments, data.polledAt)` — the second argument is optional (ISO text).
- Each shipment additionally carries `orderState: String(order.state || '')` and
  `isDirect: supply.is_crossdock === false` (absent field → not direct).

### Sheet «Внешние отгрузки» — five columns appended at the END (via `EXTERNAL_SHIPMENTS_HEADERS` + `ensureColumns`)
`'Передача с'`, `'Передача по'`, `'Передача тип'`, `'Неделя'`, `'Неделя вручную'`.
- Times are text `yyyy-MM-dd HH:mm:ss` formatted in the explicit zone `'Asia/Yekaterinburg'` (not the script
  zone). Read back like «Дата обнаружения» (item 100.9 R-068, `sheetTextDateZone()`), so the text written is the
  text returned whatever the spreadsheet zone.
- `'Передача тип'` is `'точно'` or `'окно'`. For `'точно'` `'Передача с'` stays empty.
- `'Неделя'` is the ISO week of `'Передача по'` in Asia/Yekaterinburg, text `YYYY-Www` with the ISO week-year
  (2027-01-01, a Friday → `2026-W53`; 2026-12-28 → `2026-W53`; 2027-01-04 → `2027-W01`).
- `'Неделя вручную'` is written only by Part C (admin action); the poll never touches it.

### Previous-poll stamp
Script Property `ozon_lastStatusPollAt` (`ozon_lastStatusPollAt_test` when `_devModeSpreadsheet` is set):
epoch ms of the previous poll's `polledAt`. Read at the start of `saveExternalShipments`; written at its end
with this poll's `polledAt` (or `Date.now()` when the proxy sent none — an old proxy).

### Handover rule (per posting, inside `saveExternalShipments`)
Departed = the GS mirror of `STOCK_DEPARTED_STATUSES` (`src/lib/ozonStatus.ts`; reuse a GS list if one exists).
1. Virtual order (`isVirtual === true`) → nothing.
2. Supply status (`ozonStatus`) not departed → nothing.
3. Row already has `'Передача по'` → nothing (first detection only; never overwritten).
4. Existing row whose STORED «Статус Ozon» is already departed and has no handover → nothing (pre-ticket row,
   no invented time).
5. Otherwise (a new row, or a row whose stored status was pre-departure):
   - `'точно'` when `orderState === 'ACCEPTED_AT_SUPPLY_WAREHOUSE'` and `ozonStatusDate` (the order's
     `state_updated_date`) parses and lies in (prevStamp, polledAt] — or ≤ polledAt when there is no prevStamp.
     Applies to DIRECT too; a DIRECT supply caught in any other departed status gets the window.
   - otherwise `'окно'` from prevStamp to polledAt; with NO prevStamp → nothing (empty week, set by hand).
6. A cancelled/overdue status never gets a handover (they are not departed).

### Status log — new sheet «Журнал статусов Ozon»
Headers `['Время опроса', 'PostingID', 'OrderID', 'Кабинет', 'Было', 'Стало', 'Статус заявки', 'Дата статуса Ozon']`.
One row per posting whose supply status differs from the stored one, and per new posting (`'Было'` empty).
`'Время опроса'` = polledAt as Ekb text. Appended in one `setValues` per call. Unchanged statuses append nothing.

### `getExternalShipments` — new fields per shipment
`handoverFrom`, `handoverTo`, `handoverKind`, `week`, `manualWeek`, `effectiveWeek` (manual wins), and
`checkWeek` = kind `'окно'` AND the ISO week of `'Передача с'` ≠ that of `'Передача по'` AND no manual week.

### Lock
`saveExternalShipments` runs under the doPost script lock; `ensureColumns` (since 100.9 R-024) neither waits
for nor releases a lock the caller holds. The ticket's checklist line «ensureColumns outside any locked section»
is obsolete: the check is that the new columns are added inside the held lock and the lock is still held after.

## Part B — light poll (Code.gs)

- `runOzonStatusPoll(reason)` — the shared body:
  - Skips (logs, records `skipped: 'full poll running'`) when Script Property `ozon_fullPollRunning` holds a stamp
    younger than 15 min.
  - Sets `ozon_statusPollRunning` = now; deletes it in `finally`.
  - Own session row label `'Опрос статусов Ozon'` (deletes only its own stale label rows; the full poll deletes
    only `'Автоопрос Ozon'` rows, so neither kills the other's token); removes its token in `finally`.
  - Same target as the full poll (`ozon_autoSyncTarget` → `devMode`).
  - Calls ONLY `PROXY_URL + '/api/ozon/check'` (never stocks/sales/clusters).
  - Records `{ time, reason, ok, durationMs, found, message }` into Script Property `ozon_statusPollHistory`
    (JSON array, newest first, at most 30) — this is the measured duration of a run.
  - Never schedules the full poll's retry.
- `scheduledOzonStatusCheck()` — handler of ONE hourly trigger (`everyHours(1)`). Runs the poll only when the
  Asia/Yekaterinburg hour is 9..22 inclusive; within those hours it also calls `ensureEveningStatusPolls()`.
- `ensureEveningStatusPolls()` — for today's Ekb date D: if `ozon_eveningPollsDate === D` → nothing. Otherwise
  deletes every `runOzonStatusPollAt` trigger, creates one-off `.at(instant)` triggers for 23:00, 23:30, 23:45 Ekb
  of D that are still at least 1 minute in the future, sets `ozon_eveningPollsDate = D`. Ekb has no DST: the
  instant is `new Date(D + 'T23:00:00+05:00')`.
- `runOzonStatusPollAt(e)` — handler of the evening one-offs: deletes the trigger whose `getUniqueId()` equals
  `e.triggerUid` (only that one), then `runOzonStatusPoll('evening')`.
- `scheduledOzonCheck` (full poll): sets `ozon_fullPollRunning` = now at start, deletes it in `finally`; before
  its `/api/ozon/check` call, while `ozon_statusPollRunning` is younger than 5 min it waits (`Utilities.sleep(5000)`)
  up to 90 s, then proceeds anyway.
- `setupOzonSyncTriggers` also creates the hourly `scheduledOzonStatusCheck`; `removeOzonSyncTriggers` also
  removes `scheduledOzonStatusCheck` and `runOzonStatusPollAt` triggers. `getOzonSyncStatusInfo` additionally
  returns `statusPollHistory` (parsed array) — no UI in this ticket.
- Going live: the owner's «Автоопрос» switch (or one `setupOzonSyncTriggers` run) installs the hourly trigger.

## Part C — «Поставки Озон» (UI + one admin action)

- Code.gs action `setExternalShipmentWeek` `{ postingId, week }`: `assertAdmin`; `week` is `''` (clear) or
  `/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/`; writes only «Неделя вручную» of that posting; unknown posting → error.
  Under the normal doPost lock. Register it wherever actions are listed (`src/lib/gasActions.ts` if relevant).
- `src/types.ts` `ExternalShipment`: the Part A fields.
- A small `src/lib/isoWeek.ts`: label `2026-W44` → «44 · 26.10–01.11»; list of selectable weeks from 2026-W43 to
  the week after the current one (Ekb).
- `OzonSuppliesTab.tsx`: per posting the week label (or «—»), a «проверьте неделю» mark (tooltip: the window
  from–to) when `checkWeek`; a «Неделя» filter next to the cabinet filter: «Все недели» (default), «Без недели»,
  then the weeks present (newest first), filtering by `effectiveWeek`. Admin only: the week label is clickable →
  a select of weeks + «Авто» (clears the manual week) → `setExternalShipmentWeek` → re-read shipments.
