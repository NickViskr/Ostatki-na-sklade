# 06: Full run, owner's deployment, live check, close item 88

**What to build:** the finished rework reaches the owner. Full set once (`npx vitest run`, `npm run test:gas`, `tsc`), clean `git archive HEAD` export built with `npm ci`, the owner runs the one Cloud Run deploy command; the orchestrator compares served chunks with the local build; the owner opens the tab and compares a few rows with what he saw before. Code.gs is not touched. Plan, DEVLOG and TEST_LOG updated; the item is closed only on the owner's word. Spec: `../spec.md`, Deployment.

**Blocked by:** 02, 03, 04, 05.

**Status:** done

- [x] Full set green (counts recorded in TEST_LOG)
- [x] Owner deployed; served chunks equal the local build modulo hashes and the build label; revision recorded
- [x] Owner's live check done
- [x] Item 88 closed in the plan on the owner's word

## Result (2026-09-29)

Full set on `d807280` (no code changed after `9edc66e`; `d807280` only renamed CLAUDE.md to
AGENTS.md): vitest 2470 + 1 expected fail in 61 files, stand 1126, tsc clean; no Yekaterinburg run
(dates untouched). Clean `git archive HEAD` export built with `npm ci` + `vite build`.

Owner deployed Cloud Run `sklad-00104-hr5` (100 % traffic, `/api/version` agrees). Served files vs
the local build of the same export: index equal modulo hashes; 30 of 34 chunks equal modulo hashes
(OzonStocksTab, Dashboard, OzonSettingsModal, ChinaOrdersTab, OzonSuppliesTab, ozonCoverageSource);
main chunk equal modulo hashes and the build label (11:21 vs 11:16 МСК); CSS short of the same 5
docs-only rules as `sklad-00103-tlw` (`w-auto`, `blur`, `invert`, `justify-start`, `opacity-60` —
`.dockerignore` keeps `docs/` out, no `src` use). Comparison script: scratchpad `norm.py` (fetch
index, follow chunk references by full hyphenated names, replace 8-char hashes, compare).

Owner's live check 2026-09-29: cabinets, article and cluster expansion, «Рекомендации» with ticks,
manual pick, «Фабрика» and «В заявках» cells, dashboard alert block — «всё как раньше».
`/code-review` not run for this ticket: no code diff. Item 88 CLOSED 2026-09-29 on the owner's word.
