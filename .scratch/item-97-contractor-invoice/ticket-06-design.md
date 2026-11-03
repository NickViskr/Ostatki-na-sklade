# Ticket 06 — design contract (orchestrator, 2026-11-03)

Owner's answers 2026-11-03:
1. «Прочее» is a contractor service: the invoice replaces it in step 2 (ticket 07) together with the other
   services. Step 1 has no «Прочее» and never touches it.
2. Which invoice lines are «упаковка/стикеровка» (compared with step 1; unticked by default in step 2): the app
   proposes the lines whose name starts with «стикеровк» / «упаковк» (case-insensitive), and the user can mark or
   unmark ANY line in the week window. The mark is stored per invoice line.
3. One price per article for the whole week (both cabinets, every supply); an expanded article may get its own
   price in one supply (override).
4. Prefill of «₽/шт»: the saved price of this week if any; else the latest saved week price of the article from an
   EARLIER week; else empty. Nothing is written until «Сохранить».
5. The Ozon cost journal is reconciled at once, on every step-1 save that touched a supply (KAN will see a second
   recalculation after step 2 — accepted).
6. Rights as invoices: the first save of a week by any user; changing a week that already has a saved step 1 —
   admin only.
7. A written-off posting without a detected handover belongs to the ISO week of its write-off's «Дата поставки»
   (Ekb). «Неделя вручную» always wins, then the detected «Неделя», then that fallback.
8. Known edge of ticket 05: «Корректировка» of a saved invoice is ALWAYS a correction of THAT invoice (admin), even
   when the number/date/supplier changed; if the new key equals ANOTHER saved invoice — refused.

Orchestrator decisions:
- A «supply» in the window = one write-off OPERATION (one OpID in «История»): an automatic write-off is one posting
  (`ozonAuto:<postingId>`), a manual one is one Ozon order (several postings, rows merged per article). Overrides are
  per operation + article.
- Kits: the price applies to the shipped (kit) article row; component rows (`isComponent`) carry nothing.
- Storage: a new «История» column «Упаковка недели» = the FIXED rouble sum of step 1 on that row (number, 2 dec).
  It is already inside «Сумма»/«Цена». `updateShipmentExtras` keeps it untouched by construction (it moves only
  the extras share), so the pencil/«Вся отгрузка» never re-spread it. Delete → restore must carry it
  (`RESTORED_LATE_CELLS`), otherwise a restored row would get it added twice on the next save.
- Weeks before 2026-W43 are refused (`CONTRACTOR_INVOICE_FIRST_WEEK`).

## Part A — pure module `src/lib/weekPackaging.ts` (+ twin in Code.gs, parity test)

- `isPackagingLineName(name)`: /^\s*(стикеровк|упаковк)/i.
- `invoiceLineIsPackaging(line)`: stored mark (`packaging: true|false`) wins, else `isPackagingLineName`.
- `weekArticleSummary(operations)` → `[{ article, qty }]` over non-component rows, sorted by article.
- `weekPackagingTargets(operations, prices, overrides)` → `{ ok, missing: string[], invalid: string[], rows: [{ id,
  opId, article, quantity, unitKop, targetKop }] }`. `prices` `[{ article, unit }]`, `overrides` `[{ opId, article,
  unit }]`, `unit` is TEXT parsed by `parseKopecks` (contractorInvoice.ts; ≥ 0, ≤ 2 decimals; '0' is a valid
  price). Override wins over the week price. targetKop = unitKop × quantity (integers only). An article of the
  week without a price → `missing`; an unparsable unit → `invalid` (naming the article); then ok = false.
- `step1TotalKop(rows)`, `invoicePackagingTotalKop(invoices)` (Σ line sums in kopecks of lines that are packaging,
  over every invoice of the week).
- Code.gs twin `weekPackagingTargetsGs(...)` with the same contract; `src/lib/twinRulesParity.test.ts` (or a new
  parity file) pins both on the same synthetic example.

## Part B — Code.gs

- `getTransactionSheet` ensures «Упаковка недели»; `RESTORED_LATE_CELLS` gains `['Упаковка недели',
  'weekPackaging', 'number']` (check the restore path reads it back).
- Sheet «Упаковка недели» (getOrCreateSheet): Неделя | Артикул | OpID ('' = week price) | ₽/шт | Сохранил |
  Сохранено. Неделя and OpID written as TEXT.
- `getWeekPackaging(week)` (any user) → `{ week, operations: [{ opId, cabinet, orderNumbers, postingIds, auto,
  date, rows: [{ id, article, quantity, isComponent, weekPackaging (number|null) }], textPackaging (RUB of an
  «Упаковка» tag in its extras, 0 if none) }], saved: { prices, overrides, savedBy, savedAt } | null, lastPrices:
  { [article]: unitText } }`.
  Operations of the week: «Внешние отгрузки» postings with status `processed`, not virtual, TransGroupInfo with
  History ids → those rows' OpIDs → all rows of each OpID (type «Расход»). Week of a posting per answer 7. An
  operation whose postings fall into different weeks is listed with `weekConflict: [weeks]`.
- `saveWeekPackaging({ week, prices, overrides }, user)`:
  1. week ≥ W43; targets via the twin; not ok → throw naming the article(s). Any `weekConflict` operation → throw
     «… поставьте «Неделю вручную»».
  2. A saved set for the week that differs from the input → `assertAdmin(user)`.
  3. Compute EVERYTHING before the first write. Per non-component row: newFixed = targetKop / 100;
     oldFixed = «Упаковка недели» (empty = 0). For an operation whose extras text carries «Упаковка»: that tag is
     removed and the extras re-spread exactly as `updateShipmentExtras` would with packaging 0 and everything else
     unchanged («Прочее», services, kept groups, comment untouched) — EXTRACT the compute part of
     `updateShipmentExtras` into a plan function used by both; `updateShipmentExtras`'s behaviour and outputs stay
     identical. A combined shipment («Отгрузка») that contains an operation NOT of this week → throw.
     Row: Сумма' = Сумма − oldFixed + newFixed (+ the extras delta from the plan), Цена' = round2(Сумма'/qty).
  4. Write only cells that change; rewrite the week's rows of sheet «Упаковка недели» only when the set changed.
     A repeat save with the same input writes NOTHING (no cell, no journal row).
  5. Journal: for every non-component row of every operation of the week whose latest journal cost differs from
     its «Цена» (not only rows changed in this run — a retry after a cut-off must heal), append through
     `reissueOzonCostRows`. A journal failure is reported as `costJournalError` (rows stay written), like
     `updateShipmentExtras`.
  6. Returns `{ changedRows, journalAppended, costJournalError, newTransactions }`.
- Invoice packaging mark: «Строки счетов» column 9 «Упаковка» ('да' | 'нет' | '' = by name).
  `listContractorInvoices` returns `packaging: boolean` per line (resolved). New action
  `setInvoiceLinePackaging { invoiceId, lineNo, packaging }` (any user). `saveContractorInvoice` writes column 9
  from `line.packaging` (true 'да', false 'нет', absent '').
- Register actions in doPost next to the ticket-05 ones; dev-mode/lock behaviour as the other write actions.

## Part E — invoice correction keeps its identity (Code.gs + modal)

- `saveContractorInvoice` input `editId`: assertAdmin; replaces THAT row even if the key changed; another stored
  row with the new key → throw «Счёт № N от D уже сохранён отдельно — исправление совпало с другим счётом. Ничего
  не записано.»; no «добавить ещё один?» confirmation on an edit. Week moves as today (PDF moves with it).
- `ContractorInvoiceModal` sends `editId` when opened on a saved invoice and round-trips `packaging` per line.

## Part C+D — store + screen

- Store: `getWeekPackaging(week)`, `saveWeekPackaging(payload)`, `setInvoiceLinePackaging(payload)`; body checked
  in `src/store/*.test.ts` (action name, everything under `data`).
- `OzonSuppliesTab`: button «Окно недели» → `WeekWindowModal` (large): week selector (`invoiceWeekOptions`),
  block «Счета недели» (list; open → `ContractorInvoiceModal`; per line a checkbox «упаковка»), block «Шаг 1 —
  упаковка/стикеровка»: per article «шт за неделю», «₽/шт» (prefill per answer 4), «Сумма»; expand → per
  operation (cabinet, order number(s), auto/manual, «своя цена»); «Итог шага 1», «Упаковка в счетах», «Разница»;
  «Сохранить» (disabled for a non-admin when the week is saved, with a note). Block «Шаг 2» — a placeholder
  «будет в следующем обновлении».

## Tests (money tier)

Stand `tests/apps-script/` with `h.setScriptTimeZone('Asia/Yekaterinburg')`; runs under `TZ=Asia/Yekaterinburg`
and `TZ=UTC`; 3–5 mutations per part. Ticket checklist: qty × unit per row kopeck-exact; repeat save writes
nothing; a manual write-off's «Упаковка» replaced, never added to (e.g. text 196 × 5 = 980 → step 1 6 ₽/шт: rows
carry 1 176, the extras text has no «Упаковка», «Прочее» intact); journal latest cost = «Цена» of every touched
row after save; a cut-off after the History writes then a retry heals the journal without doubling; delete →
restore keeps «Упаковка недели». Synthetic data only.
