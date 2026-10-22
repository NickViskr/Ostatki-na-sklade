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

**Status:** ready-for-agent

- [ ] Exact time from `state_updated_date` only when caught in ACCEPTED_AT_SUPPLY_WAREHOUSE; window otherwise
- [ ] A posting first seen already IN_TRANSIT / later; a DIRECT supply; a virtual order (ignored)
- [ ] Sunday 23:50 vs Monday 00:10 Yekaterinburg; a window across midnight → «проверьте неделю»
- [ ] Existing rows (before this ticket) get no invented handover time
- [ ] Two polls never run at once; the evening runs fire at the exact minutes; a run's duration measured
- [ ] `ensureColumns` outside any locked section (it releases the lock)

## Comments
