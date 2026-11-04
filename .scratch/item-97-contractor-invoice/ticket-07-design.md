# Ticket 07 — design contract (orchestrator, 2026-11-04)

Owner's answers 2026-11-04:
1. Several invoices in a week: each invoice is spread ON ITS OWN (choose the invoice, tick its lines and the
   supplies, «Применить»). A second invoice's shares ADD to the first one's. Re-applying an invoice replaces
   only its own previous shares.
2. Rights as step 1: the first apply of an invoice — any user; changing an applied spread (other lines,
   quantities or supplies) — admin only; a repeat with the same input — anyone (and writes nothing).
3. On a History row: a new column «Счёт недели» (the FIXED rouble sum of ALL invoice shares on that row) AND a
   tag in «Объект» per invoice: `[Счёт № <number> от <date>: <operation share>₽]` (the share of the whole
   operation, 2 decimals with a comma, e.g. `412,37`).
4. A missing box norm = the SKU card has no row, or «штук в коробе» is empty, 0, negative or not a number.
   Then the spread is refused naming the article(s). NOTE: `getSKUs` reads an empty cell as 1 — the spread must
   read the RAW cell. Nothing else in the app changes.

Carried over from ticket 06 / the task: «Прочее» is a contractor service — the invoice replaces it together
with «Услуги» on every ticked supply; «Упаковка» (text tag) and «Упаковка недели» are NOT touched by step 2.
Only lines with «На поставку» = да are offered; lines marked «упаковка» are unticked by default («учтено в
шаге 1») but may be ticked.

Orchestrator decisions:
- A «supply» = one write-off operation (OpID), as in step 1 (`weekPackagingOperations`). All supplies of
  the week are ticked by default. The orders of one combined shipment («Отгрузка») are ticked together; a
  combined shipment with an order of another week, or a ticked/unticked mix inside one shipment → refused.
- Quantity per line: default the full line qty; the user may lower it (> 0, ≤ line qty, up to 3 decimals).
  Line amount = the line's «Сумма» when the full qty is taken; otherwise qtyMilli × priceKop / 1000 half-up.
- Split, integers in kopecks, largest remainder (ties → earlier index) at every level:
  total → operations by the operation's boxes → rows by the row's boxes. Boxes of a row =
  ceil(qty / pcsPerBox) of its own article (a kit row by the kit's card); component rows and qty ≤ 0 rows carry
  nothing and need no norm.
- Unallocated remainder = invoice total − Σ ticked line amounts (shown).
- Storage:
  - History column «Счёт недели» (number, 2 dec) inserted before «Комментарий» like «Упаковка недели»;
    getTransactions returns it as `weekInvoice`; restore carries it (`RESTORED_LATE_CELLS` + bulk restore),
    `rowSharesAfterExtrasGs` and its TS twin treat it as goods-like (like `weekPackaging`).
  - Sheet «Доли счетов»: ID счёта | Неделя | OpID | ID строки | Доля (₽) | Применил | Применено — the
    shares of every applied invoice per row.
  - Sheet «Распределения счетов»: ID счёта | Неделя | Строки (JSON [{n, qty}]) | Поставки (JSON [opId]) |
    Применил | Применено — the applied input, for the rights check and the screen's prefill.
- Apply = `applyInvoiceSpread({ week, invoiceId, lines: [{ n, qty }], opIds: [..] }, user)`, under the lock:
  1. Validate (week ≥ W43, invoice of that week, lines exist, toSupply, qty valid, ≥ 1 line, ≥ 1 op, norms).
  2. Compute EVERYTHING before the first write. For each ticked op whose «Объект» carries «Услуги»/«Прочее»:
     `planShipmentExtrasEdit(shipmentRows, anchor, { packagingMode:'batch', packagingValue: original.packaging,
     otherMode:'batch', otherValue:0, services:[] })` (one plan per shipment). Row target:
     weekInvoice' = Σ over invoices of this row's shares, THIS invoice's share being the new one (rows of ops
     no longer ticked lose this invoice's share); Сумма' = (plan total or Сумма) − weekInvoice(row cell) +
     weekInvoice'; Цена' = round(Сумма'/qty); «Объект» = plan destination with this invoice's tag replaced
     (other invoices' tags kept).
  3. Writes, in this order: the two sheets (target state for this invoice) → History rows, ONE setValues per
     row covering the whole row (so a cut-off never leaves half a row). Because the row target is computed from
     the row's own «Счёт недели» cell and the shares sheet, a retry after a cut-off anywhere completes without
     doubling. A repeat with the same input writes nothing.
  4. Journal: `weekPackagingStaleJournalEntries` over every non-component row of every op touched now or
     before by this invoice, then `reissueOzonCostRows`; failure → `costJournalError`, rows stay written.
  5. Returns `{ changedRows, journalAppended, costJournalError, newTransactions }`.
- `getInvoiceSpread(week)` → `{ operations: [{ opId, cabinet, orderNumbers, auto, shipmentId, rows:[{ id,
  article, quantity, isComponent, pcsPerBox (number|null) }], services (₽ of «Услуги»+«Прочее» now) }],
  applied: [{ invoiceId, lines, opIds, appliedBy, appliedAt }] }`; invoices come from `listContractorInvoices`.
- Not in this ticket (08): re-spread guards on pencil/re-sort/«Вся отгрузка», the «перераспределить» mark,
  the week reconciliation view. Invoice delete does not undo a spread.

## Part A — pure `src/lib/weekSpread.ts` + Code.gs twins + parity test
`invoiceSelectionKop(lines, selections)` → `{ ok, errors[], selectedKop, unallocatedKop, totalKop }`;
`splitKopByWeights(totalKop, weights)`; `weekSpreadTargets(totalKop, operations, pcsPerBox)` →
`{ ok, missing[], operations:[{ opId, cabinet, boxes, shareKop, rows:[{ id, article, boxes, shareKop }] }],
byCabinet: { [cabinet]: kop } }`. Twins `invoiceSelectionKopGs`, `splitKopByWeightsGs`, `weekSpreadTargetsGs`.

## Part B — Code.gs: storage, `getInvoiceSpread`, `applyInvoiceSpread`, doPost actions, stand checks.
## Part C — store (`getInvoiceSpread`, `applyInvoiceSpread`, body tests) + step 2 in `WeekWindowModal`.

## Tests (money tier)
1299 over 120/45/75 pcs in boxes — Σ row shares = 1299.00 exactly; missing norm blocks; unticked lines stay
unallocated; repeat = no change; replacement of an invoice; second invoice adds; cut-off then retry without
doubling; latest journal cost = «Цена» of every touched row; manual write-off's «Услуги»/«Прочее» removed,
«Упаковка» intact. Stand with `h.setScriptTimeZone('Asia/Yekaterinburg')`; TZ=Asia/Yekaterinburg and TZ=UTC;
3–5 mutations per part. Synthetic data only.
