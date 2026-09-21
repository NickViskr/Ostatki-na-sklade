/**
 * Item 77 (2026-09-21): the «Оборач. (дни)» column of the «Склад» table.
 *
 * Owner's case on the first version: «Органайзер_2_пол_прозр» arrived at the warehouse three
 * days before, sells well on Ozon, yet showed «нет продаж» — because the speed was taken
 * from the warehouse journal, where «Расход» is a SHIPMENT TO OZON, not a customer sale. A
 * product not yet shipped had no expenses and looked dead. Decision 2026-09-21 (variant B):
 * the speed is Ozon customer sales — the same `perDay` the supply planner uses (window from
 * the Ozon settings, current week included, deficit correction, demand growth) — and the
 * stock is EVERYTHING that still has to sell: the shelf (reserved part included) plus the
 * estimated Ozon stock. An article without Ozon sales in the window has NO turnover (null);
 * the screen says «нет продаж на Ozon» and how long it has lain since the last receipt.
 */
import { Transaction } from '../types';
import { parseAppDate } from './utils';

export interface StockParts {
  /** Pieces on the shelf of the own warehouse, the reserve under supply orders included. */
  shelf: number;
  /** Estimated Ozon stock (available + transit + resellable returns), all clusters. */
  ozon: number;
}

/**
 * Days until the whole stock is sold at the Ozon speed; null when there is no speed to
 * divide by. An empty total with a speed gives 0: sold out, nothing lies anywhere.
 */
export function coverageDays(parts: StockParts, perDay: number): number | null {
  if (!(perDay > 0)) return null;
  const total = (Number(parts.shelf) || 0) + (Number(parts.ozon) || 0);
  return Math.round(total / perDay);
}

/** Date of the latest «Приход» per article, so the screen can say how long a product lies. */
export function lastReceiptByArticle(transactions: Transaction[]): Map<string, Date> {
  const out = new Map<string, Date>();
  for (const t of transactions || []) {
    if (t.type !== 'Приход') continue;
    const d = parseAppDate(t.date);
    if (!d) continue;
    const cur = out.get(t.article);
    if (!cur || d > cur) out.set(t.article, d);
  }
  return out;
}

/** Whole days between the receipt and now, never negative. */
export function daysLying(receipt: Date, now: Date = new Date()): number {
  const ms = now.getTime() - receipt.getTime();
  return Math.max(0, Math.floor(ms / 86400000));
}

/** Sort key: null (no sales) is the slowest of all, so it lands last in ascending order. */
export function turnoverSortValue(v: number | null): number {
  return v === null ? Number.POSITIVE_INFINITY : v;
}
