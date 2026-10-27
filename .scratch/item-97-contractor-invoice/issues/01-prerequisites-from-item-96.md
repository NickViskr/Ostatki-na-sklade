# 01: Prerequisites from item 96 — the services gear (96.1), kopecks (96.12 + 96.13), retry after a partial failure (96.10)

**What to build:** the four item-96 fixes item 97 cannot work without, in this order, each reproduced as a
FAILING check first (stand `tests/apps-script/` or vitest), then fixed. Plan T0. Spec: `../spec.md`. Full
findings: plan item 96 in `docs/OZON_PLAN.md`; the ChatGPT report and probes (scenarios, numbers) are
outside the repo in `../review/chatgpt-2026-10-20/pass-1/` (`report-pass-1-chatgpt.md` sections P1-04,
P1-11, P1-12, P1-01; probes `probes/b-extras.cjs`, `probes/a-core.cjs`; verdicts `verification-pass-1.md`).
Money tier: whole path, 3–5 mutations per part, a separate tester agent.

**Blocked by:** —

**Status:** done 2026-10-27 — built and tested, NOT deployed (see «Result»)

## Part A — 96.1 (P1-04): the services gear on «Отгрузка» double-charges

The gear «Редактировать доп. услуги поставки» (`src/components/ShipmentCostTab.tsx` ≈:1101, visible to every
user) runs `recalculateGroupWithNewServices` (≈:212, spreads services by VALUE) and `handleSaveServices`
(≈:481) re-commits each row through `updateTransaction`; the server then adds the services from the new
text again: A 100 + B 900 + service 100 → 210 + 1090 (1300 instead of 1100), and the figure reaches the
Ozon journal / KAN. Its label parser is also case-sensitive. Fix direction from the review: one editor —
the gear goes through `updateShipmentExtras` («Вся отгрузка», `WholeShipmentModal`), no per-row re-commit.
ASK THE OWNER first (AskUserQuestion): (a) the gear opens «Вся отгрузка» (recommended — one tested path),
or (b) the gear is removed (under item 97 contractor services come from invoices only).

- [ ] Failing check first: 100 + 900 + service 100 through the gear's real handler → expected 150 / 950
      (split by pieces, 1 pc each); stock and write-off cost unchanged; «упаковка:» and «Упаковка:» read alike
- [ ] `recalculateGroupWithNewServices` / the per-row re-commit gone (no second money path)

## Part B — 96.12 + 96.13 (P1-11, P1-12): kopecks

- 96.12: each row's share of the extras is rounded on its own — commit `Code.gs` ≈:3396, `updateShipmentExtras`
  ≈:11541–11542, the client mirror `src/lib/shipmentExtras.ts` — 1.00 over three 1-pc rows gives 0.99, 2.00
  gives 2.01. Use the largest-remainder split already in `splitByQuantityGs` / `splitByQuantity` inside an
  order too. When re-spreading, take off the share the row REALLY carries, not one recomputed the new way
  (rows written by the old rounding exist).
- 96.13: service sums are rounded to whole roubles — `extrasTotalGs`, `buildDestinationGs` (`Code.gs`),
  `shipmentExtras.ts` ≈:160 and ≈:189, the original form `ConfirmModal.tsx` ≈:496. Owner question 5 of item
  96 is answered by evidence (2026-10-22): rates with kopecks exist (invoice «Хранение товара» 9 022,74) and
  invoice shares will carry kopecks. Old texts written in whole roubles must parse to the same amounts as
  before (backward compatibility); the twin-rules parity test (`src/lib/twinRulesParity.test.ts`) must cover
  the new arithmetic on both sides.

- [ ] Failing checks first: 1.00 and 2.00 over three 1-pc rows sum exactly on create, «Вся отгрузка» and a
      repeat save; service 100.40 × 1 on 1 pc @ 100 → price 200.40, text keeps 100.40; a service sum not
      divisible by its quantity (e.g. 100.01 × 3) keeps every kopeck
- [ ] An old whole-rouble text gives the same total as before the change
- [ ] Parity test green on the new arithmetic

## Part C — 96.10 (P1-01): a retry after a partial failure deducts twice

`commitTransaction` flushes the stock (`Code.gs` ≈:3444) before appending «История», and the opId guard
(≈:3081) looks only in «История». A failure between the two writes plus a retry with the same opId (forms
keep it) deducts again: 10 @ 100, expense 2, fail after the stock write → 8 / 800; retry → 6 / 600 with one
history row. Simply swapping the two writes is NOT a fix (the review). Direction: persist the operation's
state (original and planned values) before the first stock change; a retry completes or restores that same
operation. Propose the design to the owner in plain words before coding. Must land before ticket 03 — the
automatic write-off retries by itself.

- [ ] Failing check first: inject a failure at EACH write stage (stock, «История», cost journal), retry the
      same opId, assert stock, «История» and the journal together (one operation, 8 / 800)
- [ ] No change for the normal path (existing stand checks green)

## Not in this ticket

Deployment: `Code.gs` HEAD already carries item 93 tickets 02–04, not deployed (they ship in item 93 ticket
06). Decide with the owner when these fixes go live — with item 93 ticket 06, or separately (Part A's browser
part is Cloud Run only). Do not touch `docs/OZON_PLAN.md` from a code task; push only on «отправляй в гитхаб».

## Result (2026-10-27)

Built, reviewed (/code-review, two axes, findings fixed), NOT deployed: Code.gs and Cloud Run go live together
with item 93 tickets 02–06 or separately — the owner decides. Pipeline: coder agents wrote the code; the tester
agent re-checked the tests the orchestrator had written for parts A–B and wrote every test of part C first.

- **Part A (96.1).** The «Отгрузка» services gear and its value-spread re-commit are removed
  (`recalculateGroupWithNewServices`, `parseExtraCostsFromDestination`, `resolveRedistributedTransactions`, the
  modal). The trash of a product deletes the row and its kit components through `shipmentRowDeleteIds` like
  «История»; nothing is re-committed; the dialog no longer promises a re-spread. Orphans removed:
  `parseStoredServiceEntries` / `StoredServiceEntry` (`src/lib/serviceRates.ts`) and their 7 unit tests.
- **Part B (96.12 + 96.13).** Commit and «Вся отгрузка» split an order's extras over its rows by largest
  remainder (`splitByQuantityGs` / `splitByQuantity`); with a stated piece total (the pencil re-commit) the row
  keeps its own rounded share. A re-spread takes off the share a row really carries: d = «Сумма» − goods
  (write-off cost + same-groupId components) when d lies in floor..ceil of the exact proportional share in
  kopecks (position-independent — a no-op pencil re-save moves the row to the end of the sheet), otherwise the
  split share. Service sums to the kopeck (`serviceSumTextGs` / `serviceSumText`: «100» or «100.40»), parsed unit
  cost not rounded, the confirmation form writes the same format. Twins: `rowSharesAfterExtrasGs` ↔
  `rowMoneyAfterExtras`; parity test extended (kopeck sums, old-rounding rows, kits). Live «История» of
  2026-10-22 (read-only xlsx): 94 distinct «Объект» texts, 72 with services, 0 with a fractional service sum —
  0 totals and 0 rebuilt texts differ from the old parser.
- **Part C (96.10).** `commitTransaction` with an opId saves a memo in Script Properties before its first
  «Остатки» write (`pendingOp:<opId>:0..n`, ≤ 2500 characters per part; dev mode `pendingOpDev:`), sets
  `…:stockWritten` right after the stock write, deletes everything when all stages succeeded (a
  costJournalError keeps it). Stages: stock / history (by the flag, then stock = «before» / «after») /
  journal / done / conflict. A retry with the same opId completes the operation or refuses (conflict) — no
  second deduction. `getPendingOperations`, `getInitialData.pendingOperations` (busy lock → only readable memos
  ≥ 7 min old), doPost `resolvePendingOperation` (admin only: complete / cancel / dismiss; complete only for
  memos of the «Провести» action and it links the Ozon postings too; China posting / unshipped return →
  cancel, then repeat in the module). Popup `PendingOperationsModal` («Операция не завершена») for every user,
  buttons for the admin, «Позже» until the next start.
- **Checks.** Stand 1521/0 (+57 for this ticket: T0-B 26, T0-C 31), vitest 68 files 2539 passed + 1 expected
  fail, `TZ=Asia/Yekaterinburg` on the six affected files 79/79, tsc clean. Mutations: A 7, B 13 + 5 (window),
  C 11 + 9 (UI) + 11 (review round) — every survivor got a check.
- **Found in passing:** the «Отгрузка» trash re-spread (not in the ChatGPT report; stand: 1069.84 instead of
  1090). The pencil path (`updateTransaction`) still re-derives a row's share on its own (out of scope).
- **Open for the owner:** when T0 goes live; the ticket's Part A sweep of live «История» for rows damaged by the
  gear (together with the item-80 tail) is not done.

## Comments

Owner's decisions, 2026-10-22 (this session):
- Part A: the services gear on «Отгрузка» is REMOVED (not routed to «Вся отгрузка»). Found in passing: the
  trash of a product inside a «Отгрузка» card re-spread the extras over the remaining rows by value and
  re-committed them (stand: A 100 + B 900 + C 100, service 90, delete C → 1069.84 instead of 1090; not in the
  ChatGPT report). Owner: the trash deletes the way «История» does — the row and its kit components, with its
  own share of the extras; the other rows are not touched; the dialog no longer promises a re-spread.
- Process: tests are written by the tester agent, not by the orchestrator (the owner stopped the orchestrator
  writing them). The tests of parts A and B, already written by the orchestrator, are re-checked independently
  by the tester (review, gaps, 3–5 mutations per part); in part C the tester writes the failing tests first.
- Part C design (agreed): before the first stock write the server saves a memo of the operation — its
  content (items, type, object, dates, extras, comment, shipment number) and, per touched stock row, the
  values before and after — in HIDDEN storage (Script Properties, split into parts when large); every stage
  succeeded → the memo is deleted. A retry with the same opId reads the memo first: stock = «before» →
  the operation runs normally; stock = «after» and no «История» rows → «История» and the journal are
  written, no second deduction; «История» present but no journal → the journal is completed; stock
  neither «before» nor «after» → nothing is written, a clear refusal, the memo stays.
  A stuck memo shows a popup «Операция не завершена» at every app start until resolved: what stuck
  (opId, when, who, articles, stage), buttons «Довести до конца», «Отменить операцию» (only when no
  «История» rows exist and the stock still equals «after»; restores «before»), «Разобрано, убрать
  уведомление» when the stock changed since (with what to check by hand), «Позже». EVERY user sees the
  popup; the buttons work for the ADMIN only (others see the description and «обратитесь к
  администратору»).
