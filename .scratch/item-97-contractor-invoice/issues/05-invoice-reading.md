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

**Status:** ready-for-agent

- [ ] Pure checks unit-tested on SYNTHETIC invoices (incl. a kopeck line like 9022.74, a wrong sum, a missing line)
- [ ] The four real invoices read correctly — checked locally only, never committed (INNs, bank accounts)
- [ ] Duplicate number+date → confirmation; replacement keeps one invoice

## Comments
