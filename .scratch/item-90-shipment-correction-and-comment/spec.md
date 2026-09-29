Status: ready-for-agent

# Item 90 — correct a whole shipment's extras, and a comment on every receipt and shipment

Plan item 90 in `docs/OZON_PLAN.md`. Decided with the owner 2026-09-29 (grilling, all answers
recorded below; test seams accepted as proposed). Vocabulary: `CONTEXT.md` — Ozon order, Cluster
posting, Combined shipment, Shipment extras, Operation comment. ADR 0001 (twin rules parity)
applies to the share arithmetic.

## Problem Statement

The owner ships Ozon orders that hold many cluster postings (e.g. order 130238688-1: 9 cluster
postings, 2 articles), and often several orders at once as one combined shipment served by one
set of extras (one pallet, one «Доставка 1 пал + сборка», one packaging bill). In «История» such a
shipment is seen only as separate article rows, each with its own pencil, so:

- the owner cannot see that correcting the extras from one row's pencil already re-spreads them
  over the whole order — the window looks like a per-article edit;
- for a combined shipment the correction is refused outright («Это заявка из общей поставки …
  Исправьте операцию целиком вручную»): when the delivery price changes after the fact, the owner
  has no way to spread the new figure over all the orders that were written off together. Orders
  of a combined shipment are linked today only by the text «[Общая поставка: заявки № …]», with no
  shared identifier;
- there is nowhere to write down what an operation was: the owner keeps notes for himself on
  receipts and shipments, and the only free text today is «Объект», which the app parses for money
  (any «₽» amount there is read as extras).

## Solution

A button «Вся отгрузка» next to the pencil of every shipment row in «История» opens one window
for the whole shipment: every order and article in it, the extras fields (packaging, other,
services) and the comment, with a preview of each order's new share before saving. Saving
re-spreads the new extras by pieces over every order the shipment holds now and records the
corrected cost of each order in the Ozon cost journal. Quantities, stock and the write-off cost
never move. The row pencil loses its extras block and keeps quantity, date and the comment.

Combined shipments written off after this item carry a shared shipment number in a new column of
«История»; older combined shipments are not correctable as a whole and the window says why.

Every receipt and shipment can carry an operation comment: typed when it is recorded (manual entry,
the confirmation window used by upload and by Ozon write-off, China batch posting), editable later
from the pencil and from «Вся отгрузка», shown in «История» as a 💬 icon with the text on hover.
It lives in its own column «Комментарий», never inside «Объект».

## User Stories

1. As the owner, I want a «Вся отгрузка» button on every shipment row in «История», so that I can correct the shipment as a whole instead of guessing what a row pencil changes.
2. As the owner, I want the «Вся отгрузка» window to list every order and article of the shipment with their pieces, so that I see exactly what my correction will touch.
3. As the owner, I want to change packaging, other costs and services (including delivery) of a whole shipment, so that a delivery price that changed after the fact is reflected in the cost of the goods.
4. As the owner, I want packaging and other costs entered per piece or for the whole shipment, as when the shipment was recorded, so that I enter the figure the way the contractor billed it.
5. As the owner, I want to see before saving how much of the new extras each order will carry, so that I can check the split before it is written.
6. As the owner, I want a correction of a combined shipment to be spread by pieces over every order written off together, so that one pallet's delivery is paid once and shared fairly.
7. As the owner, I want the split to follow the orders and pieces the shipment holds now, so that an order deleted or a quantity changed after the write-off is taken into account.
8. As the owner, I want the cost of one piece's extras to be the same in every order of a combined shipment after a correction, so that the result matches one combined write-off.
9. As the owner, I want quantities, stock and write-off cost to stay exactly as they were when I correct extras, so that a correction of services never disturbs the warehouse.
10. As the owner, I want the corrected cost of every affected Ozon order recorded in «Себестоимость Озон», so that KAN gets the true unit cost of each order.
11. As the owner, I want a shipment of one order to be correctable as a whole the same way, so that I use one window for every shipment.
12. As the owner, I want a combined shipment written off before this item to be refused with a clear reason, so that I know why it cannot be corrected here and nothing is half-written.
13. As the owner, I want the correction to write nothing if any order of the shipment cannot be found or read, so that a combined shipment is never left half-corrected.
14. As the owner, I want the row pencil to keep quantity, date and comment but no longer offer extras, so that there is exactly one place where extras are corrected.
15. As the owner, I want to type a comment when I record a receipt or a shipment in «Ручной ввод», so that I remember what the operation was.
16. As the owner, I want to type a comment in the confirmation window of «Загрузка», so that an uploaded receipt or shipment carries my note.
17. As the owner, I want to type a comment when I write off an Ozon order or a combined shipment, so that the note is attached to every order written off together.
18. As the owner, I want to type a comment when I post a China batch with «Оприходовать», so that the receipt from China carries my note.
19. As the owner, I want to edit the comment later from the row pencil, so that I can add or fix a note on any operation, old ones included.
20. As the owner, I want to edit the comment from «Вся отгрузка», so that the note of every order of a combined shipment changes at once.
21. As the owner, I want a 💬 icon on rows with a comment and the text on hover, so that the table stays compact and the note is one gesture away.
22. As the owner, I want a comment never to be read as money, so that a note like «доплатил 500₽» does not change any cost.
23. As the owner, I want the comment and the shipment number to survive a row edit, a deletion to «Удаленное» and its restore, so that notes are not lost by ordinary work.
24. As the owner, I want operations recorded before this item to show and behave exactly as today, so that the history I already have is untouched.
25. As the owner, I want service operations the app writes by itself (re-sort, unshipped return, cost correction) to work as today, so that nothing asks me for a comment where I never type one.

## Implementation Decisions

- «История» gains two columns appended at the end and written by header: «Комментарий» (operation
  comment) and «Отгрузка» (shipment number shared by the orders of a combined shipment). Both are
  created on demand the same way the existing late columns are; old rows keep them empty.
- The shipment number is generated once in the browser when a combined shipment is written off and
  sent with every order's commit; a single-order write-off and every non-Ozon operation leave it
  empty. The whole-shipment set of rows is: all rows sharing the anchor's «Отгрузка» when it is set,
  otherwise the rows of the anchor's operation (same OpID, or same moment/type/object for rows
  older than OpID) — the existing grouping.
- The existing whole-operation extras action on the server is extended, not duplicated: it accepts
  the anchor row, resolves the whole-shipment set, and when that set spans several orders it spreads
  the new extras total over all of them by pieces (then over each order's rows by pieces, as
  today). The refusal for «Общая поставка» stays only for rows without a shipment number. Every row
  is resolved and validated before the first write; any failure writes nothing.
- The per-order «[Общая поставка: …]» note is rewritten with the new shares and totals; the
  extras text of every order carries the new packaging/other/services.
- The server returns per-order shares so the window can confirm them; the browser preview uses a
  twin of the same share arithmetic, registered in the twin-rules parity test (ADR 0001).
- Commit, the China posting action and the row edit accept an optional comment; the row edit
  (which deletes and rewrites the row) carries the comment and the shipment number over, as it
  already does for «ДопРасходы». A separate lightweight action sets the comment of a whole
  shipment without touching money.
- The comment is plain text stored as typed (trimmed); it is never parsed for money and never
  appended to «Объект». The History read model gains `comment` and `shipmentId`.
- The History search also matches the comment text.
- «Удаленное» copies and restores carry both new columns.
- The proxy action table gains the new/extended actions; the TS↔GS action parity test covers them.
- Deployment: Code.gs (and ChinaOrders.gs) first, then Cloud Run.

## Testing Decisions

- Tier: money-critical (extras move «Цена», «Сумма» and the cost journal) — whole-path tests,
  mutations (3–5 per fix, more for the new combined-shipment spread), full set before deployment.
  Dates are not touched: no Yekaterinburg run unless a ticket changes a date.
- Main seam: the Apps Script stand (`tests/apps-script/run-tests.cjs` over the harness). Tests
  drive the public actions — commit with comment and shipment number, whole-shipment extras
  correction on single-order and combined shipments, comment edit, row edit, delete/restore — and
  assert the sheet rows, the cost journal and that quantities/stock/write-off cost are unchanged.
  Prior art: the item-80 `updateShipmentExtras` block and the item-56 batch write-off checks.
- Second seam: the twin-rules parity test for the per-order share arithmetic (browser preview vs
  server), fed the same generated combined shipments. Prior art: `twinRulesParity.test.ts`.
- Screens (comment fields, «Вся отгрузка» button and window, 💬 icon): 1–2 behaviour tests each,
  no mutations. Prior art: existing component tests of `EditTransModal` / `HistoryTab`.
- Good tests assert what the owner sees or what lands in the sheet, never internal helpers.

## Out of Scope

- Whole-shipment correction of combined shipments written off before this item (owner: only new).
- Changing quantities, articles or write-off cost of a shipment as a whole.
- A comment on service operations the app writes by itself.
- Whole-receipt correction of «Приход» operations (receipts carry no shipment extras).
- Sweeping the open item-80 money tail (inflated extras on rows edited before 22.09.2026).

## Further Notes

- Live example to check after deployment: the next combined Ozon write-off; order 130238688-1
  (9 cluster postings, not yet written off on 2026-09-29) is a natural first single-order case.
- Old combined shipments seen on the 2026-09-29 export: 21.09 (129272007-1 + 129270949-1, 2 419 ₽)
  and 24.09 (129768876-1, 129770193-1, 2000067584248; 2 459 ₽) — they must stay byte-identical.
