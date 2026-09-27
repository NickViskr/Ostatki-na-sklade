Status: ready-for-agent

# Item 88 — «Остатки Озон» rework, stage 4 of 4: split the code, change nothing the owner sees

Plan item 88 in `docs/OZON_PLAN.md`. Decided with the owner 2026-09-27 (grilling Q1–Q10 and the
two test seams, all accepted as recommended). Vocabulary: `CONTEXT.md` (Coverage, Supply
recommendation, Factory signal, Pipeline «Труба», Open factory orders, Availability).

## Problem Statement

The owner runs the whole Ozon supply business off the «Остатки Озон» tab and the coverage block
of the dashboard: which cluster to ship to, how many pieces, when and how much to order at the
factory. Every new change to these screens has become slow and risky, because:

- the tab is one screen file of about 2 550 lines, and the calculations of its rows,
  supply recommendations, supply plan and «Фабрика» cell live inside that screen, partly untyped
  and without their own tests — a money mistake there is caught only by eye;
- the coverage library is one file of about 2 660 lines mixing speed, trend, stock history,
  clusters, factory and kit components;
- coverage is computed in four places (the dashboard, the tab, the tab's wide-window variant, the
  settings modal's «было → станет»), each assembling its inputs with near-copied code, so a rule
  change can reach three of them and miss the fourth.

## Solution

A pure rearrangement. After it the owner sees exactly the same figures, labels and colours on
the tab and on the dashboard, and the screens are no slower. What changes is underneath: one
shared way to compute coverage for all four places, one tested «tab model» that computes
everything the tab shows while the screen only draws it, the tab split into parts, and the
coverage library split by topic. Defects found on the way are written down and shown to the
owner, not fixed here.

## User Stories

1. As the owner, I want every figure, label and colour on «Остатки Озон» to stay exactly as it is, so that I can keep taking supply and factory decisions without re-learning the screen.
2. As the owner, I want the dashboard coverage block to stay exactly as it is, so that my morning check does not change.
3. As the owner, I want the tab and the dashboard to open no slower than today, so that the rework costs me nothing in daily use.
4. As the owner, I want the settings modal's «было → станет» figures to stay equal to what the tab shows for the same settings, so that I can trust the preview before saving.
5. As the owner, I want the supply recommendations computed in one tested place, so that a wrong number of pieces to a cluster is caught by a test before it reaches me.
6. As the owner, I want the «Фабрика» cell and the factory signal computed in one tested place, so that an oversized or missing factory order is caught before I pay for it.
7. As the owner, I want the supply plan built from the same tested list I tick recommendations in, so that the supply window contains exactly the clusters I ticked.
8. As the owner, I want the cabinet filter to keep applying to stocks, sales, stock history and the supply reserve alike, so that one cabinet's figures are never mixed with another's.
9. As the owner, I want «Распределить весь остаток» (the wide window) to keep working per article as today, so that sold-out articles still get their clusters back.
10. As the owner, I want the kit components table and kit bottlenecks unchanged, so that shared components (Бутылки, Пакеты) are still shown the same way.
11. As the owner, I want defects found during the rework listed for me instead of silently fixed, so that every visible change is my decision.
12. As the owner, I want the dashboard to keep its current behaviour while the cluster reference is still loading, so that item 88 changes nothing visible; the possible brief flash is recorded as a separate tail to check.
13. As the owner, I want the «Труба изменилась по артикулам» label left as it is in item 88, so that the screen does not change; its wording is recorded as a separate tail.
14. As the owner, I want each step checked against the live «БД Склад» export before and after, so that "nothing changed" is proven on my real data, not assumed.
15. As the owner, I want one Cloud Run deployment at the end and no Apps Script version, so that I run one command and the 200-version cap is not touched.
16. As the owner, I want to be able to verify the deployment myself by opening the tab and comparing a few rows with what I saw before, so that I can close the item on my own check.
17. As an agent working on a later item, I want the tab's calculations behind one input and one output, so that I can change a rule and test it without opening the screen.
18. As an agent, I want the coverage library split into files by topic with the old import path still working, so that I read only the topic I change.
19. As an agent, I want one function that assembles coverage inputs for any screen, so that a new input reaches all four places at once.
20. As an agent, I want the word «Труба» to mean one thing everywhere in the code, so that I do not confuse the pipeline with open factory orders.
21. As an agent, I want the tab model's output typed, so that a renamed field is a compile error instead of a silent blank cell.
22. As an agent, I want the screen split into parts named after what the owner sees (header and filters, coverage table, row, components table, notices), so that I find the part to change by its name on screen.
23. As an agent, I want the existing coverage tests to pass untouched after the library split, so that the split is proven not to change behaviour.
24. As the tester, I want the money parts of the tab model (recommendations, factory signal, supply plan) guarded by deliberate mutations, so that a test gap is found before a money error is.
25. As the owner, I want the existing `OZONPERF` timings to show no slowdown on the same export, so that the speed rule is checked, not promised.

## Implementation Decisions

- **No visible change (Q1).** Output of both screens is byte-identical before and after every
  step. A defect found on the way goes to the plan's tails list with evidence, not into the code.
- **Four steps, each its own commit, in this order (Q5):**
  1. Split the coverage library into files by topic — speed/sales, trend, stock history,
     clusters, supply recommendation and coverage days, factory (open factory orders and factory
     signal), kit components, the top-level coverage build. The old module stays as the single
     re-export point; no consumer changes its import. Mechanical move, no logic edits.
  2. One shared coverage source (Q3 option а): one pure function assembles the coverage input
     from store data plus a cabinet choice plus settings (availability incl. kit components,
     supply reserve, open factory orders, cabinet filtering of stocks, sales and stock history)
     and runs the coverage build. The dashboard, the tab, the tab's wide window and the settings
     impact all call it. Each screen still computes on its own — no shared cached result, no
     speed change. The dashboard passes «all cabinets» and keeps not waiting for the cluster
     reference (Q4 option а), expressed as a parameter, not a copy.
  3. The tab model: the screen's glue — coverage rows, component rows and kit bottlenecks,
     visible rows, cluster shares, factory cell state (incl. hidden manual orders), supply
     recommendations (incl. the wide-window enrichment), the supply plan — moves into one pure
     module with one input (data, cabinet, settings, wide-window picks, ticked items, today's
     date) and one typed output. The screen keeps only UI state and drawing. The today date is
     an input, never read inside the module.
  4. Split the tab screen into parts: header and filters, coverage table, coverage row,
     components table, notices and modals wiring. Parts receive the tab model's output; they do
     not compute.
- **Vocabulary in code (Q9).** «Труба» means the pipeline (Ozon stock in all clusters + «Мой
  склад» + open factory orders). Two code comments that call open factory orders alone «ТРУБА»
  (dashboard and tab, next to the open-factory-orders call) are corrected. The parity test's
  «pipeline» pair and its ADR wording are left as they are unless a step touches them.
- **Speed.** No new round trips, no new memo layers that recompute more often than today;
  existing `OZONPERF` console timings are kept and compared before/after on the same export.
- **Deployment (Q7).** Code.gs is not touched. One Cloud Run deployment by the owner after step
  4, from a clean `git archive HEAD` export, verified by comparing served chunks as usual.
- **Who works (Q6).** Each step: a coder agent builds it, a tester agent checks it; step 3 is
  money-critical — the tester makes 3–5 deliberate mutations in recommendations, factory signal
  and supply plan. The orchestrator runs the before/after comparison after each step itself.
- **Tails recorded, not built (Q4, Q10):** (1) the dashboard computes before the cluster
  reference is loaded — check whether a visible flash happens; (2) the «Заказы в Китае» notice
  «Труба изменилась по артикулам» really means open factory orders.

## Testing Decisions

- A good test drives a module only through its public input and output and asserts what the
  owner would see (pieces, boxes, days, flags), never internal helper calls or memo structure.
- **Seam 1 — the rendered screens, temporary (not committed).** Before step 1, render the tab
  (cabinet «all» and each cabinet separately) and the dashboard coverage block to HTML from the
  live «БД Склад» xlsx export; after each step the HTML must be identical character for
  character. Prior art: the replay harness (committed `src` via `git archive`, `vite-node`,
  live xlsx) and the `renderToStaticMarkup` tests of the settings modal and settings impact.
- **Seam 2 — the tab model, permanent.** New tests of the tab model's one input/output:
  recommendations, factory cell, supply plan, cabinet filtering, wide window, today's date as
  input. Money-critical tier: mutation testing (3–5 mutations), whole path from inputs to what
  the table shows. Expected volume ≈ 15–25 checks.
- **Unchanged tests as proof.** The existing coverage library tests (coverage, history,
  money invariants, tone) and the parity tests pass untouched after step 1, through the old
  import path.
- **Shared coverage source (step 2):** a few checks that the dashboard and the tab with «all
  cabinets» give the same result, that a cabinet choice filters all four inputs, and that the
  cluster-reference wait is a parameter. ≈ 4–6 checks.
- The full set (`npx vitest run`, `npm run test:gas`, `tsc`) runs once before deployment;
  during work only the changed test files. No date logic changes, so no Yekaterinburg run
  unless a step touches dates.

## Out of Scope

- Any visible change, and any fix of a defect found on the way.
- The two recorded tails (dashboard cluster-reference wait, the «Труба изменилась» label).
- A shared cached coverage result between screens (Q3 option б).
- Plan item 53 (stays separate, later — owner 2026-09-26).
- Code.gs / ChinaOrders.gs changes, a separate service, bundling twin rules (ADR 0001).
- Renaming the parity test's «pipeline» pair.

## Further Notes

- File sizes grew since the audit (tab 2 471 → ~2 550 lines, coverage library 1 819 → ~2 660),
  so the plan text's numbers are stale; the approach is unchanged.
- Project rule overrides: npm/npx only, never pnpm; `git push` only on the owner's word;
  journals `docs/DEVLOG.md` / `docs/TEST_LOG.md` append-only; all writing into files in English.
