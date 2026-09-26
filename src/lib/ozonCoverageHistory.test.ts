import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  applyDeficitSpeedCorrection,
  buildArticleSpeedByHistory,
  buildClusterNameToId,
  buildClusterShareWindow,
  buildOfferIdToArticle,
  buildOzonCoverage,
  buildSalesSpeed,
  buildSalesTrend,
  buildSalesTrendWithHistory,
  buildStockHistoryContext,
  getLastFullWeeks,
  getMskWeekMonday,
  historyArticleFraction,
  historyClusterFraction,
  historyWindowForArticle,
  isHistoryWeekCovered,
  HISTORY_MAX_LOOKBACK_WEEKS,
  MIN_HISTORY_DAYS,
  MIN_WEEKS_WITH_SALES,
  rebuildClusterSpeedByShareWithHistory,
  OzonClusterRef,
  OzonCoverageInput,
  OzonCoverageSettings
} from './ozonCoverage';
import { OzonSalesRow, OzonStockHistoryRow, OzonStockRow, SKUItem } from '../types';

// ===== Item 86, step D: speed by days in stock, not calendar days =====
//
// NOW is a Wednesday; the current Monday (МСК) is 2024-01-08, and the 4 preceding full weeks
// (the default speedWeeks window) are exactly WEEKS below — the same grid ozonCoverage.test.ts
// already uses, so numbers are easy to cross-check against the existing suite.
const NOW = new Date('2024-01-10T10:00:00Z');
const WEEKS = ['2023-12-11', '2023-12-18', '2023-12-25', '2024-01-01'];
const CURRENT = '2024-01-08';

function makeSku(overrides: Partial<SKUItem> & { sku: string }): SKUItem {
  return { price: 0, minStock: 0, pcsPerBox: 1, boxesPerPallet: 1, volumeLiters: 0, leadTimeDays: 0, ...overrides };
}

function makeSettings(overrides: Partial<OzonCoverageSettings> = {}): OzonCoverageSettings {
  return {
    speedWeeks: 4, minStockDays: 7, targetStockDays: 20, maxClusterDays: 0, factoryOrderDays: 14,
    returnsToSalePct: 0, excludedClusters: '', deficitDays: 0, demandGrowthPct: 0, ...overrides
  };
}

function makeStock(overrides: Partial<OzonStockRow> & { offerId: string }): OzonStockRow {
  return {
    cabinet: 'M', sku: '', name: '', warehouseName: 'W', clusterName: '', clusterId: '',
    available: 0, preparing: 0, requested: 0, transit: 0, excess: 0, returns: 0, other: 0, updatedAt: '',
    ...overrides
  };
}

function sale(week: string, offerId: string, qty: number, days = 7, clusterName = 'Москва', cabinet = 'M'): OzonSalesRow {
  return { week, cabinet, offerId, clusterName, qty, updatedAt: '', days };
}

function hist(week: string, offerId: string, overrides: Partial<OzonStockHistoryRow> = {}): OzonStockHistoryRow {
  return {
    week, cabinet: 'M', offerId, clusterId: '', clusterName: '', daysInStock: 7, daysObserved: 7,
    lastDay: '', updatedAt: '', ...overrides
  };
}

/** Monday `weeksBack` full weeks before WEEKS[0] (2023-12-11), for lookback fixtures. */
function weekBefore(weeksBack: number): string {
  const ms = Date.parse('2023-12-11T00:00:00Z') - weeksBack * 7 * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

// ===== Definitions: obs(w), a(w), f(w), window coverage =====

describe('buildStockHistoryContext: obs(w) and a(w) (definition 1)', () => {
  it('obs(w) is the max daysObserved over ALL rows of the week, any article', () => {
    const history = [
      hist('2024-01-01', 'A', { daysObserved: 3, daysInStock: 3 }),
      hist('2024-01-01', 'B', { daysObserved: 7, daysInStock: 1 })
    ];
    const ctx = buildStockHistoryContext(history, [], {});
    expect(ctx.obsByWeek['2024-01-01']).toBe(7);
  });

  it('a(w) per article is the max daysInStock over the ARTICLE\'s own rows (cabinet/cluster ignored)', () => {
    const history = [
      hist('2024-01-01', 'A', { clusterId: 'C1', daysInStock: 2 }),
      hist('2024-01-01', 'A', { clusterId: 'C2', daysInStock: 5 })
    ];
    const ctx = buildStockHistoryContext(history, [], {});
    expect(ctx.articleDaysByWeek['A']['2024-01-01']).toBe(5);
  });

  it('a missing row for the article that week is 0 in-stock days — a missing row means OUT of stock, not unknown', () => {
    const history = [hist('2024-01-01', 'OTHER', { daysObserved: 7 })];
    const ctx = buildStockHistoryContext(history, [], {});
    expect(historyArticleFraction(ctx, 'A', '2024-01-01')).toBe(0);
    // The week is still covered — some row landed that week — just not for THIS article.
    expect(isHistoryWeekCovered(ctx, '2024-01-01')).toBe(true);
  });

  it('a week with NO row at all (any article) is not covered — obs(w) = 0', () => {
    const ctx = buildStockHistoryContext([hist('2024-01-01', 'A')], [], {});
    expect(isHistoryWeekCovered(ctx, '2023-12-25')).toBe(false);
  });

  it('f(w) = min(1, a(w)/obs(w)): 5 in-stock days of 7 observed → 5/7, capped at 1', () => {
    const ctx = buildStockHistoryContext([hist('2024-01-01', 'A', { daysInStock: 5, daysObserved: 7 })], [], {});
    expect(historyArticleFraction(ctx, 'A', '2024-01-01')).toBeCloseTo(5 / 7, 10);
    const ctxFull = buildStockHistoryContext([hist('2024-01-01', 'A', { daysInStock: 9, daysObserved: 7 })], [], {});
    expect(historyArticleFraction(ctxFull, 'A', '2024-01-01')).toBe(1); // guards a bad daysInStock > daysObserved
  });

  it('resolves offer_id to article through the SAME map buildSalesSpeed uses (item 39A)', () => {
    const offerIdToArticle = { 'ozn-1': 'SKU-A' };
    const history = [hist('2024-01-01', 'OZN-1', { daysInStock: 4 })];
    const ctx = buildStockHistoryContext(history, [], offerIdToArticle);
    expect(ctx.articleDaysByWeek['SKU-A']['2024-01-01']).toBe(4);
  });

  it('historyClusterFraction reads a(c,w) by history\'s own КластерID', () => {
    const history = [
      hist('2024-01-01', 'A', { clusterId: 'C1', daysInStock: 3, daysObserved: 7 }),
      hist('2024-01-01', 'A', { clusterId: 'C2', daysInStock: 7, daysObserved: 7 })
    ];
    const ctx = buildStockHistoryContext(history, [], {});
    expect(historyClusterFraction(ctx, 'A', 'C1', '2024-01-01')).toBeCloseTo(3 / 7, 10);
    expect(historyClusterFraction(ctx, 'A', 'C2', '2024-01-01')).toBe(1);
    expect(historyClusterFraction(ctx, 'A', 'C3-unknown', '2024-01-01')).toBe(0);
  });
});

describe('historyWindowForArticle: covered window, current part-week (definition 1, item 71)', () => {
  function fullHistory(article: string, weeks: string[], days: number) {
    return weeks.map((w) => hist(w, article, { daysInStock: days, daysObserved: 7 }));
  }

  it('every week covered, no current part-week: effectiveDays = Σ 7×f(w)', () => {
    const history = fullHistory('A', WEEKS, 7);
    const ctx = buildStockHistoryContext(history, [], {});
    const win = historyWindowForArticle(ctx, 'A', WEEKS, null, 0);
    expect(win.covered).toBe(true);
    expect(win.effectiveDays).toBe(28); // 4 недели × 7 дней × f=1
  });

  it('one week uncovered (no row at all that week) drops the WHOLE window, even though others are full', () => {
    const history = fullHistory('A', WEEKS.slice(0, 3), 7); // одна неделя (2024-01-01) без строк вовсе
    const ctx = buildStockHistoryContext(history, [], {});
    const win = historyWindowForArticle(ctx, 'A', WEEKS, null, 0);
    expect(win.covered).toBe(false);
  });

  it('the current part-week enters by ITS elapsed days, and must itself be covered', () => {
    const history = [...fullHistory('A', WEEKS, 7), hist(CURRENT, 'A', { daysInStock: 2, daysObserved: 2 })];
    const ctx = buildStockHistoryContext(history, [], {});
    const win = historyWindowForArticle(ctx, 'A', WEEKS, CURRENT, 2);
    expect(win.covered).toBe(true);
    // 4 полные недели × 7 (f=1) + 2 дня текущей недели × f=1 (2/2) = 28 + 2 = 30.
    expect(win.effectiveDays).toBe(30);
  });

  it('current part-week NOT covered by history drops the window even if all full weeks are covered', () => {
    const history = fullHistory('A', WEEKS, 7); // текущая неделя вообще без строк
    const ctx = buildStockHistoryContext(history, [], {});
    const win = historyWindowForArticle(ctx, 'A', WEEKS, CURRENT, 2);
    expect(win.covered).toBe(false);
  });
});

// ===== Article speed: daysInStock, lookback, noSales26 =====

describe('buildArticleSpeedByHistory: daysInStock branch (definition 2)', () => {
  const skus: SKUItem[] = [makeSku({ sku: 'A' })];

  it('no stock-out: effective days = calendar days, speed equals the plain calendar speed exactly', () => {
    const history = WEEKS.map((w) => hist(w, 'A', { daysInStock: 7, daysObserved: 7 }));
    const sales = WEEKS.map((w) => sale(w, 'A', 40)); // 40×4 = 160 шт
    const ctx = buildStockHistoryContext(history, skus, {});
    const info = buildArticleSpeedByHistory(sales, skus, makeSettings(), NOW, ctx, {}, ['A']);
    expect(info.A.source).toBe('daysInStock');
    expect(info.A.daysInStock).toBe(28);
    expect(info.A.windowDays).toBe(28);
    // 160 / 28, ровно та же цифра, что и старая календарная скорость этого окна.
    expect(info.A.perDay).toBeCloseTo(160 / 28, 10);
    const calendarSpeed = buildSalesSpeed(sales, skus, WEEKS, {}).perDayByArticle.A;
    expect(info.A.perDay).toBeCloseTo(calendarSpeed, 10);
  });

  it('stock-out lowers in-stock days without lowering sales as much: speed RISES to exactly qty / effective days', () => {
    // Полные недели — 7 дней в наличии, продано по 20 шт; распроданные недели — 1 день в наличии,
    // продано по 3 шт (успели продать, пока было).
    const history = [
      hist(WEEKS[0], 'A', { daysInStock: 7, daysObserved: 7 }),
      hist(WEEKS[1], 'A', { daysInStock: 7, daysObserved: 7 }),
      hist(WEEKS[2], 'A', { daysInStock: 1, daysObserved: 7 }),
      hist(WEEKS[3], 'A', { daysInStock: 1, daysObserved: 7 })
    ];
    const sales = [sale(WEEKS[0], 'A', 20), sale(WEEKS[1], 'A', 20), sale(WEEKS[2], 'A', 3), sale(WEEKS[3], 'A', 3)];
    const ctx = buildStockHistoryContext(history, skus, {});
    const info = buildArticleSpeedByHistory(sales, skus, makeSettings(), NOW, ctx, {}, ['A']);
    expect(info.A.source).toBe('daysInStock');
    // effectiveDays = 7+7+1+1 = 16 (>= 14, no lookback needed); qty = 20+20+3+3 = 46.
    expect(info.A.daysInStock).toBe(16);
    expect(info.A.perDay).toBeCloseTo(46 / 16, 10);
    // Календарная скорость занижена бы вдвое: 46/28 = 1.643 против 46/16 = 2.875.
    const calendarSpeed = buildSalesSpeed(sales, skus, WEEKS, {}).perDayByArticle.A;
    expect(info.A.perDay).toBeGreaterThan(calendarSpeed);
    expect(calendarSpeed).toBeCloseTo(46 / 28, 10);
  });

  it('window NOT covered by history → no entry: the caller keeps the calendar-days speed unchanged', () => {
    const history = [hist(WEEKS[0], 'A'), hist(WEEKS[1], 'A'), hist(WEEKS[2], 'A')]; // WEEKS[3] нет вовсе
    const sales = WEEKS.map((w) => sale(w, 'A', 10));
    const ctx = buildStockHistoryContext(history, skus, {});
    const info = buildArticleSpeedByHistory(sales, skus, makeSettings(), NOW, ctx, {}, ['A']);
    expect(info.A).toBeUndefined();
  });

  it('MIN_HISTORY_DAYS is an INCLUSIVE boundary: exactly 14 effective days already stands as \'daysInStock\', not a lookback', () => {
    const history = [
      hist(WEEKS[0], 'B', { daysObserved: 7 }),
      hist(WEEKS[1], 'B', { daysObserved: 7 }),
      hist(WEEKS[2], 'A', { daysInStock: 7, daysObserved: 7 }),
      hist(WEEKS[3], 'A', { daysInStock: 7, daysObserved: 7 })
    ];
    const sales = [sale(WEEKS[2], 'A', 14), sale(WEEKS[3], 'A', 14)];
    const ctx = buildStockHistoryContext(history, skus, {});
    const info = buildArticleSpeedByHistory(sales, skus, makeSettings(), NOW, ctx, {}, ['A']);
    expect(MIN_HISTORY_DAYS).toBe(14);
    expect(info.A.daysInStock).toBe(14);
    expect(info.A.source).toBe('daysInStock');
    expect(info.A.perDay).toBeCloseTo(28 / 14, 10);
  });

  it('a covered window with ≥ 14 in-stock days and 0 sales stays at speed 0 — real absence of demand, not noSales26 (sales exist earlier in the 26 weeks)', () => {
    const history = WEEKS.map((w) => hist(w, 'A', { daysInStock: 7, daysObserved: 7 }));
    const sales = [
      ...WEEKS.map((w) => sale(w, 'A', 0)),
      sale(weekBefore(10), 'A', 5) // продажа глубже в 26-недельном окне
    ];
    const ctx = buildStockHistoryContext(history, skus, {});
    const info = buildArticleSpeedByHistory(sales, skus, makeSettings(), NOW, ctx, {}, ['A']);
    expect(info.A.source).toBe('daysInStock');
    expect(info.A.perDay).toBe(0);
    expect(info.A.noSales26).toBe(false);
  });
});

describe('buildArticleSpeedByHistory: lookback branch (definition 2)', () => {
  const skus: SKUItem[] = [makeSku({ sku: 'A' })];

  it('< 14 effective days → walks back into COVERED earlier weeks (no approximation)', () => {
    // Окно: только последняя неделя в наличии (5 дней), остальные три — 0 (но НЕДЕЛЯ покрыта:
    // строка другого товара в тот же день недели даёт obs(w) >= 1).
    const history = [
      hist(WEEKS[0], 'B', { daysObserved: 7 }),
      hist(WEEKS[1], 'B', { daysObserved: 7 }),
      hist(WEEKS[2], 'B', { daysObserved: 7 }),
      hist(WEEKS[3], 'A', { daysInStock: 5, daysObserved: 7 }),
      hist(weekBefore(1), 'A', { daysInStock: 7, daysObserved: 7 }),
      hist(weekBefore(2), 'A', { daysInStock: 7, daysObserved: 7 })
    ];
    const sales = [sale(WEEKS[3], 'A', 5), sale(weekBefore(1), 'A', 7), sale(weekBefore(2), 'A', 7)];
    const ctx = buildStockHistoryContext(history, skus, {});
    const info = buildArticleSpeedByHistory(sales, skus, makeSettings(), NOW, ctx, {}, ['A']);
    expect(info.A.source).toBe('lookback');
    // 5 (окно) + 7 + 7 = 19 >= 14, остановка после второй недели назад.
    expect(info.A.daysInStock).toBe(19);
    expect(info.A.approximate).toBe(false);
    expect(info.A.perDay).toBeCloseTo((5 + 7 + 7) / 19, 10);
    expect(info.A.period!.from).toBe(weekBefore(2));
  });

  it('walks into an UNCOVERED weekly-row week: qty > 0 counts as 7 in-stock days — approximate = true', () => {
    const history = [hist(WEEKS[0], 'B', { daysObserved: 7 }), hist(WEEKS[1], 'B', { daysObserved: 7 }),
      hist(WEEKS[2], 'B', { daysObserved: 7 }), hist(WEEKS[3], 'A', { daysInStock: 1, daysObserved: 7 })];
    // Неделя перед окном (weekBefore(1)) вообще без строк истории — только продажи.
    const sales = [sale(WEEKS[3], 'A', 1), sale(weekBefore(1), 'A', 9), sale(weekBefore(2), 'A', 8)];
    const ctx = buildStockHistoryContext(history, skus, {});
    const info = buildArticleSpeedByHistory(sales, skus, makeSettings(), NOW, ctx, {}, ['A']);
    expect(info.A.source).toBe('lookback');
    // 1 (окно) + 7 (неделя -1, есть продажи) + 7 (неделя -2, есть продажи) = 15 >= 14.
    expect(info.A.daysInStock).toBe(15);
    expect(info.A.approximate).toBe(true);
    expect(info.A.perDay).toBeCloseTo((1 + 9 + 8) / 15, 10);
  });

  it('a qty = 0 uncovered weekly row counts as 0 days — it does not fake presence', () => {
    const history = [hist(WEEKS[0], 'B', { daysObserved: 7 }), hist(WEEKS[1], 'B', { daysObserved: 7 }),
      hist(WEEKS[2], 'B', { daysObserved: 7 }), hist(WEEKS[3], 'A', { daysInStock: 1, daysObserved: 7 })];
    const sales = [sale(WEEKS[3], 'A', 1), sale(weekBefore(1), 'A', 0), sale(weekBefore(2), 'A', 8)];
    const ctx = buildStockHistoryContext(history, skus, {});
    const info = buildArticleSpeedByHistory(sales, skus, makeSettings(), NOW, ctx, {}, ['A']);
    // 1 (окно, days=1) + 0 (неделя -1, qty 0 → 0 дней) + 7 (неделя -2, qty>0) = 8 < 14,
    // ходьба назад продолжается до конца 26 недель, но больше данных нет — Σ дней = 8 > 0.
    expect(info.A.daysInStock).toBe(8);
    expect(info.A.perDay).toBeCloseTo(9 / 8, 10);
  });

  it('walks into a 28-day archive block: qty > 0 counts as 28 days at once', () => {
    const history = [hist(WEEKS[0], 'B', { daysObserved: 7 }), hist(WEEKS[1], 'B', { daysObserved: 7 }),
      hist(WEEKS[2], 'B', { daysObserved: 7 }), hist(WEEKS[3], 'A', { daysInStock: 1, daysObserved: 7 })];
    // Блок стоит на неделе -1 (его дата — начало 28-дневного периода).
    const sales = [sale(WEEKS[3], 'A', 1), sale(weekBefore(1), 'A', 56, 28)];
    const ctx = buildStockHistoryContext(history, skus, {});
    const info = buildArticleSpeedByHistory(sales, skus, makeSettings(), NOW, ctx, {}, ['A']);
    expect(info.A.source).toBe('lookback');
    // 1 (окно) + 28 (блок) = 29 >= 14, продажи 1 + 56 = 57.
    expect(info.A.daysInStock).toBe(29);
    expect(info.A.perDay).toBeCloseTo(57 / 29, 10);
    expect(info.A.approximate).toBe(true);
  });

  it('a block and a weekly row of the SAME week never both count — the block wins, weekly is skipped', () => {
    const history = [hist(WEEKS[0], 'B', { daysObserved: 7 }), hist(WEEKS[1], 'B', { daysObserved: 7 }),
      hist(WEEKS[2], 'B', { daysObserved: 7 }), hist(WEEKS[3], 'A', { daysInStock: 1, daysObserved: 7 })];
    // Одна и та же неделя несёт ОБА ряда — блок (28 дней) и недельную строку (7 дней) —
    // адверсариальный, в жизни несуществующий случай: проверяем, что код берёт блок один раз.
    const sales = [sale(WEEKS[3], 'A', 1), sale(weekBefore(1), 'A', 56, 28), sale(weekBefore(1), 'A', 999, 7)];
    const ctx = buildStockHistoryContext(history, skus, {});
    const info = buildArticleSpeedByHistory(sales, skus, makeSettings(), NOW, ctx, {}, ['A']);
    // 1 + 28 = 29, продажи 1 + 56 = 57 — строка в 999 шт полностью проигнорирована.
    expect(info.A.daysInStock).toBe(29);
    expect(info.A.perDay).toBeCloseTo(57 / 29, 10);
  });

  it('26-week ceiling exhausted with Σ days > 0 (but < 14): uses what was collected, does not error', () => {
    const history = [hist(WEEKS[0], 'B', { daysObserved: 7 }), hist(WEEKS[1], 'B', { daysObserved: 7 }),
      hist(WEEKS[2], 'B', { daysObserved: 7 }), hist(WEEKS[3], 'A', { daysInStock: 1, daysObserved: 7 })];
    const sales = [sale(WEEKS[3], 'A', 1), sale(weekBefore(20), 'A', 2)]; // единственная более ранняя продажа
    const ctx = buildStockHistoryContext(history, skus, {});
    const info = buildArticleSpeedByHistory(sales, skus, makeSettings(), NOW, ctx, {}, ['A']);
    expect(info.A.source).toBe('lookback');
    expect(info.A.daysInStock).toBe(1 + 7); // окно (1) + одна неделя с продажей (7), остальные — 0
    expect(info.A.daysInStock).toBeLessThan(MIN_HISTORY_DAYS);
    expect(info.A.perDay).toBeCloseTo(3 / 8, 10);
    expect(Number.isFinite(info.A.perDay)).toBe(true);
  });

  it('NO sales anywhere in the 26-week ceiling → speed 0, noSales26 = true, no recommendation/factory downstream', () => {
    const history = [hist(WEEKS[0], 'B', { daysObserved: 7 }), hist(WEEKS[1], 'B', { daysObserved: 7 }),
      hist(WEEKS[2], 'B', { daysObserved: 7 }), hist(WEEKS[3], 'A', { daysInStock: 1, daysObserved: 7 })];
    const sales = [sale(WEEKS[3], 'A', 0)]; // ни одной продажи нигде
    const ctx = buildStockHistoryContext(history, skus, {});
    const info = buildArticleSpeedByHistory(sales, skus, makeSettings(), NOW, ctx, {}, ['A']);
    expect(info.A.perDay).toBe(0);
    expect(info.A.noSales26).toBe(true);
  });

  it('walks exactly HISTORY_MAX_LOOKBACK_WEEKS (26) weeks before the current Monday — the boundary week itself counts', () => {
    expect(HISTORY_MAX_LOOKBACK_WEEKS).toBe(26);
    // weekBefore(22) is 26 полных недель до текущего понедельника (WEEKS[0] сам стоит 4 недели
    // до него) — ровно на границе, туда ходьба ОБЯЗАНА дойти.
    const boundaryWeek = weekBefore(22);
    const history = [
      ...WEEKS.map((w) => hist(w, 'B', { daysObserved: 7 })), // покрывает недели окна для другого товара
      hist(boundaryWeek, 'A', { daysInStock: 7, daysObserved: 7 })
    ];
    const sales = [sale(boundaryWeek, 'A', 14)];
    const ctx = buildStockHistoryContext(history, skus, {});
    const info = buildArticleSpeedByHistory(sales, skus, makeSettings(), NOW, ctx, {}, ['A']);
    expect(info.A.daysInStock).toBe(7);
    expect(info.A.perDay).toBeCloseTo(14 / 7, 10);
  });

  it('does NOT walk past 26 weeks before the current Monday — one week further is out of reach', () => {
    // weekBefore(23) is 27 полных недель назад — за пределом ходьбы; продажа там не считается,
    // а само отсутствие продаж в пределах ходьбы означает noSales26.
    const beyondWeek = weekBefore(23);
    const history = [
      ...WEEKS.map((w) => hist(w, 'B', { daysObserved: 7 })),
      hist(beyondWeek, 'A', { daysInStock: 7, daysObserved: 7 })
    ];
    const sales = [sale(beyondWeek, 'A', 14)];
    const ctx = buildStockHistoryContext(history, skus, {});
    const info = buildArticleSpeedByHistory(sales, skus, makeSettings(), NOW, ctx, {}, ['A']);
    expect(info.A.daysInStock).toBe(0);
    expect(info.A.perDay).toBe(0);
    expect(info.A.noSales26).toBe(true);
  });
});

// ===== Item 3: the old deficit correction is skipped where history covers the speed =====

describe('applyDeficitSpeedCorrection: skipped for history-covered articles (item 86 step D, definition 3)', () => {
  const skus: SKUItem[] = [makeSku({ sku: 'A' }), makeSku({ sku: 'B' })];
  const settings = makeSettings({ deficitDays: 100, bestWeeks: 1, minSalesForCorrection: 0 });

  it('an article in skipArticles is left untouched even though it looks like a deficit', () => {
    // 6 недель с продажами (trendWeeks по умолчанию 13, окно урезается по недельным строкам,
    // а applyDeficitSpeedCorrection требует минимум MIN_WEEKS_WITH_SALES = 6 недель). Старые
    // недели — высокие продажи (100 шт), последние 4 (короткое окно скорости) — распродажа
    // (5 шт): раньше это подняло бы скорость коррекцией, теперь для A она обязана не сработать.
    const TREND_SIX = [weekBefore(2), weekBefore(1), ...WEEKS];
    const sales = TREND_SIX.flatMap((w, i) => [sale(w, 'A', i < 2 ? 100 : 5), sale(w, 'B', i < 2 ? 100 : 5)]);
    const stocks: OzonStockRow[] = [makeStock({ offerId: 'A', available: 0 }), makeStock({ offerId: 'B', available: 0 })];
    const speed = buildSalesSpeed(sales, skus, WEEKS, {});
    const baseA = speed.perDayByArticle.A;
    const baseB = speed.perDayByArticle.B;
    const out = applyDeficitSpeedCorrection(speed, stocks, sales, skus, settings, NOW, {}, new Set(['A']));
    // A пропущен — скорость и разбор коррекции не появляются.
    expect(out.A).toBeUndefined();
    expect(speed.perDayByArticle.A).toBe(baseA);
    // B не в skip-наборе — коррекция считается как раньше (тут её условия тоже выполнены).
    expect(out.B).toBeDefined();
    expect(speed.perDayByArticle.B).not.toBe(baseB);
  });
});

// ===== Item 4: cluster share when history covers the share window =====

describe('rebuildClusterSpeedByShareWithHistory: redistribution invariants (definition 4)', () => {
  const skus: SKUItem[] = [makeSku({ sku: 'A' })];
  const clusters: OzonClusterRef[] = [{ clusterId: 'C1', clusterName: 'Москва' }, { clusterId: 'C2', clusterName: 'Юг' }];
  const nameToId = buildClusterNameToId(clusters);

  it('Σ over clusters of the rebuilt speed equals perDayByArticle[article] — pure redistribution', () => {
    const sales = WEEKS.flatMap((w) => [sale(w, 'A', 20, 7, 'Москва'), sale(w, 'A', 5, 7, 'Юг')]);
    const history = WEEKS.flatMap((w) => [
      hist(w, 'A', { clusterId: 'C1', daysInStock: 7, daysObserved: 7 }),
      hist(w, 'A', { clusterId: 'C2', daysInStock: 0, daysObserved: 7 }) // «Юг» пустует по данным истории, но продажи есть
    ]);
    const ctx = buildStockHistoryContext(history, skus, {});
    const speed = buildSalesSpeed(sales, skus, WEEKS, {});
    const shareWindow = buildClusterShareWindow(sales, skus, 4, NOW, {});
    const totalBefore = speed.perDayByArticle.A;
    rebuildClusterSpeedByShareWithHistory(speed, shareWindow, ctx, {}, nameToId); // без historySpeedInfo — обычный путь
    const sumAfter = Object.values(speed.perDayByArticleCluster.A).reduce((s, v) => s + v, 0);
    expect(sumAfter).toBeCloseTo(totalBefore, 10);
  });

  it('an empty cluster (0 days in stock, real sales) is lifted at MOST 2× the plain qty/W rate', () => {
    // «Юг» — 0 дней в наличии всю долю окна, но 5 шт в неделю продано (доехало из соседнего склада) —
    // rate = qty / max(d, W/2) = qty / (W/2) = 2 × (qty/W), потолок 2× сработал.
    const sales = WEEKS.flatMap((w) => [sale(w, 'A', 20, 7, 'Москва'), sale(w, 'A', 5, 7, 'Юг')]);
    const history = WEEKS.flatMap((w) => [
      hist(w, 'A', { clusterId: 'C1', daysInStock: 7, daysObserved: 7 }),
      hist(w, 'A', { clusterId: 'C2', daysInStock: 0, daysObserved: 7 })
    ]);
    const ctx = buildStockHistoryContext(history, skus, {});
    const speed = buildSalesSpeed(sales, skus, WEEKS, {});
    const shareWindow = buildClusterShareWindow(sales, skus, 4, NOW, {});
    const historySpeedInfo = { A: { perDay: speed.perDayByArticle.A, source: 'daysInStock' as const, daysInStock: 28, windowDays: 28, approximate: false, noSales26: false, qtyByCluster: {} } };
    rebuildClusterSpeedByShareWithHistory(speed, shareWindow, ctx, historySpeedInfo, nameToId);
    const W = 28;
    const rateMoscow = 80 / W; // d(Москва) = 28, полное покрытие, W/2 не сработал.
    const rateYug = 20 / (W / 2); // потолок сработал: 20 / 14 = 2 × (20/28).
    const total = rateMoscow + rateYug;
    const expectedYugShare = rateYug / total;
    expect(speed.perDayByArticleCluster.A['Юг']).toBeCloseTo(speed.perDayByArticle.A * expectedYugShare, 8);
    // Потолок: доля «Юг» не может расти сверх того, что дал бы rate = 2×(qty/W) — числом это
    // ПРОВЕРЯЕТСЯ через сравнение rateYug с 2×(qty/W), а не гаданием.
    expect(rateYug).toBeCloseTo(2 * (20 / W), 10);
  });

  it('a cluster with sales but with history covering it at exactly 0 days does not explode to Infinity/NaN', () => {
    const sales = [sale(WEEKS[3], 'A', 5, 7, 'Юг')];
    const history = WEEKS.flatMap((w) => [hist(w, 'A', { clusterId: 'C2', daysInStock: 0, daysObserved: 7 })]);
    const ctx = buildStockHistoryContext(history, skus, {});
    const speed = buildSalesSpeed(sales, skus, WEEKS, {});
    const shareWindow = buildClusterShareWindow(sales, skus, 4, NOW, {});
    const historySpeedInfo = { A: { perDay: speed.perDayByArticle.A, source: 'daysInStock' as const, daysInStock: 28, windowDays: 28, approximate: false, noSales26: false, qtyByCluster: {} } };
    rebuildClusterSpeedByShareWithHistory(speed, shareWindow, ctx, historySpeedInfo, nameToId);
    expect(Number.isFinite(speed.perDayByArticleCluster.A['Юг'])).toBe(true);
    expect(Number.isNaN(speed.perDayByArticleCluster.A['Юг'])).toBe(false);
  });

  it('a \'lookback\' article splits by PLAIN qty share over the lookback period, ignoring in-stock days', () => {
    const speed = buildSalesSpeed([], skus, WEEKS, {});
    speed.perDayByArticle.A = 4;
    const shareWindow = buildClusterShareWindow([], skus, 4, NOW, {});
    const ctx = buildStockHistoryContext([], skus, {});
    const historySpeedInfo = {
      A: {
        perDay: 4, source: 'lookback' as const, daysInStock: 20, windowDays: 40, approximate: true, noSales26: false,
        qtyByCluster: { 'Москва': 30, 'Юг': 10 }
      }
    };
    rebuildClusterSpeedByShareWithHistory(speed, shareWindow, ctx, historySpeedInfo, nameToId);
    expect(speed.perDayByArticleCluster.A['Москва']).toBeCloseTo(4 * 0.75, 10);
    expect(speed.perDayByArticleCluster.A['Юг']).toBeCloseTo(4 * 0.25, 10);
  });
});

// ===== Item 5: trend by days in stock =====

describe('buildSalesTrendWithHistory: stock-out recovery no longer inflates the trend (definition 5)', () => {
  const skus: SKUItem[] = [makeSku({ sku: 'A' })];
  // Тренд считается по trendWeeks полных недель — берём 8 недель, четыре старых (спад из-за
  // распродажи, мало дней в наличии) и четыре свежих (восстановление, товар снова в наличии).
  const TREND_WEEKS = [
    weekBefore(4), weekBefore(3), weekBefore(2), weekBefore(1), WEEKS[0], WEEKS[1], WEEKS[2], WEEKS[3]
  ];

  it('a Миска_двойная-like series (49,35,21,21 then 49×4, low weeks 3–5 days in stock): a REAL flat demand no longer reads as growth', () => {
    // Постоянный спрос 49 шт/неделю; во время распродажи (недели 1–4, 3–5 дней в наличии из 7)
    // видно только ту часть недели, что была в наличии: 49×(3/7)=21, 49×(5/7)=35. Раскладка по
    // календарным дням этого не знает и видит рост продаж 21→49, читая обычный сток-аут как тренд.
    const qty = [49, 35, 21, 21, 49, 49, 49, 49];
    const daysInStockByWeek = [7, 5, 3, 3, 7, 7, 7, 7];
    const sales = TREND_WEEKS.map((w, i) => sale(w, 'A', qty[i]));
    const history = TREND_WEEKS.map((w, i) => hist(w, 'A', { daysInStock: daysInStockByWeek[i], daysObserved: 7 }));
    const ctx = buildStockHistoryContext(history, skus, {});
    const speed = buildSalesSpeed(sales, skus, TREND_WEEKS.slice(-4), {});
    const stocks: OzonStockRow[] = [];
    const settings = makeSettings({ trendWeeks: 8 });
    const baseline = buildSalesTrend(sales, skus, settings, NOW, speed, stocks, {}, {});
    const withHistory = buildSalesTrendWithHistory(sales, skus, settings, NOW, speed, stocks, {}, ctx, {}, {});
    // Раньше (без истории): сырые недельные числа читаются как рост 21→49, raw ≈ 1.234.
    expect(baseline.A.raw).toBeGreaterThan(1.2);
    // С историей: r(w) = qty/f(w) constant = 49 во всех 8 неделях (49/1, 35/(5/7)=49, 21/(3/7)=49),
    // slope = 0, raw = 1 РОВНО — реальный спрос был постоянным, сток-аут больше не читается как тренд.
    expect(withHistory.A.historyBased).toBe(true);
    expect(withHistory.A.raw).toBe(1);
    expect(withHistory.A.slope).toBe(0);
    expect(Math.abs(withHistory.A.applied - 1)).toBeLessThan(Math.abs(baseline.A.applied - 1));
  });

  it('a usable week (7×f ≥ 3) with 0 sales STAYS in the regression — real zero demand, not disqualifying', () => {
    const qty = [0, 10, 10, 10, 10, 10, 10, 10];
    const sales = TREND_WEEKS.map((w, i) => sale(w, 'A', qty[i]));
    const history = TREND_WEEKS.map((w) => hist(w, 'A', { daysInStock: 7, daysObserved: 7 }));
    const ctx = buildStockHistoryContext(history, skus, {});
    const speed = buildSalesSpeed(sales, skus, TREND_WEEKS.slice(-4), {});
    const settings = makeSettings({ trendWeeks: 8, minSalesForCorrection: 0 });
    const result = buildSalesTrendWithHistory(sales, skus, settings, NOW, speed, [], {}, ctx, {}, {});
    expect(result.A.reason).not.toBe('zeroWeek'); // фильтр заменён — такой причины больше нет в новой ветке
    expect(result.A.weeks.length).toBe(8); // неделя с нулём осталась в ряду
  });

  it('fewer than MIN_WEEKS_WITH_SALES usable weeks (7×f < 3 в большинстве недель) → reason \'shortWindow\'', () => {
    const qty = new Array(8).fill(10);
    const sales = TREND_WEEKS.map((w, i) => sale(w, 'A', qty[i]));
    // Только 2 недели дают 7×f >= 3 (daysInStock >= 3), остальные почти без остатка.
    const daysInStockByWeek = [7, 7, 1, 1, 1, 1, 1, 1];
    const history = TREND_WEEKS.map((w, i) => hist(w, 'A', { daysInStock: daysInStockByWeek[i], daysObserved: 7 }));
    const ctx = buildStockHistoryContext(history, skus, {});
    const speed = buildSalesSpeed(sales, skus, TREND_WEEKS.slice(-4), {});
    const settings = makeSettings({ trendWeeks: 8 });
    const result = buildSalesTrendWithHistory(sales, skus, settings, NOW, speed, [], {}, ctx, {}, {});
    expect(result.A.reason).toBe('shortWindow');
    expect(result.A.applied).toBe(1);
    expect(MIN_WEEKS_WITH_SALES).toBe(6); // порог не поменялся, поменялось что он считает
  });

  it('a \'lookback\' article gets trend 1 outright, reason \'lookback\', regardless of window coverage', () => {
    const speed = buildSalesSpeed([], skus, WEEKS, {});
    const ctx = buildStockHistoryContext([], skus, {});
    const historySpeedInfo = { A: { perDay: 1, source: 'lookback' as const, daysInStock: 5, windowDays: 10, approximate: true, noSales26: false, qtyByCluster: {} } };
    const result = buildSalesTrendWithHistory([], skus, makeSettings(), NOW, speed, [], {}, ctx, historySpeedInfo, {});
    expect(result.A).toEqual({ raw: 1, applied: 1, reason: 'lookback', weeks: [], weekQty: [], windowQty: 0, slope: 0, mean: 0, zeroWeeks: 0 });
  });
});

// ===== Whole path: buildOzonCoverage =====

describe('buildOzonCoverage: whole path with history (item 86 step D)', () => {
  const skus: SKUItem[] = [makeSku({ sku: 'A', pcsPerBox: 10, leadTimeDays: 5 })];
  const clusters: OzonClusterRef[] = [{ clusterId: 'C1', clusterName: 'Москва' }];

  it('a long-absent article: recommendation and factory orderQty computed by hand from history-based speed', () => {
    // История: товар отсутствовал почти все 4 недели (daysInStock=0), кроме последней (1 день) —
    // Σ дней = 1 < 14 → lookback до покрытых недель раньше окна.
    const history = [
      ...WEEKS.slice(0, 3).map((w) => hist(w, 'A', { clusterId: 'C1', daysInStock: 0, daysObserved: 7 })),
      hist(WEEKS[3], 'A', { clusterId: 'C1', daysInStock: 1, daysObserved: 7 }),
      hist(weekBefore(1), 'A', { clusterId: 'C1', daysInStock: 7, daysObserved: 7 }),
      hist(weekBefore(2), 'A', { clusterId: 'C1', daysInStock: 7, daysObserved: 7 })
    ];
    const sales = [
      sale(WEEKS[3], 'A', 1, 7, 'Москва'),
      sale(weekBefore(1), 'A', 7, 7, 'Москва'),
      sale(weekBefore(2), 'A', 7, 7, 'Москва')
    ];
    const stocks: OzonStockRow[] = [makeStock({ offerId: 'A', clusterId: 'C1', clusterName: 'Москва', available: 5 })];
    const settings = makeSettings({ targetStockDays: 10, minStockDays: 2, deliveryToOzonDays: 0 });
    const input: OzonCoverageInput = {
      stocks, sales, skus, clusters, settings, myStockAvailability: { A: 10000 },
      factoryOnOrder: {}, now: NOW, stockHistory: history
    };
    const result = buildOzonCoverage(input);
    const art = result.articles.find((a) => a.article === 'A')!;
    // Σ дней = 1 + 7 + 7 = 15 >= 14 → перестаёт быть 'lookback', это 'daysInStock' по итогу
    // накопленных 15 дней? Нет: MIN_HISTORY_DAYS достигается ВНУТРИ цикла lookback, поэтому
    // источник остаётся 'lookback' — так помечает функция явно.
    expect(art.speedSource).toBe('lookback');
    const expectedPerDay = 15 / 15; // 1+7+7 шт за 1+7+7 дней = 1 шт/день ровно
    expect(art.perDay).toBeCloseTo(expectedPerDay, 10);
    // Рекомендация по кластеру: need = perDay × targetStockDays − estimated = 1×10 − 5 = 5,
    // коробка 10 → 1 коробка = 10 шт.
    expect(art.clusters[0].recommendation!.qty).toBe(10);
    // Заказ на фабрике: thresholdDays = lead(5) + D(0) + minStockDays(2) = 7, thresholdQty = 7.
    // pipeline = totalEstimated(5) + myStock(10000, безлимитно) — труба полна, сигнала фабрики нет.
    expect(art.factory).toBeNull();
  });

  // Independent tester's own mutation check (not in the coder's list): wiring
  // `historyCoveredArticles` (the set that must skip item 42's deficit correction for a
  // history-covered article, definition 3) to an always-empty set survived EVERY existing test,
  // including `applyDeficitSpeedCorrection`'s own direct skipArticles test — that one calls the
  // function with an explicit Set, never through `buildOzonCoverage` itself, so a wiring defect
  // in the aggregate function was invisible. This is the whole-path proof.
  it('item 42 deficit correction is skipped for a history-covered article INSIDE buildOzonCoverage, not just when called directly', () => {
    // History covers all 4 speed weeks with 7 in-stock days each — effectiveDays = 28 >= 14,
    // source 'daysInStock', speed = qty over WEEKS ÷ 28.
    const history = WEEKS.map((w) => hist(w, 'A', { clusterId: 'C1', daysInStock: 7, daysObserved: 7 }));
    // Trend window needs >= MIN_WEEKS_WITH_SALES (6) present weeks: 2 old weeks with heavy sales
    // (100 pcs) plus the 4 speed weeks with light sales (5 pcs each). Available stock is 0, so
    // the OLD empty-stock heuristic (item 42) would always fire (daysLeft = 0 < any deficitDays > 0)
    // and lift the speed to the best week's rate (100 ÷ 7 ≈ 14.29/day) — history must block it.
    const sales = [
      sale(weekBefore(2), 'A', 100, 7, 'Москва'),
      sale(weekBefore(1), 'A', 100, 7, 'Москва'),
      ...WEEKS.map((w) => sale(w, 'A', 5, 7, 'Москва'))
    ];
    const stocks: OzonStockRow[] = [makeStock({ offerId: 'A', clusterId: 'C1', clusterName: 'Москва', available: 0 })];
    const settings = makeSettings({
      targetStockDays: 10, minStockDays: 2, deliveryToOzonDays: 0,
      deficitDays: 30, trendWeeks: 13, bestWeeks: 1, minSalesForCorrection: 0
    });
    const input: OzonCoverageInput = {
      stocks, sales, skus, clusters, settings, myStockAvailability: { A: 10000 },
      factoryOnOrder: {}, now: NOW, stockHistory: history
    };
    const result = buildOzonCoverage(input);
    const art = result.articles.find((a) => a.article === 'A')!;
    expect(art.speedSource).toBe('daysInStock');
    // 4 × 5 = 20 pcs over 28 effective in-stock days — the history speed, untouched.
    expect(art.perDay).toBeCloseTo(20 / 28, 10);
    // The deficit correction must not have run for this article at all.
    expect(art.speedCorrection).toBeNull();
    // A mutant that always runs the correction would lift perDay to ~14.29/day (100 ÷ 7)
    // instead — an order-of-magnitude difference a silent wiring bug must not produce.
    expect(art.perDay).toBeLessThan(1);
  });

  it('noSales26 → no recommendation, no factory signal, and the flag itself reaches ArticleCoverage', () => {
    const history = WEEKS.map((w) => hist(w, 'A', { clusterId: 'C1', daysInStock: 0, daysObserved: 7 }));
    const sales = WEEKS.map((w) => sale(w, 'A', 0, 7, 'Москва'));
    const stocks: OzonStockRow[] = [makeStock({ offerId: 'A', clusterId: 'C1', clusterName: 'Москва', available: 5 })];
    const settings = makeSettings({ targetStockDays: 10, minStockDays: 2 });
    const result = buildOzonCoverage({
      stocks, sales, skus, clusters, settings, myStockAvailability: { A: 10000 }, now: NOW, stockHistory: history
    });
    const art = result.articles.find((a) => a.article === 'A')!;
    expect(art.noSales26).toBe(true);
    expect(art.perDay).toBe(0);
    expect(art.clusters[0].recommendation).toBeNull();
    expect(art.factory).toBeNull();
  });

  // Три разных богатых сценария (отличаются кластерами/комплектами/настройками) — во всех трёх
  // отсутствие stockHistory (пропущено вовсе / пустой массив) должно давать ОДИНАКОВЫЙ результат.
  const richInputs: OzonCoverageInput[] = [
    {
      stocks: [makeStock({ offerId: 'A', clusterId: 'C1', clusterName: 'Москва', available: 50 })],
      sales: WEEKS.map((w) => sale(w, 'A', 20, 7, 'Москва')),
      skus, clusters, settings: makeSettings({ targetStockDays: 15 }),
      myStockAvailability: { A: 500 }, now: NOW
    },
    {
      stocks: [
        makeStock({ offerId: 'A', clusterId: 'C1', clusterName: 'Москва', available: 5 }),
        makeStock({ offerId: 'A', clusterId: 'C2', clusterName: 'Юг', available: 0 })
      ],
      sales: WEEKS.flatMap((w) => [sale(w, 'A', 15, 7, 'Москва'), sale(w, 'A', 5, 7, 'Юг')]),
      skus, clusters: [...clusters, { clusterId: 'C2', clusterName: 'Юг' }],
      settings: makeSettings({ targetStockDays: 20, deficitDays: 5, trendWeeks: 4, bestWeeks: 2, minSalesForCorrection: 0 }),
      myStockAvailability: { A: 200 }, now: NOW
    },
    {
      stocks: [makeStock({ offerId: 'A', clusterId: 'C1', clusterName: 'Москва', available: 0 })],
      sales: WEEKS.map((w) => sale(w, 'A', 3, 7, 'Москва')), // мелкая выборка — фильтры тренда
      skus, clusters, settings: makeSettings({ targetStockDays: 30, demandGrowthPct: 20 }),
      myStockAvailability: { A: 0 }, now: NOW
    }
  ];

  richInputs.forEach((base, i) => {
    it(`rich fixture ${i + 1}: absent stockHistory vs empty stockHistory: [] gives a deep-equal result`, () => {
      const { stockHistory: _drop, ...withoutKey } = base as any;
      const r1 = buildOzonCoverage(withoutKey);
      const r2 = buildOzonCoverage({ ...base, stockHistory: [] });
      expect(r2).toEqual(r1);
    });
  });
});

// ===== Generated sets (≥ 500, seeded) =====

describe('buildOzonCoverage with history: 500 сгенерированных наборов (item 86 step D)', () => {
  it('invariants hold across randomised history/sales combinations', () => {
    let seed = 424242;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const skus: SKUItem[] = [makeSku({ sku: 'A', pcsPerBox: 5, leadTimeDays: 3 })];
    const clusters: OzonClusterRef[] = [{ clusterId: 'C1', clusterName: 'Москва' }, { clusterId: 'C2', clusterName: 'Юг' }];

    for (let n = 0; n < 500; n++) {
      const daysM = [0, 1, 2, 3, 4, 5, 6, 7][Math.floor(rnd() * 8)];
      const daysY = [0, 1, 2, 3, 4, 5, 6, 7][Math.floor(rnd() * 8)];
      const qtyM = Math.floor(rnd() * 30);
      const qtyY = Math.floor(rnd() * 30);
      const history = WEEKS.flatMap((w) => [
        hist(w, 'A', { clusterId: 'C1', daysInStock: daysM, daysObserved: 7 }),
        hist(w, 'A', { clusterId: 'C2', daysInStock: daysY, daysObserved: 7 })
      ]);
      const sales = WEEKS.flatMap((w) => [sale(w, 'A', qtyM, 7, 'Москва'), sale(w, 'A', qtyY, 7, 'Юг')]);
      const stocks: OzonStockRow[] = [
        makeStock({ offerId: 'A', clusterId: 'C1', clusterName: 'Москва', available: Math.floor(rnd() * 100) }),
        makeStock({ offerId: 'A', clusterId: 'C2', clusterName: 'Юг', available: Math.floor(rnd() * 100) })
      ];
      const settings = makeSettings({ targetStockDays: 10 + Math.floor(rnd() * 20) });
      const result = buildOzonCoverage({
        stocks, sales, skus, clusters, settings, myStockAvailability: { A: 100000 }, now: NOW, stockHistory: history
      });
      const art = result.articles.find((a) => a.article === 'A')!;

      // Σ по кластерам скорости = скорость товара.
      const clusterSum = art.clusters.reduce((s, c) => s + c.perDay, 0);
      expect(clusterSum, `set ${n}`).toBeCloseTo(art.perDay, 6);

      // Нет NaN/Infinity нигде в числовых полях товара.
      for (const key of ['perDay', 'forecastPerDay', 'totalEstimated', 'speedDaysInStock', 'speedWindowDays'] as const) {
        expect(Number.isFinite(art[key] as number), `set ${n} field ${key}`).toBe(true);
      }
      for (const c of art.clusters) {
        expect(Number.isFinite(c.perDay), `set ${n} cluster perDay`).toBe(true);
      }

      // Скорость по истории (без lookback) не может быть МЕНЬШЕ календарной того же окна:
      // дней в наличии меньше или равно календарным дням окна.
      if (art.speedSource === 'daysInStock') {
        const calendarSpeed = buildSalesSpeed(sales, skus, WEEKS, {}).perDayByArticle.A || 0;
        expect(art.perDay, `set ${n}`).toBeGreaterThanOrEqual(calendarSpeed - 1e-9);
      }
    }
  });
});

// ===== Display: tooltip texts and the noSales26 label =====

describe('OzonStocksTab: display of the speed source (item 86 step D) — text guards', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/OzonStocksTab.tsx'), 'utf8');

  it('daysInStock tooltip text is exactly as specified', () => {
    expect(src).toContain('Скорость по дням наличия: продано');
    expect(src).toContain('дн. в наличии (из');
    expect(src).toContain('дн. окна)');
  });

  it('lookback tooltip text and the approximate note are exactly as specified', () => {
    expect(src).toContain('Товара долго не было: скорость по периоду');
    expect(src).toContain('Приблизительно: до 18.08 история наличия не велась, недели с продажами считаются днями в наличии');
  });

  it('calendar tooltip text is exactly as specified', () => {
    expect(src).toContain('История наличия ещё не покрывает окно — скорость по календарным дням');
  });

  it('the noSales26 label text is exact, byte for byte', () => {
    expect(src).toContain('Товар не продавался более 26 недель');
  });

  it('a lookback article gets its own small visible mark next to the speed', () => {
    expect(src).toContain("art.speedSource === 'lookback'");
    expect(src).toContain('товара долго не было');
  });

  it('the trend tooltip mentions «дни наличия» / lookback wording, anchored precisely', () => {
    expect(src).toContain('Тренд считается по дням наличия, а не по календарным неделям.');
    expect(src).toContain('Товара долго не было — тренд не применяется');
  });

  it('speed tooltip numbers are read from the RESULT fields, and «продано N шт» is speedSoldQty — never perDay × days', () => {
    const block = src.slice(src.indexOf('const speedSoldQty'), src.indexOf('const speedSoldQty') + 900);
    expect(block).toContain('const speedSoldQty = art.speedSoldQty;');
    expect(block).toContain('art.speedDaysInStock');
    expect(block).toContain('art.speedWindowDays');
    expect(block).not.toContain('art.perDay *');
    expect(block).not.toContain('buildArticleSpeedByHistory');
  });
});

describe('speedSoldQty: the tooltip quantity survives «Спрос вырос» (item 73) replacing perDay', () => {
  it('stock-out week + a jump in the last week: perDay becomes the 7-day speed, speedSoldQty stays the real 84 pcs', () => {
    const skus = [makeSku({ sku: 'A' })];
    // Week 1 out of stock (0 of 7 days), weeks 2–4 in stock → 21 in-stock days.
    const history = WEEKS.map((w, i) => hist(w, 'A', { daysInStock: i === 0 ? 0 : 7, daysObserved: 7 }));
    // Sold 0 + 7 + 7 + 70 = 84 pcs → base speed 84 / 21 = 4/day.
    const sales = WEEKS.map((w, i) => sale(w, 'A', [0, 7, 7, 70][i]));
    const input: OzonCoverageInput = {
      stocks: [makeStock({ offerId: 'A', clusterName: 'Москва', clusterId: 'C1', available: 100 })],
      sales, skus, clusters: [{ clusterId: 'C1', clusterName: 'Москва' }],
      settings: makeSettings({ demandGrowthPct: 30 }),
      myStockAvailability: { A: 0 }, stockHistory: history, now: NOW
    };
    const art = buildOzonCoverage(input).articles.find((a) => a.article === 'A')!;
    expect(art.speedSource).toBe('daysInStock');
    expect(art.speedDaysInStock).toBe(21);
    // Last 7 days = the whole last full week (no current part-week row): 70 / 7 = 10/day,
    // +150 % against 4/day > 30 % → item 73 replaces the speed.
    expect(art.demandGrowth && art.demandGrowth.applied).toBe(true);
    expect(art.perDay).toBeCloseTo(10, 10);
    // The tooltip must say 84 pcs, not perDay × days = 210.
    expect(art.speedSoldQty).toBe(84);
  });

  it('without history speedSoldQty is 0 (the calendar tooltip shows no quantity)', () => {
    const skus = [makeSku({ sku: 'A' })];
    const art = buildOzonCoverage({
      stocks: [], sales: WEEKS.map((w) => sale(w, 'A', 7)), skus, clusters: [],
      settings: makeSettings(), myStockAvailability: {}, now: NOW
    }).articles.find((a) => a.article === 'A')!;
    expect(art.speedSource).toBe('calendar');
    expect(art.speedSoldQty).toBe(0);
  });
});
