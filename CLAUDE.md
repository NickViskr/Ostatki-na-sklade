# Складской учёт — project rules

Production warehouse-accounting app for selling on Ozon. Owner: Николай, not a programmer. An
accounting error is real money (01.08.2026: a double write-off of 118 pcs cost −66 604,38 ₽).
These are the invariants; the current state (live revision, open items, test counts) lives in
the «Очередь дальше» block at the end of `docs/OZON_PLAN.md` — read it first. History and
dossiers of closed work are in `docs/HISTORY.md`, `docs/DEVLOG.md`, `docs/TEST_LOG.md`.

## Language
Russian only for answers to the owner and for text the end user sees in the app (UI labels,
toasts, spreadsheet content). Everything else is English: code comments, test names,
docs, journals, plan entries, commit messages, memory, agent briefs. Existing Russian text is
not translated back; files drift to English as they are edited.

## Secrets — the repository `NickViskr/Ostatki-na-sklade` is PUBLIC
- No spreadsheet ids, tokens or passwords in `Code.gs` or any committed file. Foreign
  spreadsheet ids and the KAN MCP token live in Script Properties
  (`stock_summarySpreadsheetId`, `kan_mcpToken` etc.). KAN is reached ONLY from `Code.gs`
  (`UrlFetchApp` → `https://kultura-analitiki.ru/mcp/`, JSON-RPC `tools/call`); the token never
  passes through Cloud Run. It is the MCP token, not KAN's separate API token.
- `.clasp.json` (script id) is git-ignored and exists only on the owner's Mac in `repo/`.
- The «Пользователи» sheet holds a plaintext admin password — never copy it anywhere.
- The assistant never types a password to authenticate, even with the owner's permission.

## Git
- Branch `work/cloud-run-and-tests`. Commit when work is done; `git push` only on the owner's
  explicit word for that task («отправляй в гитхаб»); never amend.
- Session cwd drifts to the parent folder `~/Ostatki na sklade` — always use absolute paths
  into `repo/`.

## Build and tests (npm, never pnpm — the pnpm hook breaks this repo; use `npx`)
- `npx vitest run`, `npx tsc --noEmit`, `npx vite build`, `npm run test:gas` (Apps Script stand).
- Mutation testing is mandatory for new logic: a surviving mutation means a missing test or
  dead code. Test the whole path, not only the inner function.
- All numeric calculations are executed as code, never mental arithmetic.
- `npm audit fix` must not be run. The classifier refuses `rm -rf node_modules` — the owner
  does that.

## Deployment
- Frontend/proxy: Cloud Run service `sklad`, region `europe-central2`, project
  `gen-lang-client-0852456590`. Deploy ONLY with
  `gcloud run deploy sklad --source . --region europe-central2 --project gen-lang-client-0852456590 --quiet`
  from a clean `git archive HEAD` export built with `npm ci` in the scratchpad. `git push`
  deploys nothing; the Cloud Build triggers on `main` build two UNRELATED services.
- Verify a deployment by comparing the served chunks with the local build of the same export
  (scratchpad `norm.py`), then record the revision in the plan, DEVLOG and TEST_LOG.
- `Code.gs` (bound to «БД Склад»): TWO owner-run commands, ALWAYS from `repo/` — the
  classifier blocks them for the assistant:
  `cd "/Users/nikolajvyskrebencev/Ostatki na sklade/repo" && clasp push`
  then `clasp deploy -i AKfycbxRb4HXyqUsqqk1x5ScRgL44O1YUOlmpemCn0AAcIB50Rh5kXKeaNxAWMU2NDZTU4F3 -d "<what>"`.
  Push alone moves HEAD only; the /exec deployment is pinned to a version. Verify with
  `clasp clone-script <id>` into the scratchpad + `cmp`, and `clasp list-deployments`.
- Order when both change: `Code.gs` first, then Cloud Run.

## Data
- Live sheets are read ONLY via the Drive connector as xlsx → openpyxl (the text export
  truncates sheets). Never IMPORTRANGE into «БД Склад».
- Never create a real Ozon supply when testing. Warn before anything irreversible.
- Journals `docs/DEVLOG.md` and `docs/TEST_LOG.md` are append-only, one table row per step.
- Plan integrity: the ✅/⬜ counts of `docs/OZON_PLAN.md` change only when an item is
  legitimately added or closed; never type those glyphs inside prose.
- Diagnose calculation questions by replaying the production modules on an xlsx export
  through `npx vite-node <script>.ts`, and read the Cloud Run log lines `GASDIAG …` /
  `SUPPLYDOCS …`.
