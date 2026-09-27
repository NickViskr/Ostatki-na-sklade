# 05: The tab screen split into parts named after what the owner sees

**What to build:** the «Остатки Озон» screen becomes parts — header and filters, coverage table, coverage row, components table, notices and modals wiring — that receive the tab model's output and draw it; none of them computes. The owner sees nothing different. Coder; checks are the rendered comparison plus existing tests. Spec: `../spec.md`, step 4.

**Blocked by:** 04.

**Status:** ready-for-agent

- [ ] No part above ~600 lines; each part is named after what the owner sees on screen
- [ ] Parts take the model's output as props; none imports the coverage library's calculations
- [ ] Rendered HTML from ticket 01 identical for every cabinet and the dashboard
- [ ] `tsc` clean, existing tests green
