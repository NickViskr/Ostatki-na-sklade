# 06: Week window, step 1 — packaging/stickering per article

**What to build:** plan T5. The week window lists the week's supplies of both cabinets (written off or
«ждёт счёта»). Step 1: the user enters packaging/stickering by hand per ARTICLE (₽ per piece; the owner:
packaging and stickering are one thing). Stored as FIXED per-row sums; it replaces any packaging the
write-off carried (manual write-offs of week 43). The step-1 total is shown against the invoice's stickering
line(s). Ask the owner where «Прочее» goes now that the write-off is automatic. Spec: `../spec.md`
(decision 8, «Storage»). Money tier.

**Blocked by:** 03, 05.

**Status:** ready-for-agent

- [ ] qty × unit per row, kopeck-exact; a repeat save writes nothing new
- [ ] Packaging of a manual write-off is replaced, never added to
- [ ] Journal reconciled for the touched supplies (with ticket 07's apply or on its own — decide here)

## Comments
