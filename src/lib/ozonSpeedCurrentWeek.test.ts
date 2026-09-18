import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildOzonCoverage, buildSalesSpeed, getMskWeekMonday } from './ozonCoverage';
import type { OzonSalesRow, SKUItem } from '../types';

/**
 * Item 71. The current week enters the speed window by its elapsed days.
 * Wednesday 16.09.2026 05:07 МСК: three full weeks (24.08, 31.08, 07.09) of 70 pieces and the
 * current week (14.09) with 40 pieces in 2.21 days → (210 + 40) / (21 + 2.21).
 */
const NOW = new Date('2026-09-16T02:07:00Z');
const CURRENT = '2026-09-14';
const FULL = ['2026-08-24', '2026-08-31', '2026-09-07'];
const ART = 'ART';
const skus: SKUItem[] = [{ sku: ART, price: 0, minStock: 0, pcsPerBox: 1, boxesPerPallet: 0, volumeLiters: 0, leadTimeDays: 0 }];

const row = (week: string, qty: number, days: number, clusterName = 'Екатеринбург'): OzonSalesRow =>
  ({ week, cabinet: 'Mercurius', offerId: ART, clusterName, qty, updatedAt: '', days });

const fullRows = FULL.map((w) => row(w, 70, 7));

describe('Item 71. Скорость продаж с учётом текущей недели', () => {
  it('текущая неделя с «Дней» = 2.21 входит в окно своей длиной', () => {
    const speed = buildSalesSpeed([...fullRows, row(CURRENT, 40, 2.21)], skus, FULL, undefined, CURRENT);
    expect(speed.weeks).toEqual(FULL);
    expect(speed.currentWeek).toBe(CURRENT);
    expect(speed.currentWeekDays).toBe(2.21);
    expect(speed.windowDays).toBeCloseTo(23.21, 10);
    expect(speed.qtyByArticle[ART]).toBe(250);
    expect(speed.perDayByArticle[ART]).toBeCloseTo(250 / 23.21, 10);
    expect(speed.perDayByArticleCluster[ART]['Екатеринбург']).toBeCloseTo(250 / 23.21, 10);
  });

  it('строка текущей недели, записанная по-старому с «Дней» = 7, в окно НЕ входит', () => {
    const speed = buildSalesSpeed([...fullRows, row(CURRENT, 40, 7)], skus, FULL, undefined, CURRENT);
    expect(speed.currentWeek).toBeNull();
    expect(speed.currentWeekDays).toBe(0);
    expect(speed.windowDays).toBe(21);
    expect(speed.qtyByArticle[ART]).toBe(210);
  });

  it('без параметра currentWeek — прежнее окно из полных недель', () => {
    const speed = buildSalesSpeed([...fullRows, row(CURRENT, 40, 2.21)], skus, FULL);
    expect(speed.windowDays).toBe(21);
    expect(speed.qtyByArticle[ART]).toBe(210);
    expect(speed.currentWeekDays).toBe(0);
  });

  it('частичная строка ЧУЖОЙ недели (не текущей) не считается — ни одна, ни рядом с текущей', () => {
    const alone = buildSalesSpeed([...fullRows, row('2026-09-07', 5, 3.5)], skus, FULL, undefined, CURRENT);
    expect(alone.windowDays).toBe(21);
    expect(alone.qtyByArticle[ART]).toBe(210);
    // a stray part-row of a past week next to the real current one: only the current one counts
    const both = buildSalesSpeed([...fullRows, row('2026-09-07', 5, 3.5), row(CURRENT, 40, 2.21)], skus, FULL, undefined, CURRENT);
    expect(both.windowDays).toBeCloseTo(23.21, 10);
    expect(both.qtyByArticle[ART]).toBe(250);
  });

  it('несколько строк текущей недели (кластеры) — дни берутся один раз, штуки складываются', () => {
    const speed = buildSalesSpeed(
      [...fullRows, row(CURRENT, 30, 2.21, 'Екатеринбург'), row(CURRENT, 10, 2.21, 'Москва')],
      skus, FULL, undefined, CURRENT
    );
    expect(speed.windowDays).toBeCloseTo(23.21, 10);
    expect(speed.qtyByArticle[ART]).toBe(250);
    expect(speed.qtyByArticleCluster[ART]['Москва']).toBe(10);
  });

  it('только текущая неделя, полных нет — окно равно её длине', () => {
    const speed = buildSalesSpeed([row(CURRENT, 40, 2.21)], skus, FULL, undefined, CURRENT);
    expect(speed.weeks).toEqual([]);
    expect(speed.windowDays).toBe(2.21);
    expect(speed.perDayByArticle[ART]).toBeCloseTo(40 / 2.21, 10);
  });

  it('buildOzonCoverage передаёт понедельник текущей недели по МСК', () => {
    expect(getMskWeekMonday(NOW)).toBe(CURRENT);
    const res = buildOzonCoverage({
      stocks: [], sales: [...fullRows, row(CURRENT, 40, 2.21)], skus, clusters: [],
      settings: { speedWeeks: 3, minStockDays: 10, targetStockDays: 20, factoryOrderDays: 50, returnsToSalePct: 0, excludedClusters: '' },
      myStockAvailability: {}, pending: undefined as any, factoryOnOrder: {}, kits: [], now: NOW
    });
    expect(res.speed.currentWeek).toBe(CURRENT);
    expect(res.speed.windowDays).toBeCloseTo(23.21, 10);
    const src = fs.readFileSync(path.join(process.cwd(), 'src/lib/ozonCoverage.ts'), 'utf8');
    expect(src).toContain('buildSalesSpeed(input.sales, input.skus, weeks, offerIdToArticle, getMskWeekMonday(now))');
  });

  it('Code.gs пишет прошедшие дни только строке текущей недели, остальным 7', () => {
    const gas = fs.readFileSync(path.join(process.cwd(), 'Code.gs'), 'utf8');
    expect(gas).toContain('row[daysIdx] = itemWeek === currentWeekInfo.monday ? currentWeekInfo.elapsedDays : 7;');
    expect(gas).toContain('elapsedDays: Math.max(0.01, Math.min(6.99, elapsed))');
  });
});
