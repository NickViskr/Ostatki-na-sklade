Status: ready-for-agent

# Item 93 — Ozon cost goes to KAN automatically through its API, with proof of acceptance

Plan item 93 in `docs/OZON_PLAN.md`. Decided with the owner 2026-10-14 (grilling, 8 answers,
recorded below; plan approved the same day). Vocabulary: `CONTEXT.md` — Ozon order, Combined
shipment, Shipment extras. Memory note: `kan-cost-auto-send-2026-10-14`.

## Problem Statement

The app keeps the cost of the goods lying on Ozon in the journal «Себестоимость Озон» (item 47):
one row per shipment to Ozon, a moving average dated by the day of the supply. KAN («Культура
аналитики») learns that cost only from a CSV the owner downloads with the «Себестоимость КАН»
button and uploads into KAN by hand. Nobody checks whether KAN took it.

KAN now accepts cost writes over its MCP server. The owner wants the cost to reach KAN by itself
after every shipment and every correction of a shipment, and wants to be told that KAN accepted it.

Two holes in the journal make automatic sending dangerous today (found by reading the code
2026-10-14, NOT yet confirmed by a replay — ticket 01 does that):

- a pencil edit of a shipment row (`updateTransaction` → `deleteTransaction` + `commitTransaction`
  with opId '') appends a NEW blend row to the journal as if it were another shipment, while the
  old row stays — a double count;
- deleting a shipment row never touches the journal; restoring it is unexamined.

With a manual CSV these were survivable; with automatic sending a wrong figure goes to KAN unseen.

## Solution

After a shipment to Ozon is saved, the browser fires a separate step: the server sends every
journal row KAN has not yet accepted (preview → apply), reads KAN back, compares to the kopeck,
and only then marks the rows accepted. The user sees a green toast «КАН принял себестоимость: …»
and a «✓ КАН» marker on the shipment row in «История». On failure: a red toast with the reason and
two buttons — «Отправить снова» and «Отправлю сам» (downloads the CSV as today, the app then checks
KAN every 15 min for an hour, then falls back to automatic retry). A trigger retries hourly.

Corrections — pencil edit, deletion, restore, «Вся отгрузка», receipt price edit — rewrite the
chain of that article+cabinet from the corrected supply onwards in the journal, and the same
sender carries the new figures to KAN.

## Owner's answers (2026-10-14)

1. When: right after the save, as a separate step — the save stays as fast as today; KAN being
   down never blocks a shipment.
2. A corrected shipment rewrites KAN for its own date AND every later date of the same
   article+cabinet (moving average; same rule as `reissueOzonCostRows`, owner 26.08.2026).
3. A deleted shipment: the chain is recomputed without it; the KAN entry of its date is deleted if
   no other shipment of that article+cabinet is left on that date. Restore does the reverse.
4. Verification = `apply` answers `history_saved: true` AND a read-back (`get_product_costs`)
   equals the journal to the kopeck. Confirmation: toast + marker on the shipment row in «История».
5. Failure: red toast with the reason, hourly auto-retry, button «Отправить снова», button
   «Отправлю сам». «Отправлю сам» downloads the CSV (built as today) into «Загрузки», switches the
   rows to «manual» (auto-retry stops for them), the app checks KAN at 15/30/45/60 min; found →
   accepted; not found after an hour → red «в КАН не найдено» and back to hourly auto-retry. No
   duplicates in KAN: its import is an upsert by product+date.
6. Before switching on: reconcile the journal with what KAN holds (incl. the item-80 tail of
   possibly inflated prices before 22.09.2026); the owner approves a one-time send of the
   differences; automation runs from then on.
7. Buttons «Отправить снова» / «Отправлю сам»: the user who saved the shipment and the admin.
   Markers visible to the same people.
8. Out of scope: re-costing goods already shipped to Ozon after a China batch's final cost
   («доводка», item 84) — plan item 94.

Decided by the orchestrator (owner may object): the «Отправлю сам» file holds ALL unaccepted rows,
not only the failed shipment's (as the «Себестоимость КАН» button does today); the old button stays
unchanged.

## KAN API facts (checked 2026-10-14 from the chat connector)

- MCP JSON-RPC at `https://kultura-analitiki.ru/mcp/`, `tools/call`, Bearer token. `Code.gs` already
  has `kanCall(tool, args)` and the token in Script Property `kan_mcpToken` (never leaves Apps Script).
- `list_shops` → `access.scopes` must contain `mcp:product_cost:write`; shops: MaxiStore id 2771,
  Mercurius id 1765 (= the cabinet names in the journal). Both the chat token and the SCRIPT token
  `kan_mcpToken` have the scope (script token checked by the owner 2026-10-14, ticket 01).
- `preview_product_cost_changes` `{operation: 'import', shop_id: [id], rows: [{sku_article, date
  'YYYY-MM-DD', cost_price, expense}]}` → `{preview_id, expires_at (15 min), items[{before, after}],
  summary{created, updated, skipped, issues, ...}}`. Upsert by product+date; last duplicate in a
  batch wins; ≤200 rows per batch; amounts ≥0, ≤4 decimals, positive sum. Other operations:
  `create`, `update`, `delete` (one `entry_id`).
- `apply_product_cost_changes` `{preview_id, confirm: true}` → reports `history_saved`,
  `interval_update_queued`, broker failures separately (intervals are recomputed in the background).
  Re-applying the same preview returns its result without another write. NEVER called so far.
- `get_product_costs` `{shop_id: [id], product_id?, date__gte?, date__lte?, limit ≤1000, offset,
  ordering}` → `items[{id, product_id, sku_article, dt, dt_end, cost_price, expense}]`, paginated by
  `next_offset`. `id` is the entry id a `delete` needs.
- The CSV column «Статус» = MAIN is the PRODUCT state (MAIN / ARCHIVED of `list_products`); cost
  entries carry no status. An API import matches ARCHIVED products too (ticket 01: BowlGrayMini_01 into
  1765 matched the archived Mercurius product) — the shop id must come strictly from the journal's cabinet.
- Ticket 01 previews (2026-10-14): a future `date` is accepted (`created`, `dt_end null`); an unknown
  article does NOT fail the preview — `imported 0`, `skipped {"Товар не найден": n}`, `issues[{row_number,
  sku_article (lower-cased), reason}]`, and in a mixed batch the known rows still pass; a batch with both
  shop ids skips an article present in both shops as «Товар определён неоднозначно» — one shop per batch.
- KAN's rule text says apply only after the user's approval in chat; the owner decided that the
  click «Оформить» on a shipment is that approval (his account, his call).
- Unknown until tried: rate limits.

## Implementation Decisions

- Journal «Себестоимость Озон» gains columns AT THE END (ensureColumns; never reorder): a KAN status
  (empty / sending / accepted / error / manual), the reason/answer text, the time of the last
  attempt or manual switch. «Выгружено в КАН» keeps its meaning «first reached KAN» and is stamped
  only when acceptance is VERIFIED (API read-back or manual check). The «Себестоимость КАН» button
  keeps working on «Выгружено в КАН» as today.
- One send unit = (cabinet, article, date), last journal row wins (`collapseKanCostRows` rule);
  every journal row of the group gets the status.
- The sender runs outside the global write lock; its own `LockService` script lock (tryLock) keeps
  two senders (browser + trigger) from sending the same rows at once. Status writes are short.
- Deleted dates: the journal must carry something the sender turns into a KAN `delete` (entry id from
  `get_product_costs`) without breaking `getOzonCostState` (the state = the last row per
  cabinet+article). Exact shape is ticket 02's design call.
- Chain recompute after an edit/delete keeps the recorded bases («Остаток до») of later rows, as
  `reissueOzonCostRows` does; only the edited shipment's quantity/cost changes or it drops out.
- New server actions go into the proxy action table (`src/lib/gasActions.ts`, TS↔GS parity test of
  item 89) and the `doPost` switch.

## Testing Decisions

- Money-critical everywhere except the toasts/markers: whole-path tests, 3–5 mutations per fix,
  `TZ=Asia/Yekaterinburg` run (dates), tester agent.
- The stand gets a fake KAN behind `UrlFetchApp.fetch` (accept / refuse / wrong figure written /
  unknown article / HTTP 500 / timeout / missing scope).
- Before deployment ticket 02 is replayed on the live xlsx export (vite-node harness, memory
  `sklad-process-2026-08-18`): the new journal figures are checked against a hand recompute.

## Out of Scope

- China final-cost correction → KAN (item 94).
- Changing how the moving average itself is computed.
- Wildberries.

## Tickets

`issues/01` diagnosis + reconciliation (no code) → `02` journal on edit/delete/restore →
`03` sender → `04` trigger → `05` browser → `06` full run, deploy, first live send, backlog send.
