# 04: The watch trigger — hourly auto-retry and the 15-minute check of «Отправлю сам»

**What to build:** a time trigger every 15 minutes. Rows in «manual» mode are looked up in KAN by
read-back at 15/30/45/60 min after the switch: found with the journal's figure → accepted (stamp
«Выгружено в КАН»); not found after the 4th check → status «error», reason «в КАН не найдено», back
to auto-retry. Rows in «error» (and unsent rows older than a few minutes, e.g. the browser closed
before its step) are re-sent through ticket 03's function when their last attempt is ≥60 min old.
Also a server action that switches given groups to «manual» (called by the «Отправлю сам» button)
and returns the rows for the CSV. The trigger is installed by an admin action or a function the
owner runs once in the editor (like `kanTurnoverDaily`). Spec: `../spec.md` (answer 5).

**Blocked by:** 03.

**Status:** ready-for-agent

- [ ] Stand with a fake clock: manual rows checked at 15/30/45/60, accepted as soon as found, back to auto after the 4th miss
- [ ] Stand: error rows retried only after 60 min; accepted rows never touched again
- [ ] Stand: switching to manual does NOT stamp «Выгружено в КАН» (unlike today's CSV button)
- [ ] Installing the trigger twice leaves one trigger
- [ ] Mutations 3–5

## Comments

- 2026-10-14, from ticket 03 (details in its «Result»): reuse `sendOzonCostToKan(username)` (`Code.gs` ≈6662) — it
  sends EVERY pending group (last-row status '' / «отправляется» / «ошибка», except '' with a «Выгружено в КАН» stamp);
  the «≥60 min since the last attempt» filter is this ticket's to add (e.g. an option read from «Время КАН»). A call
  without a username stamps «… автоотправка». The status columns are «Статус КАН», «Ответ КАН», «Время КАН» at the END
  (`OZON_COST_KAN_HEADERS`; `ensureColumns` with `OZON_COST_HEADERS.concat(OZON_COST_KAN_HEADERS)`, never widen
  `OZON_COST_HEADERS`); «Время КАН» is 'yyyy-MM-dd HH:mm:ss' in the script zone, read back as text even when Sheets made
  it a Date (`ozonCostRowsFromValues`). The manual switch must take the SAME lease (`acquireKanCostLease` /
  `releaseKanCostLease`) and write through `writeOzonCostKanStatuses` (short script lock, fresh read, identity check, never
  touches columns 1–12); never call `ensureColumns` or `getOzonCostJournal` inside a script-lock section — its own
  `releaseLock` would release ours. The «вручную» status is already skipped by the sender (counted in `skippedManual`).
- OWNER 2026-10-14: the old «Себестоимость КАН» button stays AS IT IS. It stamps rows without any read-back, and a
  stamped row with an empty status counts as done for the sender — a row exported through that button is never
  verified; that is accepted (the button is the admin's manual path). Do not change the button in this ticket.
