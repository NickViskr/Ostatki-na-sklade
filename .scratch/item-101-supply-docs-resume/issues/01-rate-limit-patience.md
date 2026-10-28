# 01 — patience on Ozon HTTP 429
Status: ready-for-agent (small: orchestrator itself, no agents)
Change `fetchOzonApi` (server.ts): after 429 wait 20/30/40 s, up to 4 retries; call gap 1 s. Error text and
`httpStatus 429` on exhaustion unchanged. Item 65 (draft recalculation, 35 s) must keep working — check
the draft route's own handling of 429 is not shortened.
Checks (cosmetic-plus tier, no mutations): source-guard test on the wait numbers; fake-fetch test 429,429,200 → passes;
fake-fetch all 429 → throws with httpStatus 429. Run only the changed test file.
