# 02: Coverage library split by topic

**What to build:** the coverage library becomes several files by topic — speed and sales, trend, stock history, clusters, supply recommendation and coverage days, factory (open factory orders and factory signal), kit components, the top-level coverage build — while the old module stays the single re-export point, so no consumer changes an import. A mechanical move with no logic edits; the owner sees nothing. Coder only, no separate tester (no logic changes). Spec: `../spec.md`, step 1.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] No file of the coverage library is above ~600 lines; each file is one topic from `CONTEXT.md`
- [ ] No consumer's import changed; the existing coverage tests (coverage, history, money invariants, tone, parity) pass without being edited
- [ ] Moved code is byte-identical apart from imports/exports (diff shows only moves)
- [ ] Rendered HTML from ticket 01 identical for every cabinet and the dashboard
- [ ] `tsc` clean
