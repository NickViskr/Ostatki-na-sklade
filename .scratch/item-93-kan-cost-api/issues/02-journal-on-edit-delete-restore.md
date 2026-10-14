# 02: The cost journal follows a pencil edit, a deletion and a restore of an Ozon shipment

**What to build:** when an Ozon shipment row is edited by the pencil (quantity, price, date), deleted
to «Удаленное» or restored from it, «Себестоимость Озон» rewrites the chain of that cabinet+article
from that supply onwards — exactly once, never as a second «отгрузка». A deletion leaves a row the
sender (ticket 03) can turn into a KAN `delete` of that date when no other shipment of the
article+cabinet is left on it; a restore puts the supply back. «Вся отгрузка» and receipt edits
keep working through `reissueOzonCostRows`. Spec: `../spec.md` (answers 2, 3; Implementation
Decisions). Money-critical.

**Blocked by:** 01 (its replay decides the exact holes; adjust this ticket to what 01 found).

**Status:** done 2026-10-14 (planner → coder → tester → orchestrator review fixes; result below); commit `9903b6e`, pushed to GitHub 2026-10-14 on the owner's word. Not deployed: Code.gs goes live in ticket 06 together with 03–05.

Design constraints:
- `getOzonCostState` (state = last row per cabinet+article in sheet order) and `isOzonCostCounted`
  must stay correct after every rewrite.
- Bases («Остаток до») of later rows stay as recorded (same rule as `reissueOzonCostRows`).
- The edited row keeps its OpID (`stampOpIdOnTransactions` already does it for «История»); the
  journal must stop writing an OpID-less blend row on edit.
- A combined shipment (several orders, one «Отгрузка» number) — each order's row by its OpID.
- Rows that are not shipments to Ozon (write-offs, other destinations) — journal untouched.

- [x] Stand: pencil edit of qty → the journal holds ONE corrected figure for that date and re-blended
      later dates; no extra «отгрузка» row
- [x] Stand: pencil edit of price/date → same, with the date moving correctly (old date dropped, new date written)
- [x] Stand: delete → chain without the supply; the deleted date is marked for KAN deletion when it was the only supply that day; not marked when another supply of that day remains
- [x] Stand: restore → the chain as before the delete, to the kopeck
- [x] Stand: unrelated articles/cabinets byte-for-byte untouched
- [x] Replay on the live xlsx export: new figures vs a hand recompute (vite-node harness)
- [x] Mutations 3–5; `TZ=Asia/Yekaterinburg` run

## Plan (planner 2026-10-14, approved by the orchestrator with amendments A1–A5)

Holes in scope: 1 edit (and the same class: re-sort `commitShipmentPeresort`, the legacy «услуги» save of
`ShipmentCostTab.tsx` that calls `updateTransaction` per row), 2 delete (single and bulk), 3 restore (single
`restoreArchivedItem` AND bulk `restoreMultipleArchivedItems`; what is really lost is OpID and «ДопРасходы» —
«Отгрузка»/comment are in the payload since item 90), and 4 — found 2026-10-14 by reading, confirmed by the
planner: `reissueOzonCostRows` walks every journal row of a cabinet|article, so an earlier
«пересчёт после правки прихода» row counts as another link and a change to a link with a later correction
re-blends that supply twice (live trigger: Миска_двойная / MaxiStore rows 89 → 93 → 94 → 95); it also appends
only changed rows, so when the tail's value does not move the last sheet row is not the tail and the state is wrong.

Design:
- **Chain model (pure).** Rows of one cabinet|article in sheet order → logical links in BLEND order (first
  appearance of the original row). Classification by «Источник» first: drop marker («удалено…»), correction
  («пересчёт…»), seed (no «Отгружено»), original. Link key `op:<OpID>`, or `row:<sheet row>` for an OpID-less
  original/seed (row 60 → `row:60`); an OpID-less correction/marker matches the single OpID-less original with
  the same (date, «Остаток до»). Orphan/ambiguous match or a duplicate original key → throw (that chain only).
- **Rewrite (pure)** `ops[key] = {drop:true} | {shipped, shippedCost, date}` (on a dropped link = revive).
  Recorded bases kept; blend as `reissueOzonCostRows`. Appended block, one `setValues`: E1 drop markers (newly
  dropped links + the OLD date of a moved link); E2 corrections from the first changed link to the tail (only
  changed links or costAfter moved > 0.005); E3 for every touched date, re-state its last alive link if it is
  not the date's last row in the block; E4 the block always ends with the tail's current version.
- **Drop marker row:** date, cabinet, article, sku, recorded base, '', «Отгружено» 0, '', «Себестоимость после»
  blank, link OpID, '', «удалено из цепочки». Correction sources: «пересчёт после правки отгрузки»,
  «пересчёт после удаления отгрузки», «пересчёт после восстановления отгрузки»; reissue keeps
  «пересчёт после правки прихода».
- **Readers.** `getOzonCostState`: a marker as the last row of a key → no state (next shipment takes the
  «первая отгрузка» branch). `getOzonCostExport`: pending rows of a (cabinet, article, date) whose last journal
  row is a marker are left out of the CSV and not stamped. Ticket 03 reads each (cabinet, article, date) by its
  last row: marker → KAN delete, otherwise upsert «Себестоимость после».
- **Resync** `resyncOzonCostForOps(opIds, source, options)`: derive each (cabinet, article) link of the given
  OpIDs from the CURRENT «История» (non-component «Расход», Ozon cabinet from «Объект», Σqty, value-weighted
  price, `roundToTwo`) and diff against the existing links of those OpIDs; only OpIDs the operation touched are
  passed (never resync an OpID with no History rows unless the operation deleted them). A new (cabinet, article)
  for an OpID that already has links elsewhere (re-sort to another article) → `appendOzonCostForShipment` with
  the real OpID. **A1:** the link's date is taken from History ONLY when the caller says the delivery date was
  edited (pencil edit); otherwise the link keeps its journal date — the 08-26 reconstructed links are dated
  08-23/08-25 while their History rows say 08-22.
- **Edit pre-checks (throw before any write, Russian text):** a pencil edit that changes the Ozon cabinet or
  turns a row into / out of an Ozon shipment is refused («удалите операцию и проведите её заново»); a delivery
  date moved outside [day of the previous alive link or seed, day of the next alive link] is refused (blend
  order must stay date order for KAN).
- **Re-commits** (`updateTransaction`, `commitShipmentPeresort`) call `commitTransaction` with a new last
  parameter `skipOzonCost` and resync afterwards. `isOzonCostCounted` unchanged; a fresh commit whose append
  reports `skipped > 0` (a retry of an OpID dropped by a delete) resyncs that OpID — the link revives in place.
- **Restore.** Both delete paths add `opId` and `additionalCosts` (number) to the archive payload; both restore
  paths write them back by header (`RESTORED_LATE_CELLS`), then resync. Old payloads restore as today.
- **OpID-less Ozon rows** (`5258f18d`): the History operation proceeds, the journal is untouched, the answer
  carries `costJournalError` «Строка без номера операции (OpID): журнал «Себестоимость Озон» не изменён — …».
- **Receipt edit:** `applyReplayCorrections` passes `opId`; `reissueOzonCostRows` resyncs entries with an opId
  and matches entries without one by day ONLY against alive OpID-less links.
- **Failure policy** unchanged: a journal failure never undoes the History operation (try/catch + Logger), and
  every path returns `costJournalError`. **A2:** showing it in the browser is ticket 05.
- **Ticket 06 entry point** `applyOzonCostChainOps(cabinet, article, ops, source)`: `{'row:60': {drop: true}}`
  for BowlGrayMini_01/MaxiStore; explicit `{shippedCost}` ops for `op:444547eb…` / `op:fe030a3b…` of
  Полка_выдв_27см/Mercurius (History rows `16e993f2` / `823cdb81` carry these OpIDs at 667.5 / 658.82).
- **A3** one coder run (pure core + reissue + readers first, then the wiring). **A4** expected figures of every
  stand check come from a script, and fixtures set the stock average so the re-committed price is known (the
  edit re-prices at the current average). **A5** the live replay (R1–R9 of the plan) is run by the orchestrator.

Known limits kept: same-day orders blended on one base (item 95); a re-sort over several OpIDs stamps
everything with the first OpID, so the other orders' links drop and their pieces join the first link (follows
«История»); the four 2026-08-01 seed-era links whose journal OpID is a History row id are not reached by a
resync; until ticket 03 ships, a deleted date is left out of the CSV and stays in KAN — deploy 02 with 03.

## Result (2026-10-14)

Code: `Code.gs` (+757 / −92 lines: chain core, resync, edit pre-check, wiring), `tests/apps-script/run-tests.cjs`
(block «93/02», 79 checks), `tests/apps-script/harness.cjs` (6 exports). No `src/` change, no new proxy action.

- **Chain core** (`Code.gs` ≈2336–2870): `isOzonCostDropRow`, `ozonCostRowKind`, `ozonCostLinkNow`,
  `buildOzonCostChain`, `planOzonCostChainRewrite` (markers first, then every re-stated link once in blend
  order; the tail always last; a seed re-stated when it is the last alive entry of a touched day or the tail),
  `appendOzonCostRows`, `applyOzonCostChainOps` (ticket 06 entry point; the source MUST start with «пересчёт»,
  otherwise refused — any other text would be read back as a second original and make the chain unreadable;
  found by the live replay, guarded and tested), `ozonShipmentsByOpFromHistory`, `resyncOzonCostForOps`
  (only a re-sort may add a link: `options.allowNewLinks`), `followOzonCostJournal`,
  `assertOzonShipmentEditAllowed`; `reissueOzonCostRows` re-implemented on the chain (hole 4 closed).
- **Wiring:** `commitTransaction` last param `skipOzonCost` + revival of a dropped OpID on a fresh commit;
  `updateTransaction` (pre-checks before any write; Russian refusals for a cabinet change and a delivery date
  outside its neighbours), `commitShipmentPeresort`, `deleteTransaction`, `deleteMultipleTransactions`,
  `restoreArchivedItem`/`restoreTransaction`, `restoreMultipleArchivedItems` (OpID and ДопРасходы — as a number —
  in the archive payload and written back), `getOzonCostState` (marker last → no state), `getOzonCostExport`
  (markers and marker-ended days left out of the CSV and not stamped). Every path returns `costJournalError`
  (Russian) instead of throwing after «История» was written; showing it is ticket 05.
- **For ticket 03 (sender):** read each (cabinet, article, date) by its LAST journal row — source
  «удалено из цепочки» (`isOzonCostDropRow`) = KAN `delete` of that date, anything else = upsert
  «Себестоимость после». Correction sources: «пересчёт после правки отгрузки / удаления отгрузки /
  восстановления отгрузки / правки прихода». Markers carry «Отгружено» 0 and an empty «Себестоимость после».
- **Tests:** stand 1202 → 1281 checks, 0 failed, also with `TZ=Asia/Yekaterinburg`; `gasActions` +
  `twinRulesParity` vitest 21/21. Mutations: tester 5/5 killed (corrections read as originals, no E3, no E4,
  edit commits without `skipOzonCost`, restore without OpID) plus 2 extra (seed tail, moved-day E3 — the latter
  survived and got a new check); review fixes 3/3 killed (source guard, re-sort-only new links, seed on a
  touched day). A throwaway property run of the coder (≈10 500 random edit/delete/restore/date steps) found 0
  mismatches against a recompute from «История».
- **Live replay** (fresh xlsx export 2026-10-14 15:46 Yekaterinburg, journal 94 rows, «История» 405, «Удаленное»
  28; the new `Code.gs` in a mirror of the stand; scratchpad `replay02.cjs`), 21/21 OK: every chain builds;
  row 60 is the only OpID-less link; chains are date-monotonic; last-row state = chain tail everywhere. No-op
  resync of every OpID with History rows writes nothing except the two Полка_выдв_27см OpIDs (444547eb,
  fe030a3b — the ticket-01 distortion). Edit `3f46562f` 234 → 230: ONE row 10-09 241.17 = (466·221.41 +
  230·281.22)/696. Delete: marker 10-09 + 09-28 tail 221.41. Restore: state 241.14, per-day view equal to
  before the delete, OpID and ДопРасходы 10771 back. Ticket-06 dry runs: `{'row:60': {drop: true}}` →
  225.60 / 224.12 / 223.93 / 222.69 / 241.99; Полка_выдв_27см by explicit costs or by one resync of both
  OpIDs → 667.50 / 659.21 / 656.54 / 709.51. Hole 4 on live data: today's `Code.gs` turns a +10 ₽ receipt
  correction of Миска_двойная 10.10 into 4 rows ending at 246.79; the new code writes 2 rows, 247.04 / 246.51.
- **Known limits:** restore is exact to the kopeck except for the five reconstructed August links that carry
  ±0.01 ₽ drift (Органайзер_2_пол_белый 08-01/08-02, Органайзер_3_пол_PureWhite 08-06/08-07/08-22) — deleting
  an August shipment before them and restoring it re-derives them by the formula; same-day orders blended on
  one base (item 95); a re-sort over several OpIDs follows «История»; the four seed-era links whose OpID is a
  History row id are not reached by a resync; until ticket 03 ships a deleted day is left out of the CSV and
  stays in KAN — deploy 02 with 03; a pencil edit can no longer move an Ozon shipment to another cabinet or
  across a neighbour's date (delete and re-enter instead) — the owner should see these two refusal texts.
- **Noticed in passing (outside item 93):** `restoreMultipleArchivedItems` writes back only columns 1–10, so
  «Пользователь», «groupId», «isComponent» come back empty (kit components return as plain rows; the journal is
  now guarded against it); a default admin password literal sits in `setupDatabase` / the users bootstrap of
  `Code.gs` in the public repo.

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
