# 02: Shared shipment number on new combined shipments

**What to build:** when several Ozon orders are written off together as a combined shipment, the
browser generates one shipment number and every order's commit writes it to a new column «Отгрузка»
of «История». A single-order write-off and every non-Ozon operation leave it empty. The number
survives a row edit, a deletion to «Удаленное» and its restore, and the History read model exposes
it. Nothing the owner sees changes yet; the number is what ticket 03 uses to find all orders of a
combined shipment. Spec: `../spec.md` (Implementation decisions: columns and shipment number).

**Blocked by:** 01 (same History write path and column plumbing).

**Status:** ready-for-agent

- [ ] Stand: commits carrying a shipment number write it on every row of every order; without one the cell stays empty; a sheet without the column gains it at the end
- [ ] Stand: row edit and delete/restore keep the number
- [ ] Browser: a combined write-off sends one and the same number with every order; a single-order write-off sends none
- [ ] Old combined shipments (21.09, 24.09 on the 2026-09-29 export) read exactly as before
- [ ] Mutations 3–5 on the server path
