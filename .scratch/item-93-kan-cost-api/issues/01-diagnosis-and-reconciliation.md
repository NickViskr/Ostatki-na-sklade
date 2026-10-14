# 01: Diagnosis and reconciliation — confirm the journal holes, check the script token, compare journal with KAN

**What to build:** nothing in code. The orchestrator itself (no agents) produces evidence the later
tickets rest on, and the owner's decision on the one-time backlog send. Spec: `../spec.md`
(answers 3, 6; «KAN API facts»).

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent (orchestrator, no code)

- [ ] Fresh xlsx export of «БД Склад» via the Drive connector (never the text export)
- [ ] Replay on the export (vite-node + the production modules, or the stand loaded with the export's
      sheets): (a) pencil edit of an Ozon shipment row changing the quantity, (b) deletion of a
      shipment row, (c) restore of it from «Удаленное». For each: what rows the journal gains, and
      whether the chain is double-counted / untouched. Confirm or refute the two holes of the spec.
- [ ] Find in the live journal any past edits/deletes of Ozon shipments that already distorted it
      (rows with empty OpID, rows whose shipment is in «Удаленное»), list them with figures.
- [ ] Script token scopes: the owner runs one read-only function in the Apps Script editor (or a
      temporary admin action) that logs `kanCall('list_shops', {}).access.scopes` — must contain
      `mcp:product_cost:write`. If not, the owner re-issues the token in KAN.
- [ ] Reconciliation with the KAN chat connector: `get_product_costs` for both shops (paginate
      `next_offset`) vs the journal collapsed per (cabinet, article, date). Report: rows never sent,
      dates where KAN ≠ journal (with both figures), KAN entries with no journal row, the item-80
      suspects (multi-article shipments edited from «История» before 22.09.2026).
- [ ] One preview (no apply) with a future date and with an unknown article, to learn KAN's answer;
      check whether «Статус MAIN» matters (compare an API row with a CSV-imported row in KAN).
- [ ] Owner decides what goes in the one-time send (done in ticket 06, after the automation is live
      or before it — owner's call). Decision recorded here.

## Comments
