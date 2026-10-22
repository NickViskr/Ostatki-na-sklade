# 01: Prerequisites from item 96 — the services gear (96.1), kopecks (96.12 + 96.13), retry after a partial failure (96.10)

**What to build:** the four item-96 fixes item 97 cannot work without, in this order, each reproduced as a
FAILING check first (stand `tests/apps-script/` or vitest), then fixed. Plan T0. Spec: `../spec.md`. Full
findings: plan item 96 in `docs/OZON_PLAN.md`; the ChatGPT report and probes (scenarios, numbers) are
outside the repo in `../review/chatgpt-2026-10-20/pass-1/` (`report-pass-1-chatgpt.md` sections P1-04,
P1-11, P1-12, P1-01; probes `probes/b-extras.cjs`, `probes/a-core.cjs`; verdicts `verification-pass-1.md`).
Money tier: whole path, 3–5 mutations per part, a separate tester agent.

**Blocked by:** —

**Status:** ready-for-agent

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

## Comments
