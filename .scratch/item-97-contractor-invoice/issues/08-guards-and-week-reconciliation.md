# 08: Guards after the spread and the week reconciliation

**What to build:** plan T7. Every path that recomputes a row price (pencil edit, re-sort, «Вся отгрузка»,
delete/restore, bulk restore, receipt-price replay) keeps the fixed invoice and packaging sums untouched and
never re-spreads them by pieces. A quantity edit, delete or restore of a supply carrying them marks its week
«перераспределить». The week view reconciles: Σ row shares of each invoice = its allocated sum to the kopeck,
red otherwise; supplies of the week not in the spread are listed. Spec: `../spec.md` («Storage»). Money tier.

**Blocked by:** 07.

**Status:** ready-for-agent

- [ ] One stand check per recompute path: the fixed sums survive to the kopeck
- [ ] Mark «перераспределить» on quantity edit / delete / restore; cleared by a new apply
- [ ] Reconciliation red on a hand-edited row, green after re-apply

## Comments
