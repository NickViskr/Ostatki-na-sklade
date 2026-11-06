# Item 97 rollback — the complete plan (orchestrator, 2026-11-06)

Written for a FRESH session that knows nothing else. Read this whole file first, then `AGENTS.md`. Do not
re-ask the owner anything answered in §1; ask (AskUserQuestion, one question at a time, recommended option
first) only where this file says «ASK».

Repository: `/Users/nikolajvyskrebencev/AI Project/Projects/Ostatki na sklade/repo` (always absolute paths —
the shell cwd drifts to the parent folder). Branch `work/cloud-run-and-tests`. HEAD when this plan was written:
`9faf7a0` (plus the commit that adds this file). Live: Code.gs @219, Cloud Run `sklad-00124-dgf`. Apps Script
versions in use: 153 of 200.

## 0. Rules that apply to every step (from the owner and AGENTS.md)

- Answers to the owner: Russian, detailed, the owner is not a programmer (where to click, what he should see).
  Everything written into files, briefs and commit messages: English.
- Pipeline: the **tester writes the failing checks first, then the coder fixes** (the orchestrator never writes
  tests). The orchestrator reads the server diff itself after every coder run and re-derives one or two key
  figures by code. Never two agents on the same files at once.
- EVERY agent brief contains the line: **«Use npm/npx only, never pnpm (the pnpm hook breaks this repo).»**
- Money tier for anything touching money, write-offs, sheet writes, dates: mutations 3–5 per change, whole path,
  stand runs under `TZ=Asia/Yekaterinburg` AND `TZ=UTC`. The stand's default script zone is Moscow; checks with
  dates call `h.setScriptTimeZone('Asia/Yekaterinburg')`. `GAS_ONLY=<name part>` does NOT narrow the run (whole
  stand ≈25 s); `GAS_QUIET=1` prints only failures and the total.
- Known flakes in the full vitest run: `src/lib/twinRulesParity.test.ts` and `src/store/weekFiles.test.ts`
  («10 MB boundary») may time out under load — rerun that file alone before calling it red.
- NEVER touch item 93 (KAN cost auto-send: `sendOzonCostToKan`, `kanCostWatch`, `switchOzonCostToManual`,
  `getOzonCostKanMarkers`, the browser send step) — only verify it still works.
- Never send anything to KAN by hand (reading `get_product_costs` for verification is fine). Ozon: read only.
- Nothing is deployed without the owner's word. `git push` only on «отправляй в гитхаб». clasp and Cloud Run
  are run by the assistant on the owner's word (procedure §6). Commit after each finished task; never amend.
- The repository is PUBLIC: never write a spreadsheet id, script id, token, password, INN or bank detail into
  any committed file. The «БД Склад» id is found with the Drive connector (`search_files`,
  `title = 'БД Склад' and mimeType = 'application/vnd.google-apps.spreadsheet'`); the script id is in the
  git-ignored `repo/.clasp.json`.
- Live sheets are read ONLY as an xlsx export: Drive connector `download_file_content` with
  `exportMimeType = application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` → the result lands in a
  tool-results JSON file → decode `content` (base64) with node → read with the repo's `xlsx` package
  (`require('<repo>/node_modules/xlsx').readFile(f, { sheets: [...] })`). Never load «Пользователи» or «Сессии».
  This Mac has no `jq` and no `openpyxl`.
- The browser: the built-in browser pane, the app at the Cloud Run URL
  (`gcloud run services describe sklad --region europe-central2 --project gen-lang-client-0852456590 --format='value(status.url)'`).
  If it shows the login form, ASK the owner to log in himself — never type a password. Right after login the
  popup «Отгрузки Ozon ждут оформления» appears — close it with «Позже». Use 1440×900; read with
  `get_page_text` / `read_page`, click by refs.

## 1. The owner's decisions (2026-11-06) — final, do not re-ask

The owner rolls back item 97 (contractor's weekly invoice spread + automatic write-off at handover): too
complex and opaque. Supplies are again written off by hand («Оформить» in «Поставки Озон») with services typed
by hand. KEEP only the automatic KAN cost send after a write-off (item 93). Ticket 09 is CANCELLED.

| # | Question | Decision |
|---|---|---|
| 1 | Depth | **Switch off and hide.** Server code stays but is dormant; buttons/columns hidden; returning = one deployment |
| 2 | «Неделя» label, filter, manual week in «Поставки Озон» | **Remove from the screen.** The poll stops detecting the handover and stops writing «Журнал статусов Ozon». Columns stay in the sheet |
| 3 | «Файлы недели» block | **Remove from the screen.** Upload/delete refused by the server. The PDF stays on Google Drive |
| 4 | Item-97 sheets of «БД Склад» | **DELETE** the six sheets «Счета подрядчика», «Строки счетов», «Упаковка недели», «Доли счетов», «Распределения счетов», «Журнал статусов Ozon» — after a full Drive copy of «БД Склад» and only after the new Code.gs is live (old code would recreate them) |
| 5 | Fixed sums of week 44 on 5 «История» rows | **Remove both** (step-1 packaging 685.00 and invoice share 4 093.00); the owner then types services himself through «Вся отгрузка» |
| 6 | Light status polls (hourly 09–22 Ekb + one-offs 23:00/23:30/23:45) | **Remove all.** The new code deletes those triggers by itself when they next fire; nothing for the owner to do |
| 7 | Main poll | **11:00 and 20:00 МСК, as before item 97** (item 86). No change |

What STAYS (do not remove, do not break):
- Ticket 01 (`f41a2af`): «Отгрузка» gear removed, kopeck-exact shipment extras, the interrupted-operation memo
  and popup «Операция не завершена».
- `a9b2894` (ticket 08 part B): the pencil re-points the «Внешние отгрузки» TransGroupInfo of a posting to the
  new History row id — a general fix.
- Ticket 08 part A guards inside the pencil (`updateTransaction`), peresort (`commitShipmentPeresort`) and
  receipt-price replay (`applyReplayCorrections`): with empty «Упаковка недели»/«Счёт недели» cells they behave
  byte-for-byte as before item 97, so they are harmless and stay.
- The «История» columns «Упаковка недели», «Счёт недели» (and `RESTORED_LATE_CELLS`, bulk restore handling).
- The «Внешние отгрузки» columns «Передача с/по/тип», «Неделя», «Неделя вручную», «Автосписание» and their
  values (16 postings carry «Неделя вручную» = 2026-W44) — data untouched, just no longer written or shown.
- `a048668`'s full cache drop after a poll, `d269c2b` store body fix — harmless.
- All server functions of item 97 stay in the code (dormant) together with their existing stand checks.

## 2. Live facts (xlsx export of «БД Склад», 2026-11-06 ≈14:00 Ekb, + Cloud Run log)

1. **No automatic write-off ever happened.** No posting of «Внешние отгрузки» (272 rows: 247 processed,
   16 ignored, 9 new — all 9 new are CANCELLED orders of 11.10) has a value in «Автосписание»; no «История» row
   has the author «Автосписание». Reason: no handover was ever detected — «Передача по» is empty on every row.
   So the owner's «list of auto-written-off supplies without services» is EMPTY. Tell him so.
2. **The «Автосписание» switch was pressed 2026-11-06 09:02:39 UTC (14:02 Ekb)**: `getOzonSyncStatus` answered
   7040 bytes before and 7031 after — 9 bytes shorter = a 13-digit `autoWriteOffSince` became `null`. Almost
   certainly OFF; CONFIRM on screen («Настройки» → «Автосписание выключено») in Task 0.
3. **Week 44 was applied today** (13:49–13:55 Ekb, user «администратор»): orders 135507457-1 and 135475876-1
   (Mercurius) were written off by hand as ONE combined shipment (Отгрузка `06192f17-397a-4206-a245-f1a8c0b132f5`,
   OpIDs `…-1` and `…-2`, 137 pcs, «Дата поставки» 2026-10-31); then step 1 saved 5 ₽/шт for 4 articles
   (685.00) and invoice № 5477 of 02.11.2026 was applied with lines 2 «стикеровка» 139 × 5 = 695.00 and
   3 «Доставка на СЦ OZON ФБО (формируемый палет)» 2 × 1 699 = 3 398.00 (4 093.00). Stickering is counted TWICE
   (685 + 695). At the write-off itself (13:49) the rows carried ≈ 4 177 ₽ of typed extras (derived from the
   journal unit costs, ±1 ₽ rounding); step 1/2 replaced them — tell the owner, so he knows what he typed.
4. The five rows (sheet «История», current values; P = «Упаковка недели», I = «Счёт недели»):

| sheet row | ID | OpID | Артикул | Кол-во | Цена | Себестоимость списания | Сумма | P | I | Сумма AFTER | Цена AFTER |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 363 | `764b9e01-e6d1-4a47-912b-cdd59096af24` | …-1 | Органайзер_3_пол_PureWhite | 27 | 797.73 | 20429.28 | 21538.80 | 135 | 974.52 | 20429.28 | 756.64 |
| 364 | `9ca0582b-2dd5-49f0-8d1b-527e1db9d574` | …-2 | Органайзер_3_пол_PureWhite | 34 | 796.04 | 25725.76 | 27065.19 | 170 | 1169.43 | 25725.76 | 756.64 |
| 365 | `8741b8c1-9ab5-4177-ad86-cc10ed85d6ca` | …-2 | Органайзер_полка_черн | 40 | 895.82 | 34853.20 | 35832.82 | 200 | 779.62 | 34853.20 | 871.33 |
| 366 | `d7ee42ff-ab98-4dae-9e2f-25fe89cc77c0` | …-2 | Полка_выдв_27см_черн | 24 | 723.07 | 16454.16 | 17353.78 | 120 | 779.62 | 16454.16 | 685.59 |
| 367 | `0afaca63-fcfc-4ffb-af54-1f7094f5f123` | …-2 | Полка_выдв_27см | 12 | 733.32 | 8350.08 | 8799.89 | 60 | 389.81 | 8350.08 | 695.84 |

   Totals: goods 105 812.48 + P 685.00 + I 4 093.00 = 110 590.48. AFTER = Сумма − P − I (= «Себестоимость
   списания» exactly), Цена AFTER = round half-up of Сумма AFTER / qty (computed with Python Decimal).
   «Объект» of row 363 ends with ` [Счёт № 5477 от 02.11.2026: 974,52₽]`, rows 364–367 with
   ` [Счёт № 5477 от 02.11.2026: 3118,48₽]`; before that tag: `Ozon (Mercurius) [Общая поставка: заявки
   № 135507457-1, № 135475876-1; доля этой заявки N из 137 шт., 0.00 руб. из 0.00 руб.]` — that part STAYS.
   No other «История» row has a value in «Упаковка недели» or «Счёт недели».
   RE-READ the live export before relying on these figures — the owner may have changed something since.
5. Item-97 sheets now: «Счета подрядчика» 1 row (invoice № 5477, 20 715.07), «Строки счетов» 5, «Упаковка
   недели» 4 (W44, 5 ₽), «Доли счетов» 5 (Σ 4 093.00), «Распределения счетов» 1, «Журнал статусов Ozon» 31
   (last 2026-11-05). PDF «Счёт 5477 от 2026-11-02 (1).pdf» lies on Drive in «Мой диск / Разработка / Складской
   учет / Файлы недель / 2026-W44» — stays.
6. Journal «Себестоимость Озон» (126 rows): rows 118–122 = the write-off at 13:50 (accepted by KAN, e.g.
   «КАН принял 806,20»); rows 123–127 = the re-issue after step 1/2 (source «пересчёт после правки прихода»,
   «Время КАН» first-seen 13:56:17, not yet sent at export time — kanCostWatch sends them by itself).
7. Noticed in passing, NOT item 97, do not fix here: «История» has TWO «Комментарий» columns (15 and 17) and TWO
   «Отгрузка» columns (16 and 18) since item 90 (late September); the comment columns already differ (12 vs 11
   non-empty). In Task D ASK the owner whether to record it as a new plan item.

## 3. Order of work

Task 0 (live state) → Task A (server) → Task B (screen) → Task C (one-off for the data) → full run → owner's
word → deploy Code.gs → deploy Cloud Run → Drive copy of «БД Склад» → owner runs the one-off (dry run, then
apply) → verify → owner types services via «Вся отгрузка» → verify KAN → live screen check → Task D (docs).
Tasks A, B, C touch different files but run them ONE AT A TIME (lower risk, simpler review). Each ends with a
commit. Each touches > 3 files only where listed — that is agreed.

## Task 0 — confirm the live state (orchestrator, read only, ≈10 min)

1. Fresh xlsx export of «БД Склад» (procedure §0) into the session scratchpad; re-check §2.4 (five rows, no other
   fixed sums), §2.5 (sheet row counts), «Автосписание» column still empty everywhere.
2. Browser: ask the owner to log in if needed; «Настройки» → the «Автоопрос Ozon» block shows «Автосписание
   выключено». If it says «включено с …», ask the owner to press «Выключить» himself, then re-check.
3. Cloud Run log (read only), to see nothing new of item 97 happened since 09:05 UTC 2026-11-06:
   `gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="sklad" AND (textPayload:"applyInvoiceSpread" OR textPayload:"saveWeekPackaging" OR textPayload:"saveContractorInvoice" OR textPayload:"setOzonAutoWriteOff")' --project gen-lang-client-0852456590 --freshness=7d --limit 20 --format='value(timestamp,textPayload)'`
Check: all three agree with §2; otherwise stop and tell the owner what differs.

## Task A — server: item 97 dormant (Code.gs + stand), money tier

### Design (give this to tester and coder)

One switch in Code.gs, near the other item-97 constants:
```js
/** Item 97 rolled back 2026-11-06 (owner): every item-97 path is dormant. Returning = make this return true + deploy. */
function item97Enabled_() { return false; }
const ITEM97_DISABLED_MESSAGE = 'Функция отключена: пункт 97 (счёт подрядчика по неделе) откатан 06.11.2026';
```
It is a FUNCTION (not a const) so the stand can override it (`context.item97Enabled_ = () => true`) and keep the
existing item-97 checks running against the dormant code.

A1. **doPost refuses every item-97 action** — read and write — when `!item97Enabled_()`, with
  `throw new Error(ITEM97_DISABLED_MESSAGE)` (answered as the normal `{status:'error', message}`), placed
  right after the session check and BEFORE the early lock-free branch of `listWeekFiles`/`getWeekFile`
  (Code.gs ≈:212). Actions: `setExternalShipmentWeek`, `listWeekFiles`, `getWeekFile`, `uploadWeekFile`,
  `deleteWeekFile`, `saveContractorInvoice`, `listContractorInvoices`, `deleteContractorInvoice`,
  `getWeekPackaging`, `saveWeekPackaging`, `setInvoiceLinePackaging`, `getInvoiceSpread`,
  `applyInvoiceSpread`, and `setOzonAutoWriteOff` with `enabled === true` (switching OFF stays allowed).
  Reads are refused too because `listContractorInvoices` etc. would otherwise RECREATE the deleted sheets
  (`getOrCreateSheet`). The proxy needs no change: `/api/contractor-invoice/read` calls `getWeekFile` first
  (refused → Gemini is never called), `/api/week-files/upload` forwards `uploadWeekFile` (refused).
A2. **`saveExternalShipments`** (Code.gs :9498–:9718): when `!item97Enabled_()` — no `decideExternalHandover`
  (no writes to «Передача с/по/тип», «Неделя»), no `logStatus`/`appendOzonStatusLog` (the status-log sheet is
  neither written nor created), no `ozon_lastStatusPollAt(_test)` stamp write, no `runOzonAutoWriteOff_()`
  (return `autoWriteOff: { written: [], refused: [], failed: [] }`). Everything else (statuses, new rows, item
  JSON, cancelled orders…) byte-for-byte as before.
A3. **`runOzonAutoWriteOff_`** itself also returns the empty result at its top when `!item97Enabled_()` (second
  lock, in case another caller appears), even if Script Property `ozon_autoWriteOffSince` is set.
A4. **Triggers** (Code.gs :13286–:13372):
  - `setupOzonSyncTriggers` creates ONLY the two `scheduledOzonCheck` triggers (11 and 20, `Europe/Moscow`) when
    `!item97Enabled_()`.
  - `scheduledOzonStatusCheck` and `runOzonStatusPollAt`, when `!item97Enabled_()`: delete EVERY trigger whose
    handler is `scheduledOzonStatusCheck` or `runOzonStatusPollAt`, delete Script Properties
    `ozon_eveningPollsDate`, `ozon_statusPollRunning`, `ozon_statusPollHistory`, and return WITHOUT polling
    (no `/api/ozon/check` fetch, no session row). This is how the live hourly and evening triggers disappear by
    themselves within an hour of the deployment.
  - `removeOzonSyncTriggers` unchanged (still removes all three handlers).
  - `scheduledOzonCheck` unchanged (its wait for `ozon_statusPollRunning` is inert once the property is gone).
A5. **No item-97 sheet is ever created by a non-item-97 path.** Audit every `getOrCreateSheet` of the six names
  (found 2026-11-06: `appendOzonStatusLog` :9493, `saveContractorInvoice` :10486–:10487, `saveWeekPackaging`
  :10979, `applyInvoiceSpread` :11494/:11499 — all behind A1/A2 now) and every `getSheetByName` reader
  (`repointInvoiceShares` :2134 returns early when the sheet is absent — keep it that way; `readWeekPackagingSheet`,
  `readInvoiceSharesSheet`, `readInvoiceInputsSheet`, `setInvoiceLinePackaging`, `listContractorInvoices`,
  `deleteContractorInvoice` must tolerate a missing sheet). The pencil and peresort paths call
  `repointInvoiceShares` — with the sheets deleted they must neither throw nor recreate.
A6. Nothing else changes. Do not touch item 93 functions, `commitTransaction`, `updateShipmentExtras`,
  `reissueOzonCostRows`, the ticket-01 memo code.

### Tester brief (first), ≈10 new checks, money tier
Write failing stand checks in `tests/apps-script/run-tests.cjs` (style: `check(name, condition, details)`,
`freshHarness()`, `callDoPost` with `data: {...}`; look at the existing ticket-02/03 checks around line ≈15560
for trigger fakes `h.triggerSpecs()` and `call(h, 'scheduledOzonStatusCheck')`):
1. Each item-97 action through `callDoPost` answers the error text of `ITEM97_DISABLED_MESSAGE` and changes
   nothing (no sheet created — test with the six sheets absent; no History cell changed).
2. `setOzonAutoWriteOff` `{enabled:true}` refused, property stays absent; `{enabled:false}` still works.
3. `saveExternalShipments` with the property `ozon_autoWriteOffSince` SET, a new posting whose order state is
   `ACCEPTED_AT_SUPPLY_WAREHOUSE` and `ozonStatusDate` inside the window, prev stamp present: no History row, no
   cost-journal row, «Автосписание» / «Передача по» / «Неделя» empty, «Журнал статусов Ozon» not created, stamp
   property not written; statuses and new rows still saved as before.
4. `scheduledOzonStatusCheck` at 10:00 Ekb with one hourly + three evening triggers installed: all four
   deleted, the three properties gone, no fetch made (UrlFetchApp fake records no call), the two
   `scheduledOzonCheck` triggers untouched. Same for `runOzonStatusPollAt`.
5. `setupOzonSyncTriggers` (if the stand cannot run it, the existing source-regex style of check ≈:9214):
   exactly two `scheduledOzonCheck` triggers at 11 and 20 Europe/Moscow, no `scheduledOzonStatusCheck`.
6. Pencil quantity edit and a peresort of an Ozon expense with the six sheets absent: no sheet created, the
   row results identical to the same operation on a pre-item-97 shaped row (empty fixed cells).
7. Whole path (regression for the owner's main flow): manual «Оформить» of a posting with services typed
   (`commit` through `callDoPost`, destination `Ozon (<cabinet>)`, `postingIds`) writes the «Расход» rows with
   the services inside «Сумма», appends the «Себестоимость Озон» row(s) for that OpID, links the posting; then
   `kanCostWatch` (with the existing `fakeKan` helper ≈:3413) gives the new journal row its first-seen «Время
   КАН» and, ≥ 5 min later, sends it and marks «принято». Then «Вся отгрузка» (`updateShipmentExtras`) on that
   shipment changes services and the journal gets the re-issue. If equivalent checks already exist, name them
   in the report instead of duplicating.
Existing item-97 checks that now fail because of the switch: do NOT delete them — run them with
`context.item97Enabled_ = () => true` (restore after), so the dormant code stays tested. Report which ones.
Runs: `GAS_QUIET=1 npm run test:gas`, then `TZ=Asia/Yekaterinburg` and `TZ=UTC` runs. Report the red list.
Brief line: «Use npm/npx only, never pnpm.»

### Coder brief (second)
Implement A1–A6 until the tester's checks pass; the whole stand green under both TZ; `npx tsc --noEmit` only
if TS changed (it should not). 3–5 mutations by the tester afterwards (e.g. `item97Enabled_` → true; drop the
`appendOzonStatusLog` guard; let `setupOzonSyncTriggers` create the hourly trigger; let doPost forget one
action; let `scheduledOzonStatusCheck` keep the evening triggers) — each must turn a check red; mutate by line
number. Commit: `Item 97 rollback A: item-97 server paths dormant (doPost refuses, no handover/status log, light polls remove themselves)`.

### Orchestrator check
Read the Code.gs diff yourself: the switch, the refusal list (14 actions incl. `setOzonAutoWriteOff` on),
saveExternalShipments guards, triggers. Confirm no item-93 function appears in the diff
(`git diff HEAD~1 -- Code.gs | grep -n -E "Kan|kan"` → only context lines).

## Task B — screen: hide item 97 (cosmetic tier, no tester agent)

New file `src/lib/item97.ts`: `export const ITEM97_ENABLED = false;` with a one-line comment (rolled back
2026-11-06; returning = true + deploy). Gate with `{ITEM97_ENABLED && …}`:
- `src/components/OzonSuppliesTab.tsx`: the «Неделя» filter select (≈:1901–:1912), the «Окно недели» button
  and `WeekWindowModal` (≈:1917–:1921), `WeekFilesBlock` (≈:1923; it holds «Файлы недели», «Распознать»,
  «Ввести счёт вручную», «Счета недели», `ContractorInvoiceModal`), the per-posting «Неделя» label / admin week
  select (≈:2275–:2300), the «проверьте неделю» mark (≈:2303), the badges «ждёт счёта» / «спишите вручную»
  (≈:2311–:2321). With the filter hidden `weekFilter` stays `'all'` — the list must not be filtered by week.
- `src/components/SettingsTab.tsx`: the «Автосписание» line and its two buttons (≈:563–:590). «Автоопрос Ozon»
  with 11:00/20:00 stays.
- Keep `WeekWindowModal.tsx`, `ContractorInvoiceModal.tsx`, store methods, types — unused, not deleted.
Checks (1–2): a vitest that `ITEM97_ENABLED` is false, and — if the components are not renderable in vitest
(no testing-library in this repo) — a source-level test that each gated block in the two files sits behind
`ITEM97_ENABLED`. `npx tsc --noEmit` clean, `npx vitest run src/lib/item97.test.ts`.
This touches 4 files (new item97.ts + test, two tabs) — agreed. Done by ONE coder agent (brief with
«Use npm/npx only, never pnpm.»). Commit: `Item 97 rollback B: week, week files, week window, invoices and auto write-off hidden`.

## Task C — one-off for the week-44 data and the six sheets (money tier)

File `.scratch/item-97-contractor-invoice/rollback-oneoff.gs` (never pushed: `.claspignore` lets only
Code.gs, ChinaOrders.gs, appsscript.json out). Model: `.scratch/item-93-kan-cost-api/ticket06-oneoff.gs`.
The owner pastes it as a NEW script file into the live Apps Script project (which then already runs the new
Code.gs) and runs two functions by hand. All files of a project share one scope: call Code.gs functions directly.

- Constants: the five rows of §2.4 (id, opId, article, qty, «Себестоимость списания», Сумма, P, I, the exact
  invoice tag text, target Сумма and Цена), the six sheet names with their expected data-row counts
  (Счета подрядчика 1, Строки счетов 5, Упаковка недели 4, Доли счетов 5, Распределения счетов 1; «Журнал
  статусов Ozon» any count). RE-CHECK the constants against the Task-0 export before committing.
- `tmp97RollbackDryRun()` — writes NOTHING; logs (Logger.log) per row old → new Сумма/Цена/Объект, which journal
  entries would be re-issued (`weekPackagingStaleJournalEntries` over the candidates, see below), which sheets
  would be deleted with their row counts, and every guard result.
- `tmp97RollbackApply()` — under `LockService.getScriptLock().waitLock(30000)`; ALL guards before the first
  write, any failed guard throws and writes nothing:
  1. `getSpreadsheet()` is the production DB (`_devModeSpreadsheet` not set).
  2. Each of the five ids found exactly once in «История» (`getTransactionSheet`, header lookup by name — note
     the DUPLICATE «Комментарий»/«Отгрузка» headers: use the existing header helpers, never `indexOf` of those
     two), type «Расход», article/qty/OpID equal; per row EITHER the «before» state (Сумма, P, I, tag exactly as
     §2.4) OR the «after» state (P and I empty, Сумма = target, no «[Счёт №» tag) — anything else refuses.
  3. No OTHER «История» row has a non-empty «Упаковка недели» or «Счёт недели».
  4. Each present sheet among the six has the expected row count (status log: any).
  Writes, in this order (idempotent — a rerun after a cut-off finishes the job without doubling):
  a. For each row still in the «before» state: «Сумма» = target, «Цена» = target, «Объект» = text without the
     ` [Счёт № 5477 от 02.11.2026: …₽]` tag, «Упаковка недели» = '' and «Счёт недели» = '' — cell by cell by
     header name (kopecks: integer arithmetic, `/100` once). `SpreadsheetApp.flush()`.
  b. Journal: candidates shaped exactly as `saveWeekPackaging` builds them (Code.gs ≈:10946: `{ id, opId, date,
     kanDay: ozonCostDayFor(deliveryDate, date), operationDay, destination, article, quantity, oldUnitCost,
     newUnitCost }`) for the five rows → `reissueOzonCostRows(weekPackagingStaleJournalEntries(candidates),
     'откат пункта 97')`. A failure is logged and the function stops BEFORE deleting sheets (rerun heals).
  c. Delete each of the six sheets that still exists (`ss.deleteSheet`). Log what was deleted.
  d. Log a summary: rows changed, journal rows appended, sheets deleted.
- Tests (tester agent, ≈6 checks, 3 mutations): load the one-off into the stand context after Code.gs (as the
  ticket-06 one-off was replayed), with a fixture shaped like the live data (the five rows, the journal rows
  118–127 of §2.6, the six sheets): dry run writes nothing; apply gives exactly the AFTER figures of §2.4,
  Σ Сумма = 105 812.48, the journal's latest cost per OpID/article = new «Цена», the six sheets gone; a second
  apply writes nothing; a cut-off after step a then a rerun appends the journal once; a tampered row (Сумма
  +0.01) refuses with nothing written. Then REPLAY on the real Task-0 xlsx export (load «История», «Себестоимость
  Озон» and the six sheets into the stand) — same results. Brief line: «Use npm/npx only, never pnpm.»
Commit: `Item 97 rollback C: one-off to remove the week-44 fixed sums and delete the item-97 sheets`.

## 4. Full run before deployment (tester or orchestrator, once)

`npx vitest run` (plain), `TZ=Asia/Yekaterinburg npx vitest run`, `npm run test:gas` under `TZ=Asia/Yekaterinburg`
and `TZ=UTC`, `npx tsc --noEmit`. Flakes per §0. Record counts in `docs/TEST_LOG.md` in Task D.

## 5. Owner's word, then deployment (orchestrator runs it)

ASK the owner in Russian whether to deploy (explain: Code.gs first, then the site; nothing changes in data yet).

### Code.gs
```bash
cd "/Users/nikolajvyskrebencev/AI Project/Projects/Ostatki na sklade/repo" && clasp versions | tail -3
```
(count must leave room: < 200). Then:
```bash
cd "/Users/nikolajvyskrebencev/AI Project/Projects/Ostatki na sklade/repo" && clasp push
```
(expect 3 files: appsscript.json, Code.gs, ChinaOrders.gs)
```bash
cd "/Users/nikolajvyskrebencev/AI Project/Projects/Ostatki na sklade/repo" && clasp deploy -i AKfycbxRb4HXyqUsqqk1x5ScRgL44O1YUOlmpemCn0AAcIB50Rh5kXKeaNxAWMU2NDZTU4F3 -d "Item 97 rollback: dormant and hidden"
```
Verify: `clasp list-deployments` shows the new version (expected @220) on that deployment id; then in an empty
scratchpad folder `clasp clone-script <scriptId from repo/.clasp.json> <version>` (version is a positional
argument) and `cmp` its `Code.js` with `repo/Code.gs` and `ChinaOrders.js` with `repo/ChinaOrders.gs` — both
equal. No new OAuth scope is added by this change (no re-authorization expected).

### Cloud Run (only after Code.gs)
1. Clean export: `git archive HEAD | tar -x -C <scratchpad>/export`; `cd <scratchpad>/export && npm ci && npx vite build`.
2. From that folder: `gcloud run deploy sklad --source . --region europe-central2 --project gen-lang-client-0852456590 --quiet`.
3. `deploycheck.cjs` (rebuild in the scratchpad, it is per session): fetch the served `index.html` and every asset
   it references (script src, link href, modulepreload), then walk every JS chunk's imports to fetch the
   LAZY chunks too; compare with the local `dist/` of the same export after normalising: file names without
   the hash (the last 8 characters `[A-Za-z0-9_-]` before the extension), the same hashes stripped INSIDE file
   contents (chunks import each other by hashed name), the build label «Сборка … МСК» and any bare
   `yyyy-MM-dd HH:mm МСК`. Expect every served file equal (≈35). `/api/version` reports the new revision.
4. Record revision and version (Task D).

## 6. Data step (after both deployments)

1. Drive copy of «БД Склад» (Drive connector `copy_file`), name «БД Склад — резервная копия перед откатом пункта
   97 (2026-11-DD)». Check it exists (search_files) — tell the owner its name.
2. Wait until the Code.gs deployment is live; check in the Cloud Run log / a fresh export that the status log
   stopped growing (no new «Журнал статусов Ozon» rows after the next hourly run).
3. Give the owner step-by-step instructions (Russian): open «БД Склад» → Расширения → Apps Script → «+» next to
   «Файлы» → «Скрипт» → name `tmp97` → paste the whole `rollback-oneoff.gs` (give him
   `LANG=en_US.UTF-8 pbcopy < "<path>"` to copy it, Cyrillic breaks otherwise) → Ctrl+S → choose
   `tmp97RollbackDryRun` → «Выполнить» → «Журнал выполнения» → send the log text to the assistant.
   Compare the log with §2.4. Only then: `tmp97RollbackApply` → log → then delete the file `tmp97` (⋮ →
   «Удалить»). The next `clasp push` would remove it anyway.
4. Verify on a fresh export: the five rows = AFTER figures, no «[Счёт №» tag, P/I empty; the six sheets gone;
   the journal's newest rows for OpIDs `06192f17-…-1/-2` carry the new «Цена» (756.64 / 756.64 / 871.33 /
   685.59 / 695.84) and, within ≈20–35 min, «Статус КАН» = «принято» (kanCostWatch — this proves item 93 works
   on the new code). Optional read-only KAN check: `get_product_costs` for Mercurius, these articles, date
   2026-10-31.
5. The owner opens «История» → a row of that shipment → «Вся отгрузка», types the services he wants (remind
   him: at the write-off he had ≈ 4 177 ₽; the invoice lines were 695 stickering + 3 398 delivery), saves.
   Expect the green toast «КАН принял себестоимость: …» and ✓ in «История». Verify on a fresh export: Сумма =
   goods + services split over 137 pcs, journal re-issued, «принято».

## 7. Live screen check (browser, after Cloud Run)

Hard reload; build label «Сборка <today> … МСК». «Поставки Озон»: no «Неделя» filter, no «Окно недели», no
«Файлы недели», no week label or «проверьте неделю», no «ждёт счёта»/«спишите вручную»; cabinet filter and
«Оформить» present. «Настройки»: no «Автосписание» line; «Автоопрос Ozon» with 11:00/20:00. After the next
full hour: Cloud Run log shows no light poll (`/api/ozon/check` only at the 11:00/20:00 МСК runs). The manual
«Оформить» path is held by the stand (§Task A check 7); its live check comes with the next real supply — the
owner does it, the assistant verifies the journal row and «принято».

## Task D — documents, commit, memory, prompt

1. `docs/OZON_PLAN.md` (separate docs task rule: backup copy first to `~/.claude/backups/OZON_PLAN.md.<date>`,
   after the edit `grep -cE '^- (⬜|🟨|✅) [0-9]+\.' docs/OZON_PLAN.md` must still print 101):
   - item 97 (line ≈282): append «ROLLED BACK 2026-11-DD (owner 2026-11-06): …» — what is dormant (server switch
     `item97Enabled_`, screen flag `ITEM97_ENABLED`), what stays (ticket 01, `a9b2894`, guards, columns), data
     (week-44 sums removed by the one-off, six sheets deleted after the Drive copy «…», PDF on Drive), ticket 09
     cancelled. ASK the owner: glyph ⬜ → ✅ («closed as rolled back», recommended) or keep ⬜.
   - «Очередь дальше» block: REPLACE in place (status line, «Live:», «Code.gs:», «Checks:», «Git:») — never
     append dated paragraphs.
2. `.scratch/item-97-contractor-invoice/issues/02…08-*.md`: «Status:» → «rolled back 2026-11-DD — dormant, see
   ../rollback-plan.md»; `09-*.md` → «wontfix — cancelled by the owner 2026-11-06»; `01` stays done.
   Add a «Rollback result» section at the end of this file (revisions, counts, what the owner did).
3. `docs/DEVLOG.md`, `docs/TEST_LOG.md`: append one table row per step (append-only).
4. ASK the owner about §2.7 (duplicate «Комментарий»/«Отгрузка» columns) — record as a new plan item or not.
5. Commit `Docs: item 97 rolled back (Code.gs @NNN + sklad-NNNNN-xxx)`. No push without «отправляй в гитхаб».
6. Memory (`~/.claude/projects/-Users-nikolajvyskrebencev-AI-Project-Projects-Ostatki-na-sklade/memory/`):
   update `contractor-invoice-allocation-2026-10-21.md` (rollback done, what stays, how to return) and its line
   in `MEMORY.md`.
7. End with a paste-ready Russian prompt for the next session (what is left: the owner's live «Оформить» check
   on the next real supply, push on his word, next plan item — items 96.2–96.9 / 96.11 are next in the queue).

## 8. Traps (read before acting)

- `clasp push` deletes on the server every file that is not local — the owner's pasted `tmp97` file vanishes on
  the next push (fine, but never push while he is running it).
- The stand does not auto-convert text dates into Date cells (Google Sheets does) — use `h.FakeDate` where a
  check needs a Date cell.
- `getSKUs` reads an empty «штук в коробе» as 1 — irrelevant now, but do not «fix» it here.
- «История» header lookups: two «Комментарий» and two «Отгрузка» columns live; never write by a fresh
  `indexOf` of those names in new code.
- `reissueOzonCostRows` also re-writes LATER links of an article's chain (moving average) — a check expecting
  journal rows only for the five rows is wrong; check the latest cost per OpID/article instead.
- Ozon MCP `ozon_call_method` times out from this Mac — not needed here.
- The KAN chat connector drops for a minute after a burst — retry, never resend a write.

## Rollback result (2026-11-06)

- Task 0: live state matched §2 (five rows, sheet counts 1/5/4/5/1/31, «Автосписание» column empty, screen «Автосписание выключено», no item-97 action in the Cloud Run log after 09:02:39 UTC). Extra: journal rows 123–127 were already accepted by KAN at 14:11 (item 93 working).
- Task A `d8a0f3e` + `71af05a` (Code.gs): `item97Enabled_()` = false, `ITEM97_ACTIONS` refused in doPost, `saveExternalShipments` guards, `runOzonAutoWriteOff_` guard, `removeItem97PollTriggers_`; the stand's `freshHarness()` runs older checks with the switch ON, `freshHarnessItem97Off()` the new ones. 18 new stand checks; 5 mutations, one survived (the switch itself) → check added. `71af05a`: the refusal compares `setOzonAutoWriteOff` through a list because the item-89 parser in `src/lib/gasActions.test.ts` reads any `action === '<name>'` before the lock as an early-answered action.
- Task B `d5c759d`: `src/lib/item97.ts` `ITEM97_ENABLED` = false gating «Неделя» filter/label, «Окно недели», WeekFilesBlock, badges, and the «Статус автосписания» block of «Настройки»; `src/lib/item97.test.ts` 2 checks.
- Task C `622f312`: `rollback-oneoff.gs` + runner `rollback-oneoff.test.cjs` (111 checks; 151 with `ROLLBACK_XLSX`), harness `deleteSheet` + `registrySheetNames`; 3 orchestrator mutations all caught.
- Full run before deployment: stand 1873/0 (Ekb, UTC), vitest 2994 + 1 expected fail (plain, Ekb), tsc clean.
- Deployed by the assistant on the owner's word: Code.gs @220 (154 of 200 versions; clone + cmp equal), Cloud Run `sklad-00125-gpm` (35/35 files equal by deploycheck).
- Drive copy: «БД Склад — резервная копия перед откатом пункта 97 (2026-11-06)», same folder; all 28 readable sheets equal to the Task-0 export.
- The owner ran the one-off: dry run 17:14 Ekb (all OK, figures as §2.4), apply 17:17 Ekb: rows changed 5, journal rows appended 5 (128–132), sheets deleted 6; then deleted the `tmp97` file. Verified on an export: only rows 363–367 changed, only Цена/Сумма/Объект/Упаковка недели/Счёт недели; Σ Сумма 105 812.48; journal «после» re-derived ((stock·cost + shipped·new)/(stock+shipped)) 806.33/792.92/769.53/698.91/708.96 = journal; KAN «принято» at 17:41 by `kanCostWatch`.
- The owner typed «Прочее» 4 097 ₽ through «Вся отгрузка» (≈19:56 Ekb): split 807.44 (27/137) + 3 289.56 (110/137), row increments sum to 4 097.00; new Цена 786.55/786.55/901.24/715.50/725.75; journal re-issue rows 133–137 accepted by KAN at 19:56 (805.94/774.60/705.21/711.97). The KAN sender also rewrites «Ответ КАН»/«Время КАН» of the older rows of the same OpIDs with the latest answer (existing item-93 behaviour, seen at 17:41 too).
- Light polls gone: no `/api/ozon/check` in the Cloud Run log after the deployment (they had run hourly at :50 UTC+3 until 13:50 МСК). Screen (build «2026-11-06 14:42 МСК»): «Поставки Озон» without any week text even on the 16 postings with «Неделя вручную» = 2026-W44; «Настройки» without «Автосписание»; no console errors. «Оформить» not visible (no new supplies) — its live check comes with the next real supply.
- Owner's answers in Task D: item 97 glyph → closed as rolled back; §2.7 recorded as plan item 102.
