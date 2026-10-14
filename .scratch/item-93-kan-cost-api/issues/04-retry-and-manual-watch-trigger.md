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
