# 02 — never leave a stale cargo label in the folder (money-critical tier)
Status: ready-for-agent, after 01
- server.ts `collectSupplyDocs`: collect `staleLabelSupplyIds` = supplies whose cargoes were recreated in this run but
  whose label was not obtained; pass them to GAS `saveSupplyDocsToDrive`.
- Code.gs `saveSupplyDocsToDrive`: trash (setTrashed, recoverable) files of the order folder whose name starts with
  `<supply_id>.` or equals the fallback `tags-cargoes-by-supply-<supply_id>…`; return `removedStaleLabels`.
  Nothing else is touched (composition xlsx, product labels, other supplies).
- Warning text: «Кластер X: этикетки грузомест не получены — прежний файл этикеток убран, он недействителен».
Checks: stand — stale file trashed, other files kept, no-op when absent; vitest for the id collection; 3 mutations.
Deploy: Code.gs first (owner runs clasp push + deploy), then Cloud Run.
