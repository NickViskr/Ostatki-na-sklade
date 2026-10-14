# 05: Browser — the send step after a save, toasts with buttons, the KAN marker in «История»

**What to build:** after a successful save that can move the Ozon cost (a shipment to an Ozon
cabinet, a pencil edit / delete / restore of one, «Вся отгрузка», a receipt price edit) the browser
calls the sender of ticket 03 as a separate step and shows: green «КАН принял себестоимость:
Артикул — 233,67 ₽ с 13.10» (one line per group), or red «КАН не принял: <причина>» with buttons
«Отправить снова» and «Отправлю сам». «Отправлю сам» builds the CSV with the existing
`kanCostExport.ts` (collapse + BOM + «;»), downloads it, and calls ticket 04's switch-to-manual
action — it must NOT call `markOzonCostExported`. «История» shows on each Ozon shipment row a marker
from the journal status (✓ КАН accepted / ✗ red error with the two buttons / ⏳ manual, waiting)
for the user who saved the shipment and the admin; rows written before item 93 show nothing. The
«Себестоимость КАН» button stays as it is. Spec: `../spec.md` (answers 1, 4, 5, 7). Cosmetic tier
for the toasts and markers; the «Отправлю сам» path is money-adjacent (what gets stamped).

**Blocked by:** 03, 04.

**Status:** ready-for-agent

- [ ] The save is never slowed or failed by the KAN step; a KAN failure leaves the saved shipment intact
- [ ] Toast texts and buttons per outcome; one toast per save, not per row
- [ ] «Отправлю сам»: file equals what the «Себестоимость КАН» button would build for the same rows; switch-to-manual called; no export stamp
- [ ] Marker per shipment row (combined shipment: each order's rows by OpID); visibility author + admin
- [ ] vitest on the pure helpers (outcome → toast text, journal status → marker, access rule)

## Comments

- 2026-10-14, from ticket 02: `updateTransaction`, `deleteTransaction`, `deleteMultipleTransactions`,
  `restoreArchivedItem`, `restoreMultipleArchivedItems`, `commitShipmentPeresort` and `commitTransaction` now
  return `costJournalError` (Russian text, only when non-empty) when the History operation succeeded but the
  cost journal did not follow (incl. a row without OpID). The browser shows it only for «Вся отгрузка» today
  (`useWarehouseStore.ts` ≈:910) — show it as a red toast on these paths too.

- 2026-10-14, from ticket 03: action `sendOzonCostToKan` (no data) answers `{busy, message, accepted: [g], failed: [g],
  skippedManual, notWritten}`, g = `{cabinet, article, date, action: 'upsert'|'delete', cost (null for a delete), opIds,
  reason?}` — `reason` is ready Russian text for the red toast (list in ticket 03 «Result»). `busy: true` with `message`
  «уже отправляется» (another sender — the trigger or another tab) or «таблица занята, отправка позже»: nothing was sent,
  show it neutrally. A group is in `accepted` only when the journal row really holds «принято». Dev mode throws
  «Отправка себестоимости в КАН недоступна в режиме разработки». The proxy treats it as a write: no cache, no retry,
  90 s timeout (a 504 means Apps Script may still finish — re-read the statuses instead of assuming a failure). Any
  signed-in user may call the action; answer 7 (author + admin) is for the buttons/markers. Journal status values for
  the marker: «принято» / «ошибка» / «вручную» / «отправляется» / '' (rows before item 93: no status — show nothing).

- 2026-10-15, from ticket 04: action `switchOzonCostToManual` (no data) is the server half of «Отправлю сам». It
  switches EVERY unaccepted upsert group (last row '' unstamped / «отправляется» / «ошибка», or already «вручную» — a
  re-switch restarts its hour) with an ISO date and cost > 0 to «вручную» / «ждём файл в КАН» / now, NEVER stamps
  «Выгружено в КАН», and answers `{busy, message, rows, switched, notWritten}`; `rows` = the LAST journal row of each
  switched group in the `getOzonCostExport` row shape `{row, date, cabinet, article, sku, cost, opId, source}`, journal
  order — feed them to `collapseKanCostRows` + `buildKanCostCsv` as the old button does, and never call
  `markOzonCostExported`. Order: switch FIRST, then build and download the file (a lost download only costs one hour:
  the watch gives up and the hourly retry sends by API). Deletions (drop-marker days) are never switched — the file
  cannot carry a delete — and stay on the automatic path. `busy: true` («уже отправляется» / «таблица занята, отправка
  позже»): nothing switched, show it neutrally. Dev mode throws «Переключение на ручную загрузку недоступно в режиме
  разработки». Like the sender, any signed-in user may call it on the server (one call pauses auto-retry of every
  pending group for up to an hour; the journal has no author column) — answer 7 (author + admin) is enforced by who
  sees the buttons; decide here whether that is enough. Marker texts the watch writes: «КАН принял 233,67 (загружено
  вручную)» (stamp «<время> загружено вручную»), «в КАН не найдено», or the read failure's reason after an hour.
