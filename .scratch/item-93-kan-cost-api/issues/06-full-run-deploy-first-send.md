# 06: Full run, deployment, the first live send, the one-time backlog send, close item 93

**What to build:** the finished item reaches the owner. Full set once (`npx vitest run`,
`npm run test:gas`, `TZ=Asia/Yekaterinburg` for both, `npx tsc --noEmit`). The owner runs
`clasp push` + `clasp deploy -i …` (Code.gs and ChinaOrders.gs), verified by clone + `cmp`; the
owner installs the watch trigger; then the Cloud Run deploy from a clean `git archive HEAD` export
with `npm ci`, verified with `norm.py`. First live send: one real Ozon shipment with the owner
present — green toast, ✓ in «История», the figure visible in KAN (`get_product_costs`). Then the
one-time backlog send decided in ticket 01 (preview shown to the owner, apply on his word). Plan,
DEVLOG, TEST_LOG, memory updated; item 93 closed only on the owner's word; push only on his word.
Spec: `../spec.md`.

**Blocked by:** 01, 02, 03, 04, 05.

**Status:** ready-for-human

- [ ] Full set green (counts in TEST_LOG)
- [ ] Code.gs deployed and verified; trigger installed; Cloud Run deployed and verified
- [ ] First live send accepted and seen in KAN
- [ ] Backlog send done (or declined) on the owner's word
- [ ] Item 93 closed on the owner's word

## Comments

- 2026-10-14, from ticket 02: the one-time journal fix is `applyOzonCostChainOps(cabinet, article, ops, source)`;
  `source` MUST start with «пересчёт» (e.g. «пересчёт: исправление журнала, пункт 93»), otherwise it is refused.
  BowlGrayMini_01 / MaxiStore: `{'row:60': {drop: true}}` (check first that sheet row 60 is still the OpID-less
  «отгрузка» of 12.09, base 335). Полка_выдв_27см / Mercurius: either explicit `{'op:444547eb-…': {shippedCost:
  667.5}, 'op:fe030a3b-…': {shippedCost: 658.82}}`, or ONE `resyncOzonCostForOps([both OpIDs], source)` — two
  separate resyncs give an intermediate 709.53 in between. Dry run on the 2026-10-14 export: 241.99 and 709.51.
  Optional, owner's word: stamp «История» row `5258f18d` (BowlGrayMini_01 12.09, no OpID) with the OpID of its
  journal link row 57 (`8d776830…-1`), so later edits of that row reach the journal.
- 2026-10-14, outside the item: Code.gs also carries `6ae6961` (default admin password removed from the code;
  owner chose to ship it with this ticket, not as a hotfix). After the Code.gs deploy tell the owner: a new «Админ»
  password goes into the Script Property `auth_newAdminPassword` (Apps Script editor → Project Settings → Script
  Properties); the next login applies it and deletes the property. The assistant never sets, types or reads it.
  If the owner cleared the «Админ» password cell meanwhile, the property restores «Админ».
