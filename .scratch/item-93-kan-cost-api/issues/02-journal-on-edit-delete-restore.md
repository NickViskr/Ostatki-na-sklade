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
