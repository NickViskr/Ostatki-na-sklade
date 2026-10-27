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

**Status:** done 2026-10-27 (tester test-first → coder, three steps A–C; two-axis review → review fixes; result below). Not deployed: Code.gs (the new read `getOzonCostKanMarkers`) and Cloud Run go live in ticket 06 together with 02–04.

- [x] The save is never slowed or failed by the KAN step; a KAN failure leaves the saved shipment intact
- [x] Toast texts and buttons per outcome; one toast per save, not per row
- [x] «Отправлю сам»: file equals what the «Себестоимость КАН» button would build for the same rows; switch-to-manual called; no export stamp
- [x] Marker per shipment row (combined shipment: each order's rows by OpID); visibility author + admin
- [x] vitest on the pure helpers (outcome → toast text, journal status → marker, access rule)

## Result (2026-10-27)

Code: `src/lib/kanCostSend.ts` (new, pure helpers), `src/store/useWarehouseStore.ts`, `src/components/ConfirmModal.tsx`,
`src/components/HistoryTab.tsx`, `Code.gs` (+1 read), `src/lib/gasActions.ts` (+1 read). Tests: `src/lib/kanCostSend.test.ts`
(new, 115), `src/lib/twinRulesParity.test.ts` (+1 twin), `tests/apps-script/run-tests.cjs` (block «93/05», 9 checks).
Pipeline: the tester wrote every test first (steps A, B, C and the review fixes), the coder made them green.

- **Server read** `getOzonCostKanMarkers()` → `{markers: [{opId, article, status, answer, time}]}` (`Code.gs`, next to
  `collectOzonCostKanGroups`; pure half `ozonCostKanMarkersFromJournal`). Day group = the sender's key
  `cabinet|article|date`, its LAST row decides; a shipment = (OpID, article), the LAST journal row of the pair picks the
  day (a re-dated link follows its new day); status '' → no entry (rows before item 93 show nothing). Lock-free, any
  signed-in user, proxy `read()` not cached (the watch trigger writes statuses outside the proxy).
- **Pure helpers** (`kanCostSend.ts`): `kanSendToast` (green «КАН принял себестоимость:» + «Артикул (Кабинет) — 233,67 ₽ с
  13.10» per group, delete «— запись за 13.10 удалена»; red «КАН не принял: <причина>» or «… себестоимость: N», failed lines
  first, then «Принято: …»; busy → info «КАН: …»; nothing → no toast), `kanManualToast`, `kanManualCsv` (= the old button's
  mapping + `collapseKanCostRows` + `buildKanCostCsv`, byte for byte), `isOzonShipmentRow` (twin of Code.gs
  `isOzonShipmentHistoryRow`, registered in `twinRulesParity`), `kanMarkerView` (принято ✓ / ошибка ✗ + buttons /
  вручную ⏳ / отправляется ⏳ / '' nothing), `canSeeKanMarker` (answer 7: author or admin), `historyKanMarker`.
- **Store:** `sendKanCost` (the automatic step and «Отправить снова»): never awaited by a save, never touches
  `isProcessing`, never throws; one request at a time (a call during a run makes it repeat once); dev-mode admin → info, no
  call; non-success (504/network/thrown) → neutral info + statuses re-read now and once more 120 s later; statuses always
  re-read after. `sendKanCostManually` («Отправлю сам»): `switchOzonCostToManual` FIRST, then one file `kanManualCsv(rows)`
  named `kanCostFileName(today)`, never `markOzonCostExported`; a failed switch → red toast with a retry button. Every KAN
  toast carries `id: 'kan-cost'` (a new one replaces the previous — no stack of permanent red toasts).
- **Wiring:** an Ozon shipment commit (not a silent combined-shipment member — `ConfirmModal` starts ONE step after the
  loop, also after an interruption when ≥1 order was written), a pencil edit of an Ozon shipment row or a receipt edit that
  appended journal rows, a delete of an Ozon shipment row (single, multiple, kit cascade → one step), a restore that brings
  an Ozon shipment back (read from the archive's `dataJSON`), a re-sort, «Вся отгрузка» with `costRowsAppended > 0`.
  `costJournalError` → red toast on commit / edit / delete ×2 / restore ×2 / re-sort («Вся отгрузка» keeps its warning).
  The receipt-edit toast lost «— нажмите «Себестоимость КАН»». `exportKanCost` unchanged byte for byte.
- **«История»:** `fetchKanCostMarkers()` on opening the tab; per main row a ✓/✗/⏳ span next to 💬 (emerald / red / amber,
  app tooltip with the text); ✗ has «Отправить снова» and «Отправлю сам».
- **Checks:** vitest 69 files, 2655 passed + 1 expected fail (2539 + 1 before); stand 1530/0 (1521 before); tsc clean. No
  date logic changed → no Yekaterinburg run. Mutations: step B 3/3 killed (manual stamps «Выгружено», commit awaits KAN,
  download before the switch); the tester's own throwaway probes (scratchpad, not in the repo) killed 14 + 15 more.
- **Review (two axes):** standards — the ADR-0001 twin was missing (registered); judgement calls left: the marker day key
  repeats the sender's (`ozonCostRowsFromValues` already trims the status, so no drift), a third admin-detection variant,
  the tooltip markup copied from 💬. Spec — fixed: restore and receipt-edit gating, stacked permanent red toasts, a
  manual-switch failure without a retry, a single too-early re-read after a 504.
- **Orchestrator's decisions (owner may object):** the server actions stay open to any signed-in user — answer 7 is
  enforced by who sees markers/buttons; the toast after a save reports EVERY group the sender handled (also an older
  failure of someone else's shipment, with both buttons for whoever saved); the cabinet is named in each toast line.
- **Known limits:** a partial bulk restore is gated by the requested ids; markers refresh only on opening «История» and
  after a send; the button layout in the 240 px destination cell is not checked in a browser yet (first look in ticket 06).
- **Incident:** the spec reviewer (brief without the npm rule) ran `pnpm exec vitest`, which left `pnpm-lock.yaml` +
  `pnpm-workspace.yaml` and relinked node_modules to other versions; repaired on the owner's word (`rm` of both files +
  `npm ci`); every brief now states npm/npx only.

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
