# 01 — safety and visibility (small tier; orchestrator itself)
Status: ready-for-agent
- server.ts `fetchOzonApi`: one log line per 429 (`OZON429 endpoint=… attempt=k/5`), no keys, no body. Wait times UNCHANGED.
- server.ts `/api/ozon/supply/docs`: per-order in-flight guard (Set of orderId, released in finally) → 409
  «Документы этой заявки уже собираются — дождитесь окончания» on a second concurrent call.
- Browser timeouts 180 s → 300 s (Cloud Run limit): `OzonSuppliesTab.tsx` DOCS_BUILD_TIMEOUT_SEC and the wizard's
  `FINALIZE_TIMEOUT_SEC` in `OzonSupplyModal.tsx` (check its current value first); a 409 shows its message as a toast.
Checks: log-line test (fake fetch 429,200), guard test (second call 409, released after the first ends, also on
throw), source guards on both timeouts. ≈5 checks, no mutations.
