# 02: Handover detection, ISO week, light supply polls, own status log

**What to build:** plan T1. The poll records per cluster posting the handover moment = the first time the
app sees it in a departed status (`STOCK_DEPARTED_STATUSES`): the order's `state_updated_date` when caught
exactly in ACCEPTED_AT_SUPPLY_WAREHOUSE («точно»), otherwise the window (previous poll, this poll] («окно»);
DIRECT supplies by their first departed status. New columns at the END of «Внешние отгрузки» (by header):
handover time, exact/window, ISO week (Asia/Yekaterinburg, written as text), manual week. An own log sheet
of status changes. «Поставки Озон» shows a «Неделя» column and filter and the mark «проверьте неделю» when the
window crosses Sunday→Monday midnight. Light poll = the supply part of `/api/ozon/check` only: hourly in the
daytime (hours chosen after measuring one run against the 90 min/day trigger quota) and exactly at 23:00,
23:30, 23:45 Yekaterinburg via one-off triggers set by an earlier run (daily triggers drift ±15 min); never
overlapping the 11:00/20:00 МСК full poll (`scheduledOzonCheck` deletes every «Автоопрос Ozon» session row).
The timeslot stays a hint only. Spec: `../spec.md` (decisions 2, 3). Dates tier: `TZ=Asia/Yekaterinburg` run.
No money moves here.

**Blocked by:** —

**Status:** rolled back 2026-11-06 — dormant, see ../rollback-plan.md (was: done 2026-10-31 — deployed 2026-11-01 (Code.gs @212 + Cloud Run sklad-00115-bsz; see «Result»))

- [x] Exact time from `state_updated_date` only when caught in ACCEPTED_AT_SUPPLY_WAREHOUSE; window otherwise
- [x] A posting first seen already IN_TRANSIT / later; a DIRECT supply; a virtual order (ignored)
- [x] Sunday 23:50 vs Monday 00:10 Yekaterinburg; a window across midnight → «проверьте неделю»
- [x] Existing rows (before this ticket) get no invented handover time
- [x] Two polls never run at once; the evening runs fire at the exact minutes; a run's duration measured
- [x] ~~`ensureColumns` outside any locked section (it releases the lock)~~ — obsolete since 100.9 R-024: it neither waits for nor releases a lock the caller holds; checked instead that the new columns are added inside the held doPost lock and the lock survives (A14, A14b)

## Comments

## Result (2026-10-31)

Owner's answers: light poll hourly 09:00–22:00 Asia/Yekaterinburg plus exact 23:00/23:30/23:45; supplies
departed before the deploy get no handover and an empty week (set by hand); only an admin sets the manual week.
Measured `/api/ozon/check` (Cloud Run log, 27 runs over 7 days): 18–43 s, median 28 s → ≈21 min/day of the
90 min trigger quota. Contract: `../ticket-02-design.md`.

- Part A `7bfd091`: handover rule, ISO week (Ekb, ISO week-year), five columns at the end of «Внешние
  отгрузки», sheet «Журнал статусов Ozon», previous-poll stamp; proxy sends `polledAt`, `orderState`, `isDirect`.
- Part B `844a65f`: `scheduledOzonStatusCheck` (hourly), `ensureEveningStatusPolls` + `runOzonStatusPollAt`
  (one-offs), `runOzonStatusPoll` (own session label, skips during the full poll; the full poll waits ≤ 90 s for
  a running light poll), history with durations in `ozon_statusPollHistory`.
- Part C: action `setExternalShipmentWeek` (admin), `src/lib/isoWeek.ts`, «Неделя» label/filter, «проверьте
  неделю» mark, admin week select in «Поставки Озон».
- Tests: tester wrote every check first (stand A1–A14b + A2d, B1–B13b, C1–C6; vitest `isoWeek.test.ts`);
  mutations 5 + 5 + 3, all killed (two survivors fixed by new checks A2d, B13a/B13b). Final: stand 1726/0 and
  vitest 2845 (1 expected fail) under default, Asia/Yekaterinburg and UTC; tsc clean. No UI component tests exist.
- Going live: Code.gs then Cloud Run; afterwards one `setupOzonSyncTriggers` run (or the «Автоопрос» switch)
  installs the hourly trigger. Check on the live sheet that «Неделя» stays text and the handover times read back.
