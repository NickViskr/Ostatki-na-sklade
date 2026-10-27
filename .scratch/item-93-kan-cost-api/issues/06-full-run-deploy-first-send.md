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

- 2026-10-14, from ticket 03: the sender does preview → apply in ONE call, it cannot stop to show the owner a preview.
  For the backlog send, show the owner a chat-connector `preview_product_cost_changes` of exactly the rows the sender
  will send (no apply), then let the sender send them on his word. ORDER: as soon as Code.gs with 02+03 is live, ANY
  call of the sender (browser of 05, trigger of 04) sends every pending group — the journal correction rows of
  `applyOzonCostChainOps` become pending the moment they are written, so write them only right before the controlled
  send. The two 03.09 dates (Миска_двойная 229.58, Набор_полок_выдв_бел 1647.59) are legacy-stamped with an empty status
  and will NOT be sent by themselves: on the owner's word set «Статус КАН» of the LAST journal row of each day to
  «ошибка» (cell edit or a one-off editor function) so the sender picks them up. Unobserved until the first live send:
  the `apply_product_cost_changes` answer shape (`history_saved` read at the top or in `summary`; a wrong guess only
  words the reason — acceptance is the read-back) and the `delete` preview without `shop_id`. The first live send makes
  the three status columns appear at the end of «Себестоимость Озон».

- 2026-10-15, from ticket 04: install the watch trigger (`setupKanCostWatchTrigger` run once in the Apps Script editor:
  Run → choose the function; running it again leaves one trigger) only AFTER the first live send and the backlog send
  (or the owner's decision to skip it) — NOT right after the Code.gs deploy as the description above says. Its first run
  gives every pending unsent row a first-seen time and sends them all 5–20 min later, with no preview shown to the
  owner. Check in the editor (Triggers, the clock icon) that exactly one `kanCostWatch` trigger «every 15 minutes»
  exists. The watch never throws (errors go to the execution log, «Executions»), so no failure mails are expected.
  Also: «Время КАН» cells are written as plain text (format '@') — the script zone is Asia/Yekaterinburg and the
  spreadsheet's own zone may differ; after the first live send check that the cell shows the time just written.

- 2026-10-27, from ticket 05: the browser half is built (result in `05-…md`). Code.gs now also has the lock-free read
  `getOzonCostKanMarkers` — it ships in the same `clasp push`; until then the «История» marker read answers «Unknown
  action» and shows nothing. ORDER reminder: with Cloud Run of 05 live, EVERY Ozon save calls the sender, which sends ALL
  pending groups (the backlog too) — deploy Cloud Run only when the backlog send is settled, or right after it. First
  live check in a browser: after a real Ozon shipment one green toast «КАН принял себестоимость:», ✓ on its «История» row
  (hover shows the text), the ✗ buttons fit the 240 px destination cell (never seen in a browser yet).
