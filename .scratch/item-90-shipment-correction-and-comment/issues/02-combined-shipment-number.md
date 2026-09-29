# 02: Shared shipment number on new combined shipments

**What to build:** when several Ozon orders are written off together as a combined shipment, the
browser generates one shipment number and every order's commit writes it to a new column «Отгрузка»
of «История». A single-order write-off and every non-Ozon operation leave it empty. The number
survives a row edit, a deletion to «Удаленное» and its restore, and the History read model exposes
it. Nothing the owner sees changes yet; the number is what ticket 03 uses to find all orders of a
combined shipment. Spec: `../spec.md` (Implementation decisions: columns and shipment number).

**Blocked by:** 01 (same History write path and column plumbing).

**Status:** done (2026-09-29, not deployed — deployment is ticket 04)

- [x] Stand: commits carrying a shipment number write it on every row of every order; without one the cell stays empty; a sheet without the column gains it at the end
- [x] Stand: row edit and delete/restore keep the number
- [x] Browser: a combined write-off sends one and the same number with every order; a single-order write-off sends none
- [x] Old combined shipments (21.09, 24.09 on the 2026-09-29 export) read exactly as before
- [x] Mutations 3–5 on the server path

## Result (2026-09-29)

Built, reviewed (/code-review, two axes: no hard violations, no spec gaps), not deployed.

- **Server (Code.gs):** «Отгрузка» appended after «Комментарий» by `getTransactionSheet`'s
  ensureColumns; `buildTransactionRow`/`parseTransactionRow` map it by header (`shipmentId`, '' for
  old rows). `commitTransaction` has an 11th param `shipmentId` (after `comment`), written on main
  and kit component rows; doPost `commit` passes `payload.shipmentId`. `updateTransaction` always
  keeps the stored number (not editable from the client). Both archive payloads carry `shipmentId`;
  ticket 01's `writeRestoredComment` became `writeRestoredLateCells` driven by
  `RESTORED_LATE_CELLS` (header → payload key), used by the single restore and by the bulk restore.
  `commitShipmentPeresort` carries `firstTx.shipmentId` over. China posting and every other
  operation pass nothing → empty cell.
- **Browser:** the combined path of `ConfirmModal` passes `opIdRef.current` (generated once per
  window; orders keep `${opId}-${i+1}` as idempotency keys) as the shipment number via
  `batchOrderOptions(group, comment, shipmentId)`; the single-order path passes none. The store
  sends `shipmentId` only when non-empty. `Transaction.shipmentId?` added.
- **Checks:** stand 1159/0 (+12; ticket 01's «comment is the last header» check now expects
  «Комментарий» second-to-last); vitest 2480 + 1 expected fail (+3); tsc clean. Mutations 5, all
  killed (main row 7, component row 2, edit keep 5, single archive 4, restore late cells 3 failing
  checks). No Yekaterinburg run (no dates).
- **Known limits:** peresort carrying the number (and the comment, ticket 01) is not covered by a
  stand check — no peresort harness exists; the ConfirmModal wiring is checked by a source regex
  (no DOM test library). Old combined shipments (21.09, 24.09) keep an empty «Отгрузка» and stay
  refused as a whole in ticket 03.
- **For ticket 03:** the whole-shipment set = rows sharing the anchor's `shipmentId` when set,
  else the existing OpID/moment grouping; `setTransactionComment` can be extended to a whole-shipment
  comment.
