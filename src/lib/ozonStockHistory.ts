// Item 88, ticket 02. Item 86 step D: speed and cluster share from stock-history in-stock days.
import { OzonSalesRow, OzonStockHistoryRow, SKUItem } from '../types';
import { NO_CLUSTER_NAME, MSK_OFFSET_MS, WEEK_MS, getLastFullWeeks, getMskWeekMonday, resolveSalesArticle } from './ozonSalesSpeed';
import type { SalesSpeedResult } from './ozonSalesSpeed';
import { rebuildClusterSpeedByShare } from './ozonClusters';
import type { ClusterShareWindow, OzonCoverageSettings } from './ozonClusters';
import { daysBetweenIso } from './ozonFactorySignal';

// ===== Item 86, step D: speed by days in stock, not calendar days =====
//
// PROBLEM (owner, 26.09.2026): speed = продано ÷ calendar days of the window counts days the
// goods were ABSENT — after a stock-out the speed is understated, and the recovery reads as a
// strong trend (Миска_двойная ×2.09 in the live measurement). An article absent longer than the
// window gets speed 0 and silently disappears exactly when it must be ordered.
//
// Definitions (owner's decisions 2026-09-26). obs(w) = max daysObserved over ALL history rows
// of week w (every article, cabinet, cluster) — how many days of that week were polled at all.
// a(w) per article = max daysInStock over the article's OWN rows of week w (any cabinet or
// cluster), 0 when it has no rows that week. f(w) = min(1, a(w)/obs(w)) — the fraction of the
// week the article stood in stock. A week is COVERED when obs(w) ≥ 1 (at least one poll landed);
// a MISSING row is «not in stock», not «unknown» — that is why f(w) can be computed at all
// without a history row for the article itself.

/** Item 86, step D. Weeks of history kept before the sheet trims them off; the hard ceiling on
 *  how far a lookback may walk back from the current Monday. */
export const HISTORY_MAX_LOOKBACK_WEEKS = 26;

/** Item 86, step D. Minimum effective in-stock days for the short speed window to stand without
 *  a lookback into earlier weeks. */
export const MIN_HISTORY_DAYS = 14;

export interface StockHistoryContext {
  /** obs(w): max daysObserved over ALL history rows of week w. */
  obsByWeek: Record<string, number>;
  /** a(w) per article: max daysInStock over the article's rows of week w (any cabinet/cluster). */
  articleDaysByWeek: Record<string, Record<string, number>>;
  /** Per article and КластерID: max daysInStock over the article+cluster's rows of week w —
   *  used only by the cluster share rebuild (step 4), keyed by history's own КластерID. */
  articleClusterDaysByWeek: Record<string, Record<string, Record<string, number>>>;
}

/**
 * Builds the lookup tables definitions 1 needs. Pure: reads `history` once, never mutates it.
 * `offerIdToArticle` must be the SAME map passed to `buildSalesSpeed` (built by
 * `buildOfferIdToArticle` over stocks) — otherwise the history and the speed would resolve the
 * same offer_id to different articles and the two series would silently talk past each other.
 */
export function buildStockHistoryContext(
  history: OzonStockHistoryRow[],
  skus: SKUItem[],
  offerIdToArticle?: Record<string, string>
): StockHistoryContext {
  const obsByWeek: Record<string, number> = {};
  const articleDaysByWeek: Record<string, Record<string, number>> = {};
  const articleClusterDaysByWeek: Record<string, Record<string, Record<string, number>>> = {};

  for (const row of history || []) {
    const week = String(row.week || '').trim();
    if (!week) continue;
    const obs = Number(row.daysObserved) || 0;
    if (obs > (obsByWeek[week] || 0)) obsByWeek[week] = obs;

    const article = resolveSalesArticle(skus, row.offerId, offerIdToArticle);
    const days = Number(row.daysInStock) || 0;
    if (!articleDaysByWeek[article]) articleDaysByWeek[article] = {};
    if (days > (articleDaysByWeek[article][week] || 0)) articleDaysByWeek[article][week] = days;

    const clusterId = String(row.clusterId || '').trim();
    if (!clusterId) continue;
    if (!articleClusterDaysByWeek[article]) articleClusterDaysByWeek[article] = {};
    if (!articleClusterDaysByWeek[article][clusterId]) articleClusterDaysByWeek[article][clusterId] = {};
    const perWeek = articleClusterDaysByWeek[article][clusterId];
    if (days > (perWeek[week] || 0)) perWeek[week] = days;
  }

  return { obsByWeek, articleDaysByWeek, articleClusterDaysByWeek };
}

/** A week is covered when at least one poll of it landed anywhere in the history. */
export function isHistoryWeekCovered(ctx: StockHistoryContext, week: string): boolean {
  return (ctx.obsByWeek[week] || 0) >= 1;
}

/** f(w) for one article: min(1, a(w)/obs(w)); 0 for an uncovered week (obs(w) = 0). */
export function historyArticleFraction(ctx: StockHistoryContext, article: string, week: string): number {
  const obs = ctx.obsByWeek[week] || 0;
  if (obs <= 0) return 0;
  const a = (ctx.articleDaysByWeek[article] && ctx.articleDaysByWeek[article][week]) || 0;
  return Math.min(1, a / obs);
}

/** Same fraction, but for one article INSIDE one cluster (history's own КластерID) — step 4. */
export function historyClusterFraction(ctx: StockHistoryContext, article: string, clusterId: string, week: string): number {
  const obs = ctx.obsByWeek[week] || 0;
  if (obs <= 0) return 0;
  const byCluster = ctx.articleClusterDaysByWeek[article];
  const d = (byCluster && byCluster[clusterId] && byCluster[clusterId][week]) || 0;
  return Math.min(1, d / obs);
}

export interface HistoryWindowResult {
  /** true only when EVERY slot (full weeks and the current part-week, when present) is covered. */
  covered: boolean;
  /** Σ effective in-stock days: 7 × f(w) per full week, + currentWeekDays × f(currentWeek). */
  effectiveDays: number;
}

/**
 * Effective in-stock days of one article over an arbitrary window of full weeks plus an optional
 * current part-week (item 71's convention). A window is covered only when history covers every
 * one of its weeks — a single uncovered week (usually: before the history started being
 * collected, 18.08.2026) drops the whole window back to the old calendar-days calculation.
 */
export function historyWindowForArticle(
  ctx: StockHistoryContext,
  article: string,
  weeks: string[],
  currentWeek: string | null,
  currentWeekDays: number
): HistoryWindowResult {
  let covered = true;
  let effectiveDays = 0;
  for (const week of weeks) {
    if (!isHistoryWeekCovered(ctx, week)) { covered = false; continue; }
    effectiveDays += 7 * historyArticleFraction(ctx, article, week);
  }
  if (currentWeek && currentWeekDays > 0) {
    if (!isHistoryWeekCovered(ctx, currentWeek)) covered = false;
    else effectiveDays += currentWeekDays * historyArticleFraction(ctx, article, currentWeek);
  }
  return { covered, effectiveDays };
}

export interface ArticleHistorySpeedInfo {
  /** Final speed, шт/день, by this article's chosen source. */
  perDay: number;
  source: 'daysInStock' | 'lookback';
  /** Σ effective (or, in a lookback, counted) in-stock days behind `perDay`. */
  daysInStock: number;
  /** Calendar days between the period used and today — the tooltip's «из Y дн. окна». */
  windowDays: number;
  /** Lookback only: the period actually walked, oldest Monday to today. */
  period?: { from: string; to: string };
  /** A lookback used at least one week/block NOT covered by history (before 18.08.2026 — its
   *  in-stock days are approximated from sales presence, not measured). */
  approximate: boolean;
  /** No sales anywhere in the 26-week lookback ceiling: no recommendation, no factory signal. */
  noSales26: boolean;
  /** Sold per cluster name over the period actually used (window, plus any lookback walked) —
   *  feeds the plain-qty cluster share of a 'lookback' article (step 4). Includes «Без кластера». */
  qtyByCluster: Record<string, number>;
}

/**
 * Item 86, step D, definition 2. Article speed for the short window (`speedWeeks` full weeks +
 * the current part-week, item 71) when history covers it: speed = qty ÷ Σ effective in-stock
 * days, source 'daysInStock' when that sum is ≥ MIN_HISTORY_DAYS. Below that, LOOKBACK: walk back
 * one full week at a time from the window's start, at most HISTORY_MAX_LOOKBACK_WEEKS before the
 * current Monday, adding each week's qty and in-stock days until the sum reaches
 * MIN_HISTORY_DAYS (or the 26 weeks run out — then whatever was collected stands).
 * A week outside history's covered range falls back to sales presence: a weekly row («Дней» = 7)
 * with qty > 0 counts as 7 in-stock days, qty 0 → 0 days; a 28-day archive block (dated at its
 * own start, «Дней» = 28) counts as 28 days when its qty > 0. The two never overlap in real data
 * (the weekly and archive zones sit on disjoint date ranges), so checking the block key first and
 * the weekly key otherwise, week by week, never double-counts a day.
 * An article with NO sales anywhere across the whole 26-week ceiling gets `noSales26 = true` and
 * speed 0 — a real stock-out is not a demand signal either way, but a silent one must not be
 * confused with the article having simply never sold.
 * Returns an entry ONLY for articles whose window (`speedWeeks` + current part-week) is covered
 * by history — an uncovered window means the caller keeps today's calendar-days speed unchanged.
 */
export function buildArticleSpeedByHistory(
  sales: OzonSalesRow[],
  skus: SKUItem[],
  settings: OzonCoverageSettings,
  now: Date,
  historyCtx: StockHistoryContext,
  offerIdToArticle: Record<string, string> | undefined,
  articles: string[]
): Record<string, ArticleHistorySpeedInfo> {
  const speedWeeks = settings.speedWeeks > 0 ? settings.speedWeeks : 4;
  const weeks = getLastFullWeeks(now, speedWeeks);
  const current = getMskWeekMonday(now);

  // Weekly («Дней» = 7), 28-day archive blocks, and the current part-week, per article — built
  // once over the WHOLE sales sheet, unfiltered by any window: a lookback may reach far outside
  // the short speed window.
  const weeklyQty: Record<string, Record<string, number>> = {};
  const blockQty: Record<string, Record<string, number>> = {};
  const clusterQtyByWeek: Record<string, Record<string, Record<string, number>>> = {};
  let currentWeekDays = 0;
  const currentWeekQty: Record<string, number> = {};
  const currentWeekClusterQty: Record<string, Record<string, number>> = {};
  for (const row of sales) {
    const week = String(row.week || '').trim();
    if (!week) continue;
    const days = Number(row.days) || 0;
    const qty = Number(row.qty) || 0;
    if (qty === 0 && days !== 7 && days !== 28 && !(week === current && days > 0 && days < 7)) continue;
    const article = resolveSalesArticle(skus, row.offerId, offerIdToArticle);
    const clusterName = String(row.clusterName || '').trim() || NO_CLUSTER_NAME;
    if (days === 7) {
      if (!weeklyQty[article]) weeklyQty[article] = {};
      weeklyQty[article][week] = (weeklyQty[article][week] || 0) + qty;
      if (!clusterQtyByWeek[article]) clusterQtyByWeek[article] = {};
      if (!clusterQtyByWeek[article][week]) clusterQtyByWeek[article][week] = {};
      clusterQtyByWeek[article][week][clusterName] = (clusterQtyByWeek[article][week][clusterName] || 0) + qty;
    } else if (days === 28) {
      if (!blockQty[article]) blockQty[article] = {};
      blockQty[article][week] = (blockQty[article][week] || 0) + qty;
      if (!clusterQtyByWeek[article]) clusterQtyByWeek[article] = {};
      if (!clusterQtyByWeek[article][week]) clusterQtyByWeek[article][week] = {};
      clusterQtyByWeek[article][week][clusterName] = (clusterQtyByWeek[article][week][clusterName] || 0) + qty;
    } else if (week === current && days > 0 && days < 7) {
      if (days > currentWeekDays) currentWeekDays = days;
      currentWeekQty[article] = (currentWeekQty[article] || 0) + qty;
      if (!currentWeekClusterQty[article]) currentWeekClusterQty[article] = {};
      currentWeekClusterQty[article][clusterName] = (currentWeekClusterQty[article][clusterName] || 0) + qty;
    }
  }

  const windowDaysOfShortWindow = weeks.length * 7 + currentWeekDays;
  const currentMondayMs = Date.parse(current + 'T00:00:00Z');
  const oldestAllowedMs = currentMondayMs - HISTORY_MAX_LOOKBACK_WEEKS * WEEK_MS;
  const todayIso = new Date(now.getTime() + MSK_OFFSET_MS).toISOString().slice(0, 10);

  const addCluster = (target: Record<string, number>, source: Record<string, number> | undefined) => {
    if (!source) return;
    for (const name of Object.keys(source)) target[name] = (target[name] || 0) + source[name];
  };

  const out: Record<string, ArticleHistorySpeedInfo> = {};
  for (const article of articles) {
    const win = historyWindowForArticle(historyCtx, article, weeks, currentWeekDays > 0 ? current : null, currentWeekDays);
    if (!win.covered) continue; // caller keeps the calendar-days speed unchanged

    let qty = weeks.reduce((s, w) => s + ((weeklyQty[article] && weeklyQty[article][w]) || 0), 0);
    if (currentWeekDays > 0) qty += currentWeekQty[article] || 0;
    const qtyByCluster: Record<string, number> = {};
    for (const w of weeks) addCluster(qtyByCluster, clusterQtyByWeek[article] && clusterQtyByWeek[article][w]);
    if (currentWeekDays > 0) addCluster(qtyByCluster, currentWeekClusterQty[article]);

    let days = win.effectiveDays;

    if (days >= MIN_HISTORY_DAYS) {
      out[article] = {
        perDay: days > 0 ? qty / days : 0,
        source: 'daysInStock',
        daysInStock: days,
        windowDays: windowDaysOfShortWindow,
        approximate: false,
        noSales26: false, // may be corrected below when qty is 0
        qtyByCluster
      };
    } else {
      // LOOKBACK: one full week at a time, older than the window's own start.
      let approximate = false;
      let cursorMs = Date.parse((weeks.length ? weeks[0] : current) + 'T00:00:00Z');
      let oldestVisited = weeks.length ? weeks[0] : current;
      while (days < MIN_HISTORY_DAYS && cursorMs - WEEK_MS >= oldestAllowedMs) {
        cursorMs -= WEEK_MS;
        const w = new Date(cursorMs).toISOString().slice(0, 10);
        oldestVisited = w;
        if (isHistoryWeekCovered(historyCtx, w)) {
          days += 7 * historyArticleFraction(historyCtx, article, w);
          qty += (weeklyQty[article] && weeklyQty[article][w]) || 0;
          addCluster(qtyByCluster, clusterQtyByWeek[article] && clusterQtyByWeek[article][w]);
        } else {
          approximate = true;
          const blockQ = blockQty[article] && blockQty[article][w];
          if (blockQ !== undefined) {
            days += blockQ > 0 ? 28 : 0;
            qty += blockQ;
            addCluster(qtyByCluster, clusterQtyByWeek[article] && clusterQtyByWeek[article][w]);
          } else {
            const wq = (weeklyQty[article] && weeklyQty[article][w]) || 0;
            days += wq > 0 ? 7 : 0;
            qty += wq;
            addCluster(qtyByCluster, clusterQtyByWeek[article] && clusterQtyByWeek[article][w]);
          }
        }
      }

      out[article] = {
        perDay: days > 0 ? qty / days : 0,
        source: 'lookback',
        daysInStock: days,
        windowDays: daysBetweenIso(oldestVisited, todayIso),
        period: { from: oldestVisited, to: todayIso },
        approximate,
        noSales26: false, // may be corrected below
        qtyByCluster
      };
    }

    // noSales26: independent of the branch above — a covered window with ≥ 14 in-stock days and
    // 0 sales is a real absence of demand, and gets the flag only when the FULL 26-week ceiling
    // also sold nothing. Only worth checking when the branch above already found 0 pieces.
    if (out[article].perDay === 0 && qty === 0) {
      let anySold = false;
      let checkMs = currentMondayMs;
      const oldest = currentMondayMs - HISTORY_MAX_LOOKBACK_WEEKS * WEEK_MS;
      if ((currentWeekQty[article] || 0) > 0) anySold = true;
      while (!anySold && checkMs - WEEK_MS >= oldest) {
        checkMs -= WEEK_MS;
        const w = new Date(checkMs).toISOString().slice(0, 10);
        if (((weeklyQty[article] && weeklyQty[article][w]) || 0) > 0) { anySold = true; break; }
        if (((blockQty[article] && blockQty[article][w]) || 0) > 0) { anySold = true; break; }
      }
      if (!anySold) out[article].noSales26 = true;
    }
  }
  return out;
}

/**
 * Item 86, step D, definition 4. Rebuilds the cluster split of a history-aware article AFTER
 * `rebuildClusterSpeedByShare` (step B) already ran as the baseline for everyone — this function
 * only OVERRIDES the articles history actually speaks for, so an article it says nothing about
 * (uncovered share window, no lookback) keeps step B's plain qty-based split untouched, byte for
 * byte, and an empty `historySpeedInfo` (no stockHistory at all) changes nothing.
 *
 * A 'lookback' article ignores cluster history entirely and splits by plain qty over the SAME
 * period the lookback walked (`info.qtyByCluster`) — the owner's decision: a long-absent article
 * has too few in-stock days per cluster to trust a days-weighted share.
 *
 * A 'daysInStock' article gets the new share ONLY when the LONG share window (`shareWindow`,
 * same window `rebuildClusterSpeedByShare` used) is ALSO fully covered by history — a shorter
 * covered speed window does not guarantee the longer share window is: d(c) = Σ over the share
 * window's slots of slotLength × min(1, daysInStock(c,w)/obs(w)); rate(c) = qty(c) ÷ max(d(c),
 * W/2) — the W/2 floor caps how far an empty cluster can be lifted (at most 2× the plain qty/W
 * rate); a row with no cluster («Без кластера») is not weighted by days at all: rate = qty/W.
 * share(c) = rate(c) ÷ Σ rate — redistributes, so Σ over clusters of the rebuilt speed is still
 * `perDayByArticle[article]`, same invariant as step B.
 */
export function rebuildClusterSpeedByShareWithHistory(
  speed: SalesSpeedResult,
  shareWindow: ClusterShareWindow,
  historyCtx: StockHistoryContext,
  historySpeedInfo: Record<string, ArticleHistorySpeedInfo>,
  nameToId: Record<string, string>
): Record<string, Record<string, number>> {
  // Baseline: today's plain qty-based split for EVERY article — also the correct answer for any
  // article `historySpeedInfo` says nothing about.
  const pct = rebuildClusterSpeedByShare(speed, shareWindow);

  for (const article of Object.keys(historySpeedInfo)) {
    const info = historySpeedInfo[article];
    const perDay = Number(speed.perDayByArticle[article]) || 0;

    if (info.source === 'lookback') {
      const qtyByCluster = info.qtyByCluster || {};
      const total = Object.values(qtyByCluster).reduce((s, v) => s + v, 0);
      const fresh: Record<string, number> = {};
      const freshPct: Record<string, number> = {};
      if (total > 0) {
        for (const name of Object.keys(qtyByCluster)) {
          const share = qtyByCluster[name] / total;
          fresh[name] = perDay * share;
          freshPct[name] = share * 100;
        }
      }
      speed.perDayByArticleCluster[article] = fresh;
      pct[article] = freshPct;
      continue;
    }

    // 'daysInStock': the new formula applies only when the LONG share window is ALSO covered.
    const win = historyWindowForArticle(historyCtx, article, shareWindow.weeks, shareWindow.currentWeek, shareWindow.currentWeekDays);
    if (!win.covered) continue; // step B's baseline split stands

    const slots: { week: string; length: number }[] = shareWindow.weeks.map((w) => ({ week: w, length: 7 }));
    if (shareWindow.currentWeek) slots.push({ week: shareWindow.currentWeek, length: shareWindow.currentWeekDays });
    const W = slots.reduce((s, x) => s + x.length, 0);
    if (!(W > 0)) continue;

    const clusterQty = shareWindow.qtyByArticleCluster[article] || {};
    const rates: Record<string, number> = {};
    let unboundRate = 0;
    for (const name of Object.keys(clusterQty)) {
      const qty = clusterQty[name];
      const clusterId = name === NO_CLUSTER_NAME ? '' : (nameToId[name] || '');
      if (!clusterId) { unboundRate += qty / W; continue; } // rows without a cluster: rate = qty/W
      let d = 0;
      for (const slot of slots) d += slot.length * historyClusterFraction(historyCtx, article, clusterId, slot.week);
      rates[name] = qty / Math.max(d, W / 2);
    }
    const totalRate = Object.values(rates).reduce((s, v) => s + v, 0) + unboundRate;
    const fresh: Record<string, number> = {};
    const freshPct: Record<string, number> = {};
    if (totalRate > 0) {
      for (const name of Object.keys(rates)) {
        const share = rates[name] / totalRate;
        fresh[name] = perDay * share;
        freshPct[name] = share * 100;
      }
      if (unboundRate > 0) {
        const share = unboundRate / totalRate;
        fresh[NO_CLUSTER_NAME] = perDay * share;
        freshPct[NO_CLUSTER_NAME] = share * 100;
      }
    }
    speed.perDayByArticleCluster[article] = fresh;
    pct[article] = freshPct;
  }
  return pct;
}
