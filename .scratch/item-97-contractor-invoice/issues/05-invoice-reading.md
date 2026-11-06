# 05: Invoice reading and checks

**What to build:** plan T4. A PDF uploaded to a week is read by Gemini through the proxy (the pattern of
`/api/parse-invoice` and `src/lib/chinaAiRead.ts`: the AI only copies cells, never computes money) into a
header (number, date, supplier, buyer, «Всего к оплате», VAT) and lines (name, qty, unit, price, sum). The
app checks to the kopeck: qty × price = sum per line, Σ lines = «Всего к оплате», line count = «Всего
наименований N». A failed check blocks saving until the user fixes the line by hand (the PDF beside it);
manual entry is always possible. Saved to an invoice sheet + a lines sheet. The same supplier + number + date
again → «это замена ранее загруженного счёта?» — a replacement only on confirmation. Spec: `../spec.md`
(«Facts»: two templates, scrambled columns, two PDFs № 5116). Money-adjacent: the checks are the guard.

**Blocked by:** 04.

**Status:** rolled back 2026-11-06 — dormant, see ../rollback-plan.md (was: done (live 2026-11-03, owner's live check pending))

- [x] Pure checks unit-tested on SYNTHETIC invoices (incl. a kopeck line like 9022.74, a wrong sum, a missing line)
- [ ] (owner's live check via «Распознать») The four real invoices read correctly — checked locally only, never committed (INNs, bank accounts)
- [x] Duplicate number+date → confirmation; replacement keeps one invoice

## Comments

2026-11-03 (orchestrator): DONE in four parts — A `18fc809` (pure checks + service week), B `7a8d9e8` (Code.gs sheets/actions, twin parity), C `cf7445b` (proxy `/api/contractor-invoice/read` + store), D `cf9dad7` (screen). Contract with the owner's answers: `../ticket-05-design.md`. Mutations: A 5/5 killed; B 6 (two survivors got checks 1c, 1d). Full set: vitest 2917 + 1 expected fail (default, Yekaterinburg, UTC), stand 1788/0, tsc clean. LIVE: Code.gs @215 + Cloud Run `sklad-00120-hvc`. Real invoices: the Gemini key exists only in Script Properties, so they are checked live by the owner (`../real-invoice-check.ts` is the local alternative with GEMINI_API_KEY in the environment). Known edge for ticket 06: editing the NUMBER of a saved invoice makes a new key, so saving offers «добавить ещё один» instead of replacing.

2026-11-03 (orchestrator): owner's live check — recognition works, but unrelated services (storage etc.) could not be dropped: deleting lines broke the whole-invoice checks. Owner chose a per-line «На поставку» tick (unticked lines stay in the invoice and in the checks; «Строки счетов» column 8 да/нет) plus a «⋯» menu «Корректировка»/«Удалить» instead of «×». Commit `b017f7f`, live Code.gs @216 + `sklad-00121-ztj` (clone+cmp OK, 35/35 files equal). Ticket 07 spreads only ticked lines.
