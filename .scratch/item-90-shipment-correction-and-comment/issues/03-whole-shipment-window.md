# 03: «Вся отгрузка» — correct the extras and the comment of a whole shipment

**What to build:** a «Вся отгрузка» button next to the pencil of every shipment row in «История»
opens one window: every order and article of the shipment with pieces, the extras fields
(packaging and other per piece or for the whole shipment, services), the comment, and a preview of
each order's new share. Saving re-spreads the new extras by pieces over every order the shipment
holds now (all rows with the same «Отгрузка», else the rows of the one operation), then over each
order's rows; rewrites the extras text and the «[Общая поставка: …]» note with the new shares;
records the corrected cost of each Ozon order in «Себестоимость Озон»; sets the comment on every
order. Quantities, stock and write-off cost never move. Any unresolvable row writes nothing. A
combined shipment without a shipment number (written off before item 90) is refused with a clear
reason. The row pencil loses its extras block. The browser preview's share arithmetic is a twin of
the server's, registered in the twin-rules parity test (ADR 0001). Spec: `../spec.md` (user stories
1–14).

**Blocked by:** 01, 02.

**Status:** done (2026-09-29, not deployed — deployment is ticket 04)

- [x] Stand, single order: same result as today's whole-operation extras correction (item-80 checks still green)
- [x] Stand, combined shipment of 2–3 orders: shares by pieces sum to the new total to the kopeck; the extras per piece are equal across orders; each order's rows re-spread; «Себестоимость Озон» gains one corrected entry per order; quantities, stock and write-off cost unchanged
- [x] Stand: an order deleted after the write-off — the total is spread over the remaining orders; a quantity edited — shares follow the current pieces
- [x] Stand: no shipment number + «Общая поставка» tag → refused, nothing written; a failure on any row → nothing written
- [x] Parity: browser preview shares = server shares on generated combined shipments
- [x] Window: lists orders and articles, shows shares before saving, saves extras and comment; pencil shows no extras block
- [x] Mutations: 10+ on the combined spread (new money path), 3–5 on the rest

## Result (2026-09-29)

Built, reviewed (/code-review, two axes; findings fixed), mutation-tested, not deployed (Code.gs goes live in ticket 04).

- **Server (Code.gs):** `updateShipmentExtras` extended in place. Set = rows with the anchor's «Отгрузка» (`shipmentRowsOfTransaction(id, true)`), else the one operation (unchanged single-order path, item-80 checks green). Orders by OpID (`resolveShipmentOrdersGs`, sorted by the `<sid>-N` suffix); a row with a shipment number but no OpID → refused, nothing written. Old combined shipment (no number + «Общая поставка» note) → refused with a clear reason. New total over the WHOLE shipment's pieces; order shares by `splitByQuantityGs` (twin of TS `splitByQuantity`, kopeck largest remainder); old share of a combined order = its stored «ДопРасходы»; rows re-spread per order with the commit formula; «ДопРасходы» = order share; note rewritten by `batchDestinationNoteGs` (labels kept per order when all OpIDs map, a deleted order drops out). Optional `comment` written to every row incl. components. Everything planned before the first write. Returns `orders[{opId,label,pieces,oldShare,newShare}]` and `costJournalError`.
- **Root-cause fix (orchestrator ruling):** `updateTransaction` and `commitShipmentPeresort` re-commit with opId '' and used to DROP the OpID; now `stampOpIdOnTransactions` writes the stored OpID back onto the re-written rows (main + components). This also fixes item-80 corrections silently missing an edited row.
- **Journal:** changed rows carry `opId`; `reissueOzonCostRows` prefers `cabinet|article|day|opId` (journal OpID = History OpID, verified), falling back to the old key — receipt recompute unchanged. Two orders with the same article on the same day get their own corrected unit cost.
- **Read model:** `opId` added to `parseTransactionRow`; TS `Transaction` gains `opId?`, `additionalCosts?`.
- **Browser:** `src/lib/wholeShipment.ts` (twins: `wholeShipmentRows`, `wholeShipmentOrders`, `orderLabels`, `isOldCombinedShipment`, `orderSharesPreview`, `wholeShipmentNewExtras`; view `wholeShipmentView`). New window `WholeShipmentModal.tsx` (orders, articles, pieces, extras fields moved from the pencil, comment, per-order preview old → new share, refusal text); button «Вся отгрузка» next to the pencil of every «Расход» row in «История»; the pencil lost its extras block. Store toast lists per-order shares from the server; journal error → warning toast.
- **Parity:** `combinedTwin` in `twinRulesParity.test.ts` — pieces, old/new shares, labels, new total, both refusals; hand cases + 30 generated (order deleted, row edited).
- **Checks:** stand 1189/0 (+30); vitest 2491 + 1 expected fail (+11); tsc clean. Mutations: 34 in the tester pass + 3 on the review fixes; all killed except the peresort OpID stamp (no peresort harness). Figures re-derived by the orchestrator: shares 469.83 / 939.67 / 1409.50 of 2 819 ₽; 392.09 / 609.91 of 1 002 ₽. No Yekaterinburg run (no dates).
- **Known limits:** (1) stale per-row spread left by an earlier quantity edit (siblings not re-spread) — pre-existing item-80 tail, out of scope; (2) peresort OpID stamp uncovered by the stand; (3) journal rows written by an edit's re-commit carry an empty OpID and fall back to the day key; (4) screens tested through pure helpers and source checks only; the multi-line toast (`pre-line`) not seen in a browser — check in ticket 04.
