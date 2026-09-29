# 04: Full run, owner's deployment (Code.gs, then Cloud Run), live check, close item 90

**What to build:** the finished item reaches the owner. Full set once (`npx vitest run`,
`npm run test:gas`, `npx tsc --noEmit`; the Yekaterinburg run only if a ticket touched dates). The
owner runs `clasp push` and `clasp deploy -i …` (Code.gs and ChinaOrders.gs), verified by a clone
and `cmp`; then the Cloud Run deploy from a clean `git archive HEAD` export built with `npm ci`,
verified by comparing served chunks with the local build. The owner checks live: a comment typed in
each recording window shows as 💬; the next combined Ozon write-off gets a shipment number and can
be corrected as a whole; old combined shipments are refused. Plan, DEVLOG, TEST_LOG, memory updated;
item 90 closed only on the owner's word; push only on the owner's word. Spec: `../spec.md`.

**Blocked by:** 01, 02, 03.

**Status:** ready-for-human

- [ ] Full set green (counts recorded in TEST_LOG)
- [ ] Code.gs version deployed and verified; Cloud Run revision deployed and verified; both recorded
- [ ] Owner's live check done
- [ ] Item 90 closed in the plan on the owner's word
