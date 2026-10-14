# 02: The cost journal follows a pencil edit, a deletion and a restore of an Ozon shipment

**What to build:** when an Ozon shipment row is edited by the pencil (quantity, price, date), deleted
to «Удаленное» or restored from it, «Себестоимость Озон» rewrites the chain of that cabinet+article
from that supply onwards — exactly once, never as a second «отгрузка». A deletion leaves a row the
sender (ticket 03) can turn into a KAN `delete` of that date when no other shipment of the
article+cabinet is left on it; a restore puts the supply back. «Вся отгрузка» and receipt edits
keep working through `reissueOzonCostRows`. Spec: `../spec.md` (answers 2, 3; Implementation
Decisions). Money-critical.

**Blocked by:** 01 (its replay decides the exact holes; adjust this ticket to what 01 found).

**Status:** ready-for-agent — decomposition not obvious: run the planner first.

Design constraints:
- `getOzonCostState` (state = last row per cabinet+article in sheet order) and `isOzonCostCounted`
  must stay correct after every rewrite.
- Bases («Остаток до») of later rows stay as recorded (same rule as `reissueOzonCostRows`).
- The edited row keeps its OpID (`stampOpIdOnTransactions` already does it for «История»); the
  journal must stop writing an OpID-less blend row on edit.
- A combined shipment (several orders, one «Отгрузка» number) — each order's row by its OpID.
- Rows that are not shipments to Ozon (write-offs, other destinations) — journal untouched.

- [ ] Stand: pencil edit of qty → the journal holds ONE corrected figure for that date and re-blended
      later dates; no extra «отгрузка» row
- [ ] Stand: pencil edit of price/date → same, with the date moving correctly (old date dropped, new date written)
- [ ] Stand: delete → chain without the supply; the deleted date is marked for KAN deletion when it was the only supply that day; not marked when another supply of that day remains
- [ ] Stand: restore → the chain as before the delete, to the kopeck
- [ ] Stand: unrelated articles/cabinets byte-for-byte untouched
- [ ] Replay on the live xlsx export: new figures vs a hand recompute (vite-node harness)
- [ ] Mutations 3–5; `TZ=Asia/Yekaterinburg` run

## Comments

- 2026-10-14, from ticket 01 (replay of the real `Code.gs` on the live export, details in
  `01-diagnosis-and-reconciliation.md` «Result»): holes 1 (edit → second OpID-less «отгрузка» row,
  +10.82 ₽/pc on the test row) and 2 (delete → journal untouched, both `deleteTransaction` and
  `deleteMultipleTransactions`) confirmed. Hole 3, new and in scope here: a restore loses the row's
  OpID, «ДопРасходы» and «Отгрузка» — `archiveItem` in `deleteTransaction` stores none of
  `opId`/`additionalCosts`, so `restoreTransaction` writes them empty; the restore cannot find its
  journal row by OpID and a later edit re-parses the extras from the text. The archive payload must
  carry them (old archive rows without them stay restorable).
- Live journal rows that need the same chain rewrite once (written in ticket 06, decided by the owner):
  row 60 (BowlGrayMini_01 / MaxiStore, OpID '', re-blend of 12.09) and rows 40–41 (Полка_выдв_27см /
  Mercurius, a reverted receipt edit). Build the chain rewrite so ticket 06 can reuse it for them.
- An empty-OpID journal row exists in production (row 60): the new code must not treat '' as a
  shipment key, and «История» row `5258f18d` has no OpID either.
