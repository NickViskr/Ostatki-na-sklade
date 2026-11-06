# 08: Guards after the spread and the week reconciliation

**What to build:** plan T7. Every path that recomputes a row price (pencil edit, re-sort, «Вся отгрузка»,
delete/restore, bulk restore, receipt-price replay) keeps the fixed invoice and packaging sums untouched and
never re-spreads them by pieces. A quantity edit, delete or restore of a supply carrying them marks its week
«перераспределить». The week view reconciles: Σ row shares of each invoice = its allocated sum to the kopeck,
red otherwise; supplies of the week not in the spread are listed. Spec: `../spec.md` («Storage»). Money tier.

**Blocked by:** 07.

**Status:** rolled back 2026-11-06 — dormant, see ../rollback-plan.md (was: done (live 2026-11-05: Code.gs @219 + Cloud Run `sklad-00124-dgf`))

- [x] One stand check per recompute path: the fixed sums survive to the kopeck
- [x] Mark «перераспределить» on quantity edit / delete / restore; cleared by a new apply
- [x] Reconciliation red on a hand-edited row, green after re-apply

## Comments

- 2026-11-05: contract and owner's answers in `../ticket-08-design.md` (fixed sums stay on a pencil edit; peresort keeps the supply's money; «перераспределить» computed from the facts; shown only in the week window). Commits `8936706` (A), `a9b2894` (B), `8847453` (C). Found on the way: a pencil edit left the posting's TransGroupInfo on the old row id — fixed in B. A qty edit of a single-row supply marks step 1 only (its only row keeps the whole invoice share). The first real apply on live data is still to be watched.
