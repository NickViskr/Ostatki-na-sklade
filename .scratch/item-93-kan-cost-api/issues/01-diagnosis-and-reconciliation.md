# 01: Diagnosis and reconciliation — confirm the journal holes, check the script token, compare journal with KAN

**What to build:** nothing in code. The orchestrator itself (no agents) produces evidence the later
tickets rest on, and the owner's decision on the one-time backlog send. Spec: `../spec.md`
(answers 3, 6; «KAN API facts»).

**Blocked by:** None (can start immediately).

**Status:** done 2026-10-14 (orchestrator, no code; result below)

- [x] Fresh xlsx export of «БД Склад» via the Drive connector (never the text export)
- [x] Replay on the export (vite-node + the production modules, or the stand loaded with the export's
      sheets): (a) pencil edit of an Ozon shipment row changing the quantity, (b) deletion of a
      shipment row, (c) restore of it from «Удаленное». For each: what rows the journal gains, and
      whether the chain is double-counted / untouched. Confirm or refute the two holes of the spec.
- [x] Find in the live journal any past edits/deletes of Ozon shipments that already distorted it
      (rows with empty OpID, rows whose shipment is in «Удаленное»), list them with figures.
- [x] Script token scopes: the owner runs one read-only function in the Apps Script editor (or a
      temporary admin action) that logs `kanCall('list_shops', {}).access.scopes` — must contain
      `mcp:product_cost:write`. If not, the owner re-issues the token in KAN.
- [x] Reconciliation with the KAN chat connector: `get_product_costs` for both shops (paginate
      `next_offset`) vs the journal collapsed per (cabinet, article, date). Report: rows never sent,
      dates where KAN ≠ journal (with both figures), KAN entries with no journal row, the item-80
      suspects (multi-article shipments edited from «История» before 22.09.2026).
- [x] One preview (no apply) with a future date and with an unknown article, to learn KAN's answer;
      check whether «Статус MAIN» matters (compare an API row with a CSV-imported row in KAN).
- [x] Owner decides what goes in the one-time send (done in ticket 06, after the automation is live
      or before it — owner's call). Decision recorded here.

## Result (2026-10-14)

Data: xlsx export of «БД Склад» taken 2026-10-14 ~12:29 (Yekaterinburg) through the Drive connector;
journal 94 rows, «История» 405, «Удаленное» 28. Replay: the export's sheets loaded into the Apps Script
stand (`tests/apps-script/harness.cjs`, `setRegistrySheet`/`setSkuSheet`, date cells as `h.FakeDate`,
clock 2026-10-14) and the REAL `Code.gs` functions called. Scripts lived in the session scratchpad
(`replay.cjs`, `crosscheck.cjs`, `chains.cjs`, `reconcile.cjs`) — rebuild from this description.
Target row: `3f46562f…` BowlGrayMini_01, MaxiStore, 234 pcs at 280.42, delivery 2026-10-09,
OpID `f64cee31…`, «ДопРасходы» 10771; journal state before: 241.14.

### Holes — confirmed, plus one more

| Action (real `Code.gs`) | Journal | Verdict |
|---|---|---|
| `updateTransaction`, qty 234 → 230 | +1 row: date 2026-10-09, base 622, 230 at 281.22, 241.14 → **251.96**, OpID **empty**, source «отгрузка»; the original row stays | Hole 1 CONFIRMED: double count (+10.82 ₽/pc) |
| `updateTransaction`, nothing changed (server call) | +1 row, 241.14 → 251.88, OpID empty | Same hole without any change. From the browser a save that changes only the comment goes to `setTransactionComment` (item 90, `isCommentOnlyEdit`) and is safe; any change of quantity/price/destination/date hits the hole |
| `deleteTransaction` and `deleteMultipleTransactions` | untouched, state stays 241.14 | Hole 2 CONFIRMED: the deleted supply stays in the cost |
| `restoreArchivedItem` of that row | untouched | NEW, hole 3: the archived payload (`archiveItem` in `deleteTransaction`) holds no `opId` and no `additionalCosts`; the restored row has OpID '', «ДопРасходы» empty, «Отгрузка» '' — the link to its journal row (`isOzonCostCounted` keys on OpID) and to its combined shipment is lost, and a later edit would re-parse the extras from the text (item-80 risk) |

The edited «История» row kept its OpID (item 90 `stampOpIdOnTransactions`), the journal row did not:
`commitTransaction` is still called with opId ''.

### Past distortions already in KAN

1. **BowlGrayMini_01 / MaxiStore, journal row 60** — the pencil edit of 2026-09-15 17:37 UTC (archive
   «UpdatedVersion» of `a595b3f5`, the 12.09 shipment of combined shipment `8d776830…`, 216 at 218.1)
   appended a second blend of the same 216 pcs with an empty OpID (base 335, 225.60 → 222.66). Before
   item 90 the edit also dropped the row's OpID (today's «История» row `5258f18d` has none; journal row 57
   points at OpID `8d776830…-1`, which no «История» row carries). Price not inflated (218.1 before and
   after). Recomputed without row 60 (recorded bases kept, `roundToTwo` of `Code.gs`):

   | Day | Journal = KAN | Recomputed | Diff |
   |---|---|---|---|
   | 2026-09-12 | 222.66 | 225.60 | −2.94 |
   | 2026-09-19 | 222.29 | 224.12 | −1.83 |
   | 2026-09-21 | 222.18 | 223.93 | −1.75 |
   | 2026-09-28 | 221.41 | 222.69 | −1.28 |
   | 2026-10-09 | 241.14 | 241.99 | −0.85 |

2. **Полка_выдв_27см / Mercurius, journal rows 40–41** — the live check of 2026-08-26 under the admin
   account «Claude» edited receipt `ceb20dae` 627 → 650 (archived 12:47 UTC) and back 650 → 627 (archived
   12:49 UTC; today's receipt `d5aff93a` is 627, its shipments `16e993f2` 6 at 667.5 and `823cdb81` 126 at
   658.82 are on 627). The journal holds only the first edit's «пересчёт после правки прихода» rows
   (690.5 / 681.82, exported 2026-08-26 18:44:08); the reverse rows are absent (cause not recoverable from
   the export — memory trap 9 says such traces were cleaned by hand). Recomputed with the «История» prices:

   | Day | Journal = KAN | Recomputed | Diff |
   |---|---|---|---|
   | 2026-08-23 | 690.50 | 667.50 | +23.00 |
   | 2026-08-25 | 682.21 | 659.21 | +23.00 |
   | 2026-09-03 | 677.21 | 656.54 | +20.67 |
   | 2026-10-13 | 710.01 | 709.51 | +0.50 |

- No Ozon shipment row was ever deleted (the archive's deletions are «Списание - Брак» rows and
  Wildberries edits). Every Ozon shipment in «История» since 2026-08-26 has a journal row except the
  OpID-less `5258f18d` above. Journal OpIDs `9e1c941d`, `78d91eae`, `17691bff`, `59740e06` (2026-08-01
  seed) are «История» row ids, not OpIDs — not a distortion.
- **Item-80 suspects:** the only Ozon edit before 22.09 (2026-09-15) did not change the price. The
  inflating edits of 2026-09-22 10:38–10:39 are Wildberries rows (Органайзер_2_пол_белый 537.58 → 638.08
  → 682.75 across three rows), outside KAN. No Ozon figure in KAN is inflated by item 80.

### Script token (owner ran `checkKanTokenScopes` in the editor, 2026-10-14 14:46)

Scopes of `kan_mcpToken`: `mcp:analytics:read, mcp:reviews:read, mcp:review_templates:read,
mcp:notes:read, mcp:scenarios:read, mcp:scenarios:write, mcp:review_templates:write,
mcp:product_cost:write, mcp:campaign_control:write, mcp:notes:write`; shops 2771 MaxiStore and 1765
Mercurius, both `read_write`. `mcp:product_cost:write` is THERE — no re-issue needed. The temporary
editor file `tmp_kan_scopes` is to be deleted by the owner (never pulled into the repo).

### Reconciliation journal ↔ KAN (`get_product_costs`, both shops, one page each: 33 + 180 entries)

Journal collapsed per (cabinet, article, date), last row wins, vs KAN entries with `dt` ≥ 2026-08-01:
69 groups vs 69 entries; **67 equal to the kopeck**; no journal row without the «Выгружено в КАН» stamp;
no journal group missing in KAN; no KAN entry since 08-01 without a journal group. Two differ, the
journal is right in both:

| Day | Cabinet / article | KAN (entry id) | Journal |
|---|---|---|---|
| 2026-09-03 | MaxiStore / Миска_двойная | 229.79 (799941) | 229.58 (row 48) |
| 2026-09-03 | Mercurius / Набор_полок_выдв_бел | 1650.49 (799939) | 1647.59 (row 51) |

Cause: two journal rows of one article on that day; the file was stamped 2026-09-03 20:56:20, before
the «one row per article and day» collapse (`3506066`, deployed as `sklad-00053-zg9` the same evening),
and KAN's CSV import kept the FIRST duplicate. Later dates are consistent (KAN 09-12 / 09-08 equal the
journal). All recent KAN entries carry `expense` 0.

### Previews (no apply; `apply_product_cost_changes` never called)

- Future date (BowlBlueMini_01, 2771, 2026-10-20, 203.93): accepted — `created 1`, `dt 2026-10-20`,
  `dt_end null`, no issue.
- Unknown article (`NO_SUCH_ARTICLE_93`, 2771): the preview SUCCEEDS with `imported 0`,
  `skipped {"Товар не найден": 1}`, `issues [{row_number, sku_article: "no_such_article_93", reason}]` —
  the article is lower-cased in the answer (matching is case-insensitive).
- Mixed batch (one known identical row + the unknown): not refused as a whole — the known row passes
  (`created 0 / updated 0`, before = after, entry 811008), the unknown is skipped with its `row_number`.
- Both shops in one batch (`shop_id [2771, 1765]`, BowlGrayMini_01): skipped as «Товар определён
  неоднозначно» — the article exists in both shops.
- «Статус MAIN»: the cost entries carry no status at all; the CSV column is the PRODUCT state (MAIN /
  ARCHIVED of `list_products`). An import into 1765 for BowlGrayMini_01 matched the ARCHIVED Mercurius
  product 1003207 (`created 1`) — archived products are written to.
- The chat connector dropped once («mcp-remote: fetch failed», then «unavailable» for ~2 min) and came
  back; a retry of the same preview succeeded.

Consequences for ticket 03 (sender): one shop per batch, shop id strictly from the journal's cabinet
(2771 MaxiStore, 1765 Mercurius); read `summary.skipped` / `issues` per row — a «success» may write
nothing for a row; the read-back stays the only proof.

### Noticed in passing (outside item 93)

- **Combined shipments:** `appendOzonCostForShipment` runs once per order; in 7 of the 12 same-day
  multi-order groups of the journal the later order was blended on the SAME base as the earlier one
  (the earlier order's pieces missing from the base), in the other 5 the base grew. Example: 03.09
  BowlGrayMini_01, orders 54 + 198 + 18 at 217.45 on base 309 from 250.53 → journal 233.67, a single
  blend gives 235.10 (−1.43 ₽). OWNER 2026-10-14: a separate plan item (95), after item 93.
- «История» carries «Комментарий» and «Отгрузка» TWICE (columns P–Q and R–S); both copies are written,
  they differ on one row (sheet row 361: «111111» only in the first). «Внешние отгрузки» has
  «ОтгруженоJSON» twice (the second empty). Not filed.

### Owner's decisions (2026-10-14)

- **One-time send = everything, 11 dates:** first the journal is corrected for the two distortions
  (BowlGrayMini_01 / MaxiStore 12.09, 19.09, 21.09, 28.09, 09.10 without the row-60 re-blend;
  Полка_выдв_27см / Mercurius 23.08, 25.08, 03.09, 13.10 at the «История» prices) with correction rows,
  so that the journal state of both articles becomes 241.99 and 709.51; then those 9 dates plus the two
  03.09 dates (Миска_двойная 229.58, Набор_полок_выдв_бел 1647.59) go to KAN.
- **When:** in ticket 06, as the first real send of the new sender (preview shown, apply on the owner's
  word, read-back). Until then KAN stays as it is. Figures are recomputed at that moment — later
  shipments of these two articles will have moved them.
- **Combined shipments:** recorded as plan item 95.

## Comments
