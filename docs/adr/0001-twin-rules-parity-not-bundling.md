# Rules needed by both the screen and Code.gs stay two copies, held equal by a parity test

Some business rules must run both in the browser (`src/lib/*.ts`, for the screen) and in Apps
Script (`Code.gs` / `ChinaOrders.gs`, for writes and server checks): supply reserve, pipeline,
availability, shipment extras, article mapping, Ozon settings rules. We keep them as two
hand-written copies ("twin rules") and register every pair in one parity test that feeds both
copies the same generated inputs through the Apps Script stand (`tests/apps-script/harness.cjs`)
and requires the same answer. A twin guarded only by source-text checks does not count as
guarded: the «упаковка» case drift (2026-09-27) passed such checks.

## Considered Options

- **One copy, bundled into Code.gs by a build step.** Removes the twins entirely, but changes how
  Apps Script is built and deployed (the owner runs `clasp push/deploy` by hand, 200-version cap)
  and every Code.gs deploy would carry frontend code. Rejected for now as too large a step;
  revisit if the number of twins keeps growing.
- **Server computes, screen only displays.** Makes every screen recalculation (settings impact,
  coverage) a round trip to Apps Script. Rejected: slower screen.

## Consequences

A new rule needed on both sides is not done until its pair is registered in the parity test.
When the two copies disagree, the owner decides which answer is right; the other copy is fixed.
