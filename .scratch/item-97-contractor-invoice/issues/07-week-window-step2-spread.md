# 07: Week window, step 2 — spreading the invoice

**What to build:** plan T6. The user ticks invoice lines and quantities (stickering/packaging lines unticked by
default, «учтено в шаге 1») and the week's supplies (all by default, both cabinets). The amount is split BY
BOXES — ceil(qty / pcsPerBox) per article as `countShipmentBoxes`, a kit by its own card — kopeck-exact by
largest remainder at every level (week → supply → row). A missing box norm blocks with the article named
(today's code silently counts 0). The invoice REPLACES all contractor services of the ticked supplies
(tariff services of manual write-offs included). Preview per supply and per cabinet; the unallocated
remainder shown. Shares stored as FIXED per-row sums with the invoice reference. Apply = one server
operation: compute all, write, then reconcile the KAN journal against «История» (not «changed in this
run»). A repeat sets the same target; re-applying an invoice replaces only its own previous shares.
Spec: `../spec.md` (decisions 4–7). Money tier.

**Blocked by:** 06.

**Status:** rolled back 2026-11-06 — dormant, see ../rollback-plan.md (was: done (live 2026-11-04: Code.gs @218 + Cloud Run `sklad-00123-cf6`))

- [x] Σ row shares = Σ ticked amounts to the kopeck (e.g. 1299 over 120/45/75 pcs in boxes)
- [x] Missing pcsPerBox blocks; unticked lines stay unallocated
- [x] Repeat = no change; replacement of an invoice; an injected cut-off then a retry completes without doubling
- [x] The latest journal cost of every touched supply equals its «История» row price after apply

## Comments

- 2026-11-04: contract and owner's answers in `../ticket-07-design.md` (one invoice at a time; rights as step 1; column «Счёт недели» + tag in «Объект»; an empty «ШТ/КОР» blocks). Commits `86366c1`, `ea3d942`, `69d3a78`. A cut-off inside a multi-row manual write-off or a combined shipment healed only after the fix «evidence rows last, done rows not re-planned» (stand B8b/B8c). The first real apply on live data is still to be watched (no week had an invoice and written-off supplies at deploy time).
