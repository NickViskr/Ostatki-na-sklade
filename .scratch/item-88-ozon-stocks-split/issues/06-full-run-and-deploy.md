# 06: Full run, owner's deployment, live check, close item 88

**What to build:** the finished rework reaches the owner. Full set once (`npx vitest run`, `npm run test:gas`, `tsc`), clean `git archive HEAD` export built with `npm ci`, the owner runs the one Cloud Run deploy command; the orchestrator compares served chunks with the local build; the owner opens the tab and compares a few rows with what he saw before. Code.gs is not touched. Plan, DEVLOG and TEST_LOG updated; the item is closed only on the owner's word. Spec: `../spec.md`, Deployment.

**Blocked by:** 02, 03, 04, 05.

**Status:** ready-for-human

- [ ] Full set green (counts recorded in TEST_LOG)
- [ ] Owner deployed; served chunks equal the local build modulo hashes and the build label; revision recorded
- [ ] Owner's live check done
- [ ] Item 88 closed in the plan on the owner's word
