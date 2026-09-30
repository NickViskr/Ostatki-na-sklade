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

- [x] Full set green (counts recorded in TEST_LOG)
- [x] Code.gs version deployed and verified; Cloud Run revision deployed and verified; both recorded
- [ ] Owner's live check done
- [ ] Item 90 closed in the plan on the owner's word

## Result (2026-09-29, partial — live check pending)

- Full set: vitest 2491 + 1 expected fail (63 files), stand 1189/0, tsc clean. No Yekaterinburg run (no dates touched).
- Code.gs 203: owner ran `clasp push` (3 files) and `clasp deploy -i …` → @203. Clone of version 203 equals `Code.gs` and `ChinaOrders.gs` byte for byte; `clasp list-deployments` shows /exec @203. Versions in use: 183 of 200 before the deploy.
- Cloud Run `sklad-00105-vm2` from a clean `git archive HEAD` (`e4e92c3`) with `npm ci`: index equal modulo hashes, 33/34 chunks equal, main chunk differs only by the build label (20:07 vs 20:05 МСК); `/api/version` reports `sklad-00105-vm2`. The scratchpad checker `norm.py` was rebuilt this session (fetches index, follows chunk imports, compares modulo 8-char hashes).
- Owner's live check NOT done yet — checklist in `docs/OZON_PLAN.md`, «Item 90 live check».
- Not pushed; item 90 not closed.
