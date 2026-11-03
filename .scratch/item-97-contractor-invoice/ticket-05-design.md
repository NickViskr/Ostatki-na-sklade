# Ticket 05 — design contract (orchestrator, 2026-11-03)

Owner's answers 2026-11-03:
1. «Распознать» sits on every PDF row of the «Файлы недели» block (next to «Скачать»).
2. The week window (tickets 06–07) will be a large modal opened by a «Окно недели» button in «Поставки Озон»;
   in this ticket the invoice form is its own modal and later becomes part of that window.
3. The service week of an invoice: the app proposes the ISO week BEFORE the invoice date (invoice of
   02.11.2026, Monday of W45 → 2026-W44) and the user confirms or corrects it. Required to save.
4. If the confirmed week differs from the week folder the PDF lies in, saving MOVES the PDF to the
   confirmed week's folder (invoice and its PDF always in one week).
5. A week may hold several invoices with different numbers: saving another one asks
   «У недели … уже есть счёт № …, добавить ещё один?».
6. Any logged-in user recognizes and saves a NEW invoice; only an admin replaces or deletes a saved one.

Orchestrator defaults: if the template has no «Всего наименований N», that check is skipped and the form
says so (the other two checks always apply). VAT is copied from the invoice, never checked or computed.
Weeks before 2026-W43 are refused (spec: the new rules start with W43). Real invoices never enter the repo.

## Part A — pure module `src/lib/contractorInvoice.ts` (+ `src/lib/isoWeek.ts`)

Types (all values are TEXT exactly as read; the AI never computes):
- `ContractorInvoiceHeader { number, date, supplier, buyer, total, vat, itemCount }` — `date` as
  `dd.MM.yyyy`, `itemCount` '' when the template has none.
- `ContractorInvoiceLine { name, qty, unit, price, sum }`.
- `ContractorInvoiceDraft { header, lines }`.

Functions:
- `contractorInvoiceNormalise(raw: unknown): ContractorInvoiceDraft | null` — AI JSON → draft: every field
  to trimmed text (numbers via `String`), missing → ''; dates `yyyy-MM-dd` / `d.M.yyyy` / «12 октября 2026 г.»
  → `dd.MM.yyyy` text without `Date` objects; `null` when not an object or `lines` is not an array.
- `parseKopecks(text): number | null` — «9 022,74», «9022.74», «1 299», NBSP/thin spaces, optional «₽»/«руб.»
  → integer kopecks; more than 2 decimals, letters, empty, negative → null. No float arithmetic for the result.
- `parseQtyMilli(text): number | null` — quantity in thousandths (up to 3 decimals), > 0, else null.
- `checkContractorInvoice(draft): { ok, headerErrors: string[], lineErrors: {index, message}[], notes: string[] }`:
  number, date (valid calendar day), supplier required; total parses; at least one line; per line: name,
  qty, price, sum parse; qty × price = sum to the kopeck (sumKop === floor((qtyMilli·priceKop + 500) / 1000), i.e. the
  sum is the product rounded half-up; integers only); Σ line sums = total exactly; line count = itemCount when itemCount
  is given, else a note «В счёте нет строки «Всего наименований» — проверка числа строк пропущена».
  Messages name the line number (1-based) and both amounts with kopecks, e.g.
  «Строка 3: 2 × 55,00 = 110,00, а в счёте 100,00».
- `contractorInvoiceKey(header)` — supplier (lower case, spaces collapsed, quotes «»"' dropped) + number
  (trimmed) + date: the duplicate key.
- `contractorInvoicePrompt()` — the Gemini prompt: copy the header and every line cell exactly as printed,
  never compute, never fill a missing value, never sum; return the JSON shape above; `itemCount` from
  «Всего наименований N» only.
- `isoWeek.ts`: `serviceWeekOfInvoice(ddMMyyyy): string` — ISO week of (invoice day − 7 days), '' for an
  invalid date; `invoiceWeekOptions(nowMs)` = 2026-W43 … current Ekb week, newest first.

Tests on SYNTHETIC invoices only (invented supplier «ООО Ромашка», INN-free): the kopeck line 1 × 9022.74,
a wrong line sum, a total that misses a line, itemCount mismatch, missing itemCount (note, still ok),
qty with decimals, «1 299,00» with NBSP, week cases (computed with Python isocalendar): 02.11.2026 → 2026-W44,
26.10.2026 → 2026-W43, 05.01.2026 → 2026-W01 (day 29.12.2025), 04.01.2027 → 2026-W53.

## Part B — Code.gs (+ stand checks + twin parity)

Sheets (created by `getOrCreateSheet`; written as text where a value could be coerced: number, dates, week):
- «Счета подрядчика»: ID счёта | Неделя | Поставщик | Номер | Дата счёта | Покупатель | Всего к оплате |
  НДС | Всего наименований | Файл ID | Файл | Загрузил | Загружено | Заменён
- «Строки счетов»: ID счёта | № | Наименование | Кол-во | Ед. | Цена | Сумма
Money cells are numbers in roubles with 2 decimals made from kopecks (kopecks / 100 once, no sums of floats).

Actions (doPost `payload.data`, session required; none excluded in dev mode):
- `saveContractorInvoice { week, fileWeek, fileId, header, lines, replace?, addAnother? }`:
  under `LockService`; re-runs the SAME checks as part A (GS twin, registered in `twinRulesParity.test.ts`);
  any failure → error with the first message; week must match the regex and be ≥ 2026-W43.
  Same key exists and `!replace` → `{ needsConfirm: 'replace', existing: { id, week, number, date, total } }`;
  `replace` → `assertAdmin`, the old header row and its lines are replaced in place under the SAME ID
  («Заменён» = time). Different invoices already in that week and `!addAnother` →
  `{ needsConfirm: 'another', existing: [{ number, date, total }] }`. Otherwise writes header + lines.
  `fileId` given: `findWeekFile(fileWeek, fileId)`; `fileWeek !== week` → the file moves to
  `getWeekFolder(week, true)`. `fileId` empty is allowed (manual entry without a PDF).
  Returns `{ saved: true, id }`.
- `listContractorInvoices { week }` → saved invoices of the week with their lines (text/number as stored).
- `deleteContractorInvoice { id }` → `assertAdmin`; removes the header row and its lines; the PDF stays.

## Part C — proxy `server.ts`

`POST /api/contractor-invoice/read { sessionToken, devMode, week, fileId }`: rate-limited like
`/api/china/ai-read`; 401 without a valid session; `callGasAction('getWeekFile', …)` with the caller's token;
mimeType not `application/pdf` → 400 «Распознать можно только PDF»; Gemini `gemini-flash-latest` with the PDF as
`inlineData` + `contractorInvoicePrompt()`, `responseMimeType: application/json`; returns
`{ status: 'success', data: <raw AI JSON> }`. No money is computed on the proxy. The global 1 MB JSON limit is
untouched (the browser sends only ids).

## Part D — store + screen

Store: `readContractorInvoice(week, fileId)`, `saveContractorInvoice(payload)`, `listContractorInvoices(week)`,
`deleteContractorInvoice(id)`; request-body tests in the style of `src/store/weekFiles.test.ts` (fields under
`data`; the read route body carries `week`, `fileId`, `sessionToken`, `devMode`).
`OzonSuppliesTab.tsx`, block «Файлы недели»: «Распознать» on PDF rows; «Ввести счёт вручную»; a short list
«Счета недели» (number, date, supplier, total; «Открыть»; «Удалить» admin only, confirm).
Modal «Счёт подрядчика»: PDF on the left (blob URL from `getWeekFile`), editable header + lines on the right;
field «Неделя оказания услуг» prefilled with `serviceWeekOfInvoice(date)` and marked «подтвердите»; the errors of
`checkContractorInvoice` shown at the lines; «Сохранить» disabled while a check fails or the week is empty;
`needsConfirm` answers become confirm dialogs and resend with `replace` / `addAnother`. AI failure → the form
opens empty with a toast, manual entry always possible.
