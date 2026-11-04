# Ticket 08 — design contract (orchestrator, 2026-11-04)

Owner's answers 2026-11-04:
1. Pencil quantity edit of a row carrying «Упаковка недели» / «Счёт недели»: both fixed rouble sums stay on the
   row as they are; only the unit price changes. The week becomes «перераспределить»; a new step-1 save / step-2
   apply recomputes properly.
2. Peresort of a supply carrying fixed sums: the money of the supply is kept. An article that stays in the
   composition keeps its fixed sums whole; an article replaced completely passes its fixed sums to its
   replacement article(s). The week becomes «перераспределить».
3. «Перераспределить» is COMPUTED from the facts, never stored: the saved spread / step-1 set is compared with the
   current rows (pieces, boxes, whether the row exists). A supply deleted and restored unchanged clears it by
   itself; a hand edit of the sheet is caught too.
4. Shown only in the week window (a banner on top + a reconciliation block); computed only when the window loads.
   The «Поставки Озон» tab itself does not change.

Live state 2026-11-04 (read only): week 44 has invoice № 5477 (20 715,07) but no written-off supply (two orders of
31.10 wait for «Оформить»); week 43 has supplies but no invoice. The first real «Применить» is still unchecked.

## Invariant (all parts)
For every «Расход» row: «Упаковка недели» and «Счёт недели» are fixed rouble sums INSIDE «Сумма». No path except
`saveWeekPackaging` / `applyInvoiceSpread` changes those two cells or re-spreads them by pieces; every recompute
path computes «Сумма» WITHOUT them and adds them back in kopecks: Сумма' = base' + fixedP + fixedI,
Цена' = round2(Сумма' / qty').

## Part A — guards on the recompute paths (Code.gs + stand)
- Pencil (`updateTransaction`), «Расход» row with a non-empty fixed cell: the base price sent to the commit
  excludes the old fixed per-unit amount ((fixedP + fixedI) / old row qty), exactly like the extras share is
  excluded today; the re-written row gets both cells back unchanged and Сумма'/Цена' per the invariant. Row with
  empty cells: behaviour byte-for-byte as today.
- The pencil writes a new row ID: the rows of sheet «Доли счетов» pointing at the old ID are re-pointed to the new
  ID (shares unchanged), so the reconciliation keeps finding them.
- Peresort (`commitShipmentPeresort`): per answer 2. Kept article → its new row carries the old cells; a fully
  replaced article → its fixed sums go to the replacement row(s) of its peresort pairs (several replacements:
  split by pair qty, kopecks, largest remainder, ties → earlier pair). Σ fixedP and Σ fixedI over the order stay
  equal to the kopeck. «Доли счетов» rows re-pointed the same way (kept → new id of that article; replaced → the
  replacement row(s), shares split as the cells). Objects/tags «[Счёт № …]» are kept as they are.
- Receipt-price replay (`applyReplayCorrections`), ONLY rows with a non-empty fixed cell: Сумма' = Сумма +
  (computed − stored) in kopecks, Цена' = round2(Сумма'/q) (today Сумма' = round2(newPrice × q) loses kopecks of
  the fixed sums). Other rows unchanged.
- Already safe by construction — stand checks only, no code change expected: «Вся отгрузка»
  (`updateShipmentExtras`), single delete → restore, bulk delete → bulk restore. If a check fails, report — do not
  fix silently.

## Part B — staleness and reconciliation (Code.gs, read only)
`getInvoiceSpread(week)` additionally returns:
- `reconciliation: [{ invoiceId, allocatedKop, onRowsKop, ok, missingRows: [rowId], mismatchedRows: [{ id, article,
  cellKop, sharesKop }] }]` — allocatedKop = Σ selected lines of its applied input (`invoiceSelectionKopGs`);
  onRowsKop = Σ of its «Доли счетов» shares over rows that still exist in «История»; a row is mismatched when its
  «Счёт недели» cell (kop) ≠ Σ of ALL invoices' shares of that row id; ok = (onRowsKop === allocatedKop) and no
  missing and no mismatched rows of this invoice.
- `stale: { step1: [{ opId, articles: [..] }], invoices: [{ invoiceId, opIds: [..] }] }` — step 1: a non-component
  row whose «Упаковка недели» kop ≠ saved unit × current qty (the saved set of the week, override wins). Invoice:
  `weekSpreadTargetsGs` over the applied opIds' CURRENT rows ≠ its «Доли счетов» shares (any row id differs, or an
  applied op no longer exists, or a share differs). Empty arrays when nothing is applied/saved.
- `notInSpread: [{ opId, cabinet, orderNumbers }]` — operations of the week ticked in no applied invoice (only when
  at least one invoice is applied).

## Part C — store types + `WeekWindowModal`
Banner «Перераспределить» on top when `stale` is not empty: which supplies (order numbers) and which step to repeat
(«шаг 1» and/or «счёт № N»). Block «Сверка недели» per applied invoice: «распределено X ₽ · на строках Y ₽», green
✓ or red with the missing/mismatched rows (article). List «Не вошли в распределение». No new server action, no new
write.

## Tests (money tier)
Stand with `h.setScriptTimeZone('Asia/Yekaterinburg')`; synthetic data only; TZ=Asia/Yekaterinburg and TZ=UTC
runs; 3–5 mutations per part. A: one check per path (pencil qty edit, pencil comment-only edit, peresort kept +
replaced article, replay, «Вся отгрузка», delete/restore, bulk) — the fixed sums survive to the kopeck and the
latest journal cost = «Цена». B: qty edit → stale invoice + step 1, reconciliation still green; delete → red +
stale; restore unchanged → green and not stale; hand-edited «Счёт недели» → red; re-apply → green, not stale.
