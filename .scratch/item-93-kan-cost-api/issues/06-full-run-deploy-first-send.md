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
