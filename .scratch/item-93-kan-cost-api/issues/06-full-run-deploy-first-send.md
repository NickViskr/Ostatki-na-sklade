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

**Status:** deployed 2026-10-27, backlog sent and verified; open: the first browser send on a real Ozon shipment (owner present) and the closing of item 93 on the owner's word. Result below.

- [x] Full set green (counts in TEST_LOG)
- [x] Code.gs deployed and verified; trigger installed; Cloud Run deployed and verified
- [ ] First live send accepted and seen in KAN — the sender's first live run (the backlog, from the editor) is accepted and read back; the browser path (toast + ✓ after a real shipment) is not seen yet
- [x] Backlog send done (or declined) on the owner's word
- [ ] Item 93 closed on the owner's word

## Result (2026-10-27)

Order changed with the owner's approval (the description above predates ticket 05's constraint): Code.gs → journal
correction + controlled backlog send from the editor → Cloud Run → trigger → browser check on the next real shipment.
Item 97 ticket 01 (T0) shipped in the same deploys (owner: «вместе»). «История» row `5258f18d` left without an OpID
(owner: «нет, оставить»).

- **Full set at `eae52c2`** (tester): stand 1530/0 and 1530/0 under `TZ=Asia/Yekaterinburg`; vitest 69 files, 2655 + 1
  expected fail under Yekaterinburg; plain vitest the same except ONE timeout — `twinRulesParity.test.ts` «availability:
  pieces free for a new supply» took 5178 ms against the 5000 ms default under parallel load (no assertion failed; the
  file alone 10/10 in 4.1 s). Known flake, not fixed here. `tsc --noEmit` clean.
- **Reconciliation before anything** (export 2026-10-27 ~22:00 Ekb, `get_product_costs` both shops): journal 104 rows, all
  stamped «Выгружено в КАН» (the owner had uploaded the CSVs of 19.10 and 21.10); 78 journal day groups vs 78 KAN entries,
  76 equal, the two known 03.09 differences. So after the deploy nothing was pending until the correction.
- **Backlog grew to 13 dates:** Полка_выдв_27см had shipments on 17.10 and 20.10 blended on the inflated 710.01, so they
  were re-stated too (710.60 → 710.12, 710.89 → 710.43).
- **One-off editor file** `ticket06-oneoff.gs` (this folder; never pushed by clasp; coder): `tmp93FixJournal()` — guards
  first (never twice; sheet row 60 is the OpID-less 12.09 «отгрузка», base 335, 222.66; last rows of the two 03.09 days
  hold 229.58 / 1647.59), `ensureColumns` before any write, `applyOzonCostChainOps(… {'row:60': {drop: true}}, 'пересчёт:
  исправление журнала, пункт 93')`, ONE `resyncOzonCostForOps` with both Полка OpIDs, «ошибка» on the two 03.09 rows;
  `tmp93SendBacklog()` — refuses unless the pending set equals the 13 expected groups to the kopeck, then
  `sendOzonCostToKan('пункт 93 разовая отправка')`.
- **Replay** (tester, scratchpad `replay06/`, real Code.gs mirror + the one-off + `fakeKanCost` on the export): 97 checks /
  0 failed, also under UTC, Los Angeles and Moscow zones; 9 mutations killed. Finding: two separate resync calls (m4) end
  in the same day figures but leave 5 junk intermediate rows — the one call is right. Journal «Дата» cells are real date
  cells; the spreadsheet zone is Asia/Yekaterinburg (same as the script); «Себестоимость Озон» has 26 grid columns.
- **Code.gs @206** (owner ran `clasp push` + `clasp deploy -i … -d "item 93 KAN cost auto-send, item 97 T0, admin password
  from property"`): `clasp clone-script <id> 206` equal byte for byte to `Code.gs`, `ChinaOrders.gs`, `appsscript.json` of
  `eae52c2`; /exec pinned to @206; 187 of 200 versions. The owner was told how to set `auth_newAdminPassword`.
- **Function A** (owner, 22:45 Ekb): log equal to the replay; fresh export — rows 105–117 appended (marker for row 60,
  6 BowlGrayMini_01 links, 6 Полка links, source «пересчёт: исправление журнала, пункт 93»), 0 of the 103 older rows changed
  in columns 1–12, rows 48 / 51 «ошибка», the three KAN columns at the end; pending by the sender's rule = exactly the 13.
- **Chat-connector previews** (owner's «да»; NOT applied): MaxiStore 6 rows and Mercurius 7 rows, all `updated` into the
  same KAN entry ids, created 0, skipped 0, no issues.
- **Function B** (owner's «да», 22:48 Ekb): accepted 13, failed 0, notWritten 0. Journal: 32 rows «принято» with «КАН принял
  …»; stamp «2026-10-27 22:49:04 пункт 93 разовая отправка» only on rows 106–117 (the marker 105 unstamped, older rows keep
  their stamps); «Время КАН» shows the time just written (text). KAN read back (both shops): 78 of 78 journal day groups
  equal to the kopeck, no difference left.

  | Article (cabinet) | Dates | KAN before → after |
  |---|---|---|
  | BowlGrayMini_01 (MaxiStore) | 12.09 / 19.09 / 21.09 / 28.09 / 09.10 | 222.66 / 222.29 / 222.18 / 221.41 / 241.14 → 225.60 / 224.12 / 223.93 / 222.69 / 241.99 |
  | Миска_двойная (MaxiStore) | 03.09 | 229.79 → 229.58 |
  | Полка_выдв_27см (Mercurius) | 23.08 / 25.08 / 03.09 / 13.10 / 17.10 / 20.10 | 690.50 / 682.21 / 677.21 / 710.01 / 710.60 / 710.89 → 667.50 / 659.21 / 656.54 / 709.51 / 710.12 / 710.43 |
  | Набор_полок_выдв_бел (Mercurius) | 03.09 | 1650.49 → 1647.59 |

- **Cloud Run `sklad-00109-666`** (assistant, clean `git archive eae52c2` export, `npm ci`, `gcloud run deploy … --quiet`):
  100 % traffic; `/api/version` reports it; scratchpad `deploycheck.cjs` (coder, self-checked) — index.html and all 33 assets
  equal to the local build of the same export modulo hashes and the build label (served 20:55 МСК, local 20:53 МСК).
- **Trigger:** the owner ran `setupKanCostWatchTrigger` in the editor after the backlog (queue empty, so its first runs send
  nothing).
- **Still open:** the browser path on a real Ozon shipment (green toast, ✓ in «История», the figure in KAN); the ✗ buttons in
  the 240 px cell are seen only on a failure; the `apply` answer shape is now observed only through the sender's success (the
  log does not print it); a KAN `delete` (deleted shipment day) has never run live.

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
