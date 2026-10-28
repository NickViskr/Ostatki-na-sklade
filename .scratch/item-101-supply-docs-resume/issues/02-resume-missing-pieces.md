# 02 — collect only what is missing (money-critical tier)
Status: ready-for-agent, after 01
Files: server.ts (`collectSupplyDocs`, `/api/ozon/supply/docs`), src/lib/ozonSupplyDocs.ts (pure decision
function), their tests, OzonSuppliesTab.tsx (confirmation text only).
Behaviour: see spec «Decisions». Pure function: (existing cargoes of a supply, layout boxes) → reuse | recreate.
Checks: unit tests (match / none / different layout / part ready); guard test: a matching cluster never
calls `/v1/cargoes/create`; whole-path fake-Ozon test: run 1 with 429 on three labels, run 2 makes exactly
3 label calls and 0 create calls; 3–5 mutations (drop the match check, always recreate, lose reused ids).
Full set once before deploy: `npx vitest run`, `npm run test:gas`, `npx tsc --noEmit`.
