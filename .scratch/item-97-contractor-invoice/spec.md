Status: ready-for-agent

# Item 97 — the contractor's weekly invoice over the week's supplies, Ozon-detected handover, automatic goods write-off

Plan item 97 in `docs/OZON_PLAN.md`. Asked by the owner 2026-10-21 with four sample invoices; analysed the
same day against the code and the Ozon API docs; owner's answers 2026-10-21/22 recorded below. Vocabulary:
`CONTEXT.md` — Ozon order, Cluster posting, Combined shipment, Shipment extras, Supply reserve. Memory
note: `contractor-invoice-allocation-2026-10-21`.

## Problem Statement

A contractor packs the goods, sticks the labels and delivers the supplies to the Ozon drop-off point
(СЦ). It bills on MONDAY for the previous ISO week, ONE invoice covering the supplies of BOTH cabinets
(two ИП). Today the services of a supply are estimated at write-off from the tariff directory
(«Услуги» / «Тарифы услуг»: pallets, boxes, pick-up), never from the real invoice, and nothing ties
an invoice to the supplies it paid for. The owner wants the real invoice spread over the week's supplies,
the handover moment detected by the app itself, and the invoice file kept with the week.

## Owner's decisions (2026-10-21/22)

1. The goods cost is fixed at the HANDOVER: the app writes the goods off by itself when it first sees the
   supply in «принята на точке отгрузки». Goods only — no services, no packaging; the supply gets the
   status «ждёт счёта». (His first idea, remembering the average at supply creation, was rejected on a
   computed example — see «Why not remember the price».)
2. Handover day and week = that first detection. The Ozon timeslot is a plan, not a fact — only a hint.
3. Polls: the full 11:00/20:00 МСК poll stays as it is (item 86). Added: a light poll of supply statuses
   only, hourly in the daytime, and at 23:00, 23:30, 23:45 Yekaterinburg time (contractors hand over in
   the evening).
4. One invoice covers both ИП: it is spread over every supply of the week of both cabinets.
5. The invoice REPLACES all contractor services of the ticked supplies (tariff services of manual
   write-offs included).
6. After recognition the user ticks which invoice lines, and how many of each, go onto the ticked supplies.
7. Split by BOXES: e.g. «Доставка 1 паллеты» in proportion to the boxes of all goods.
8. Packaging and stickering are one thing, entered by hand per ARTICLE in the week window (step 1, as
   packaging is entered by hand today); then the invoice services are spread (step 2).
9. The new rules start with ISO week 43 (19–25.10.2026); earlier weeks stay as they are.
10. Files (the invoice PDF and anything else) attach to the WEEK.

## Facts the design rests on

- Sample invoices (four PDFs, read locally only — they carry INNs and bank accounts, never into this public
  repo; fixtures must be synthetic). Lines seen: «Доставка на СЦ ОЗОН ФБО (готовый палет)» 1×1299.00,
  «Забор груза с адреса Заказчика» 1×159.00, «стикеровка» N×5.00, «Комплекс услуг фулфилмента (забор,
  упаковка, стикеровка, доставка)» 2×55.00, «Хранение товара» 1×9022.74, «Доставка возвратных отправлений с
  маркета» 4×135.00, «Доставка на СЦ OZON ФБО (ВБ)» 6×159.00. Prices include 5% VAT. All four sum to the
  kopeck (qty × price = sum per line, Σ lines = «Всего к оплате»). Two different templates; two PDFs carry
  the same «№ 5116 от 12.10» with 2158.00 and 5168.00 — probably a re-issue. Column text extraction of the
  PDFs is scrambled (columns interleave).
- Ozon gives NO status history. `/v3/supply-order/get`: per supply `state`, per ORDER `state_updated_date`
  (time of the last state change), and the timeslot «по местному времени» with `timezone_info`.
- The poll `/api/ozon/check` (`server.ts`) already stores per cluster posting «Статус Ozon» and the order's
  «Дата статуса Ozon» in «Внешние отгрузки» (`EXTERNAL_SHIPMENTS_HEADERS`, `Code.gs`). It runs from
  `scheduledOzonCheck` at 11:00/20:00 МСК (`setupOzonSyncTriggers`) and from the «Проверить Ozon» button.
- `scheduledOzonCheck` deletes EVERY «Автоопрос Ozon» row of «Сессии» at start, so two runs at once kill
  each other's token.
- Apps Script daily triggers drift ±15 min (`nearMinute`); one-off `.at(date)` triggers are the way to
  exact times (pattern: `runOzonSyncOnce`, `runOzonSyncRetry`). Consumer account: 90 min/day of trigger
  runtime, 20 triggers per script.
- The app already treats ACCEPTED_AT_SUPPLY_WAREHOUSE and every later status as «departed»
  (`STOCK_DEPARTED_STATUSES`, `src/lib/ozonStatus.ts`); the reserve holds until the write-off
  (`SUPPLY_RESERVE_ACTIVE` includes COMPLETED, `Code.gs`).
- The Ozon cost journal row is appended AT WRITE-OFF and its base = Ozon «Доступно» + «Возвраты» + our
  written-off supplies not yet at the storage warehouse (`appendOzonCostForShipment`,
  `getOzonShippedNotAcceptedForCost`). A write-off after Ozon accepted the goods counts them twice (96.4).
- Shipment extras live in «Объект» text + «ДопРасходы»; `updateShipmentExtras` rewrites them for a whole
  shipment and reissues the journal (`reissueOzonCostRows`) only for rows whose price changed in that run.
  Services are rounded to whole roubles (`extrasTotalGs`, `buildDestinationGs`, `shipmentExtras.ts`) and
  each row's share is rounded on its own (96.12, 96.13).
- Boxes: `countShipmentBoxes` (`src/lib/shipmentBoxes.ts`) = ceil(qty / pcsPerBox) per article, and
  silently 0 when the SKU card has no «штук в коробе».
- AI reading: the proxy already calls Gemini (`/api/parse-invoice`, `/api/china/ai-read`); the China module's
  rule is «AI reads cells, never computes money; the app's own sum checks decide» (`src/lib/chinaAiRead.ts`).
- Files: `appsscript.json` has no Drive scope (DriveApp adds one → the owner re-authorizes once, otherwise
  every trigger fails); the proxy JSON limit is 1 MB (`server.ts`, `express.json`).

## Why not remember the price at creation

Stock 100 @ 300. Supply A (50) created and its average remembered (300). Receipt 100 @ 100. Supply B (100)
created → remembered 200. Both written off a week later: A 15 000, B 20 000, 50 pcs left worth 5 000.
Correct (goods leave the average when fixed): A 15 000, B 16 666.67, 50 pcs worth 8 333.33. And the KAN
journal row would still be appended late: Ozon 100 @ 100 + new 100 @ 200 → 150 if written off in transit,
133.33 after Ozon put it into «Доступно». Fixing the cost therefore means writing the goods off.

## Implementation Decisions

- Handover detection: the first poll that sees a posting in a departed status. Exact time = the order's
  `state_updated_date` when the poll catches the order exactly in ACCEPTED_AT_SUPPLY_WAREHOUSE; otherwise
  the window (previous poll, this poll] and the mark «окно». DIRECT supplies: the first departed status.
  Day and ISO week in Asia/Yekaterinburg (written as text — the zone trap of item 93 ticket 04). A window
  crossing Sunday→Monday midnight marks the supply «проверьте неделю». A manual week overrides.
  An own log of status changes per posting (Ozon keeps none).
- Light poll: the supply part of `/api/ozon/check` only; never overlapping the full poll (session rows);
  evening runs exact via one-off triggers set by an earlier run; measure a run before choosing the
  daytime hours.
- Automatic goods write-off: server-side, one expense operation per Ozon order (as today), operation key =
  the order, under the lock, production DB only, delivery date = handover day, journal row appended at
  once. Anything unclear (unknown offer, kit without components, short stock, virtual order) is not written
  off: flagged «спишите вручную» in «Поставки Озон» and mailed. Needs 96.10 fixed first (it retries itself).
- Week window, step 1: packaging/stickering per article (₽ per piece) for the week's supplies of both
  cabinets; replaces any packaging the write-off carried. The step-1 sum is shown against the invoice's
  stickering line(s).
- Week window, step 2: the user ticks invoice lines and quantities (stickering/packaging lines unticked by
  default, «учтено в шаге 1») and the supplies of the week (all by default, both cabinets); the amount is
  split by boxes, kopeck-exact by largest remainder at every level (week → supply → row); a missing box norm
  blocks with the article named; preview per supply and per cabinet; the unallocated remainder is shown.
- Storage: the invoice shares and the step-1 packaging are FIXED per-row sums with the invoice reference.
  No other path (pencil, re-sort, «Вся отгрузка», delete/restore) re-spreads them; a quantity edit, delete
  or restore of a supply carrying them marks the week «перераспределить».
- Apply = one server operation: compute everything, then write, then reconcile the KAN journal against
  «История» (not only rows «changed in this run» — a retry after a cut-off would skip them). A repeat sets
  the same target (idempotent). Re-applying an invoice replaces its own previous shares only.
- Invoices: sheets for the header and the lines; the same supplier + number + date is a replacement only
  after the user confirms.
- Files: a Drive folder (id in Script Properties, never in code), upload/download/list through the proxy
  with a separate body limit (≤ 10 MB per file) on the upload route only; dev mode uses its own folder.

## Testing Decisions

- Money tier (whole path, mutations 3–5 per fix, tester agent): tickets 01, 03, 06, 07, 08.
- Dates (handover day, ISO week, Sunday→Monday, poll windows): ticket 02 with the `TZ=Asia/Yekaterinburg` run.
- Fixtures: synthetic invoices only; the four real ones are checked locally and never committed.

## Out of Scope

- Weeks before 43; re-costing past supplies from the old invoices.
- Invoice lines unrelated to supplies (storage, returns, «ВБ»): they stay unallocated, nothing books them.
- «Прочее» once the write-off is automatic — open, ask the owner in ticket 06.

## Tickets

Plan T0–T8 = files 01–09.

- 01 Prerequisites from item 96: 96.1, 96.12 + 96.13, 96.10
- 02 Handover detection, ISO week, light polls, status log
- 03 Automatic goods write-off at handover
- 04 Files of the week on Google Drive
- 05 Invoice reading and checks
- 06 Week window, step 1: packaging per article
- 07 Week window, step 2: spreading the invoice
- 08 Guards after the spread and the week reconciliation
- 09 Full run, deployment, the owner's re-authorization, live check
