# 06: Week window, step 1 — packaging/stickering per article

**What to build:** plan T5. The week window lists the week's supplies of both cabinets (written off or
«ждёт счёта»). Step 1: the user enters packaging/stickering by hand per ARTICLE (₽ per piece; the owner:
packaging and stickering are one thing). Stored as FIXED per-row sums; it replaces any packaging the
write-off carried (manual write-offs of week 43). The step-1 total is shown against the invoice's stickering
line(s). Ask the owner where «Прочее» goes now that the write-off is automatic. Spec: `../spec.md`
(decision 8, «Storage»). Money tier.

**Blocked by:** 03, 05.

**Status:** rolled back 2026-11-06 — dormant, see ../rollback-plan.md (was: done (live 2026-11-04: Code.gs @217 + Cloud Run `sklad-00122-rzj`))

- [x] qty × unit per row, kopeck-exact; a repeat save writes nothing new
- [x] Packaging of a manual write-off is replaced, never added to
- [x] Journal reconciled for the touched supplies (with ticket 07's apply or on its own — decide here)

## Comments

- 2026-11-04: journal reconciled on its own at every step-1 save (owner). Contract and owner's answers: `../ticket-06-design.md`. Commits `2f2aaff`, `74ae084`, `4ed9c7c`. Gap left to ticket 08: a pencil re-commit drops «Упаковка недели».
