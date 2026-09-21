/**
 * Item 77 (2026-09-21): the «Оборач. (дни)» column of the «Склад» table, computed in the
 * browser from the transaction journal instead of the nightly Code.gs figure.
 *
 * Why the server figure was wrong for the owner's eyes: `recalculateDailyAnalytics` wrote
 * 0 for an article WITHOUT sales, so a product lying untouched for a year showed «0 дн.» —
 * the best value in the table. It also always used 120 days while the dashboard setting
 * «Период для расчёта оборачиваемости» only drove the summary card.
 *
 * Here «sale» means an expense («Расход») of the article, exactly as the summary card counts
 * it; an article without expenses in the window has NO turnover (null), and the screen says
 * «нет продаж» with the date of the last expense ever, so the owner sees how long it lies.
 */
import { Transaction } from '../types';
import { parseAppDate } from './utils';

export interface ArticleSales {
  /** Pieces expensed inside the window. */
  qty: number;
  /** Date of the latest expense of the article regardless of the window, or null if none. */
  lastDate: Date | null;
}

/** Midnight `days` days before `now` — the same cut the summary card uses. */
export function windowStart(days: number, now: Date = new Date()): Date {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - days);
  cutoff.setHours(0, 0, 0, 0);
  return cutoff;
}

/** Expensed pieces per article inside the window, plus the last expense date at any time. */
export function salesByArticle(transactions: Transaction[], days: number, now: Date = new Date()): Map<string, ArticleSales> {
  const cutoff = windowStart(days, now);
  const out = new Map<string, ArticleSales>();
  for (const t of transactions || []) {
    if (t.type !== 'Расход') continue;
    const d = parseAppDate(t.date);
    if (!d) continue;
    const cur = out.get(t.article) || { qty: 0, lastDate: null };
    if (d >= cutoff) cur.qty += Number(t.quantity) || 0;
    if (!cur.lastDate || d > cur.lastDate) cur.lastDate = d;
    out.set(t.article, cur);
  }
  return out;
}

/**
 * Days to sell the current quantity at the window's speed; null when nothing sold in the
 * window (no speed to divide by). A zero shelf with sales gives 0: sold out, nothing lies.
 */
export function turnoverDays(quantity: number, soldInWindow: number, days: number): number | null {
  if (soldInWindow <= 0) return null;
  return Math.round((quantity / soldInWindow) * days);
}

/** Sort key: null (no sales) is the slowest of all, so it lands last in ascending order. */
export function turnoverSortValue(v: number | null): number {
  return v === null ? Number.POSITIVE_INFINITY : v;
}
