# Ticket 03 — design contract (orchestrator, 2026-11-01)

Owner's answers 2026-11-01:
1. Write off PER POSTING (cluster supply) at its own handover, not per order. Contractors sometimes forget some
   clusters; Ozon then treats the order as delivered and those clusters are never handed over. A posting that is
   never handed over is never written off and stays on «Мой склад».
2. A refusal is MAILED now (MailApp). The owner re-authorizes the script once at deployment (a new scope).
3. A switch «Автосписание» in «Настройки», OFF after deployment. While off nothing is written off automatically
   («Оформить» works as today). Handovers that happened before the switch was turned on are never written off
   automatically.
4. Money: the automatic write-off costs exactly as the manual one (`avgCost` rounded to kopecks × qty). The ticket's
   example therefore checks A 15 000.00, B 16 667.00, 50 pcs left worth 8 333.00 (not 16 666.67 / 8 333.33).

Decided by the orchestrator: a REFUSAL (business rule) is final — flagged and mailed once, never retried by later
polls; a TECHNICAL failure (an exception inside the commit) is retried by every later poll with the same opId until
done. The «История» author is `Автосписание`.

## Part A — the write-off of one posting (Code.gs)

`autoWriteOffPosting(row)` — row = one «Внешние отгрузки» posting as `getExternalShipments` returns it (plus its
handover fields). Returns `{ postingId, outcome: 'written' | 'skipped' | 'refused', reason?, opId?, result? }`.

- opId = `'ozonAuto:' + postingId` (deterministic: a repeat finds its own «История» rows / 96.10 memo).
- Skip (outcome `'skipped'`, nothing written, no flag) when: `status` is not `'new'` (already processed by hand or by
  an earlier run, or ignored); no `'Передача по'`; «Автосписание» column already holds a refusal.
- Items: `itemsJSON` `[{offerId, barcode, quantity}]`, each mapped by `supplyReserveArticle_(skus, offerId, barcode)`.
- Refusal reasons, checked BEFORE any write, in this order (outcome `'refused'`, the text goes to the flag):
  - `itemsJSON` empty or unparsable → `'нет состава поставки'`;
  - an item whose mapped article is not an article of «SKU» → `'неизвестный товар <offerId или ШК>'`;
  - an article with a «Комплекты» entry that has no components → `'комплект без компонентов <article>'`;
  - short stock → `'не хватает остатка: <the existing shortage text>'`. The shortage computation of
    `commitTransaction` (Code.gs ≈:3572–3613) is EXTRACTED into one helper used by both — commitTransaction's
    behaviour and error text stay byte-identical;
  - dev mode (`_devModeSpreadsheet` set) → `'режим разработки'`.
  A virtual posting never has a handover (ticket 02 rule 1), so it never reaches this function.
- Write: `commitTransaction(items, 'Расход', 'Ozon (<cabinet>)', <handover day>, 'Автосписание', null, opId,
  0 /* explicit additional costs: no services, no packaging */, undefined, '', '')`, with the same commit-origin
  setup the doPost `'commit'` action does (`_commitAction` with `postingIds: [postingId]`, so a 96.10 memo can be
  completed / re-linked by the admin popup), then `linkPostingsToCommit([postingId], result.newTransactions)`.
  Handover day = the date part (`yyyy-MM-dd`) of «Передача по» (Ekb text), in the format the client sends as
  `deliveryDate`. Item price = what the client would send (the server costs a «Расход» at `avgCost` anyway).
  The Ozon cost journal row is appended by `commitTransaction` itself (destination names an Ozon cabinet).
- A retry after a technical failure (memo present / «История» rows of the opId present) completes through the
  existing 96.10 path; the posting is linked on an idempotent hit too.
- On success the «Автосписание» column = `'ждёт счёта'`.

## Part B — run from the poll, the switch, the flag, the mail (Code.gs)

- New column `'Автосписание'` appended at the END of `EXTERNAL_SHIPMENTS_HEADERS` (via `ensureColumns`).
  Values: `''`, `'ждёт счёта'`, `'спишите вручную: <reason>'`. The poll's own row writes never touch it.
- Switch: Script Property `ozon_autoWriteOffSince` = epoch ms when switched on; absent = off. Actions
  `setOzonAutoWriteOff { enabled }` (assertAdmin; on → set to now if absent; off → delete) returning
  `getOzonSyncStatusInfo()`, which gains `autoWriteOffSince` (number or null). Register the action where
  actions are listed (`src/lib/gasActions.ts` if relevant).
- At the END of `saveExternalShipments` (after its writes and the stamp, same lock): when the switch is on, every
  posting with status `'new'`, a «Передача по» whose instant is ≥ `ozon_autoWriteOffSince`, and an empty
  «Автосписание» goes through `autoWriteOffPosting` — ALL such postings, not only the ones detected in this call
  (that is the retry of an earlier technical failure). Each posting in its own try/catch: a technical failure is
  logged and left for the next poll (column stays empty); it never fails the save. In dev mode the refusal
  `'режим разработки'` is written to the TEST DB's column and no mail is sent.
- Refusals of this call are written to the column, then ONE mail (production only) lists them:
  `MailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'Склад: спишите вручную — <n> поставк(и) Ozon', body)`,
  body per posting: cabinet, order number, posting id, handover «по», reason. A mail failure is logged; the flags stay.
- `saveExternalShipments` returns, in addition, `autoWriteOff: { written: [...], refused: [...], failed: [...] }`.

## Part C — UI (client)

- `src/types.ts` `ExternalShipment`: `autoWriteOff: string`.
- `OzonSuppliesTab.tsx`: per posting a badge «ждёт счёта» (neutral) or «спишите вручную» (red, tooltip = reason).
  A flagged posting keeps the normal «Оформить» path.
- `SettingsTab.tsx`, next to «Автоопрос Ozon», admin only: «Автосписание товара при передаче» on/off via
  `setOzonAutoWriteOff`, showing since when it is on.

## Tests (money tier)

Stand `tests/apps-script/` with `h.setScriptTimeZone('Asia/Yekaterinburg')`; runs under `TZ=Asia/Yekaterinburg`
and `TZ=UTC`; 3–5 mutations per part. Checklist of the ticket, with the owner's figures (A 15 000.00, B 16 667.00).
