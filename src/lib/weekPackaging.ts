/** Item 97 ticket 06, part A: week packaging (step 1) pure rules. Twin: weekPackagingTargetsGs in Code.gs. */
import { parseKopecks } from './contractorInvoice';

export interface WeekPackagingRow { id: number; article: string; quantity: number; isComponent: boolean }
export interface WeekPackagingOperation { opId: string; rows: WeekPackagingRow[] }
export interface WeekPackagingTarget {
  id: number; opId: string; article: string; quantity: number; unitKop: number; targetKop: number;
}
export interface WeekPackagingResult { ok: boolean; missing: string[]; invalid: string[]; rows: WeekPackagingTarget[] }
export interface InvoiceLineLike { name: string; packaging?: boolean }

/** A line is packaging when its name STARTS with «стикеровк» / «упаковк» (a long complex-service name does not). */
export const isPackagingLineName = (name: string): boolean => /^\s*(стикеровк|упаковк)/i.test(name);

/** The stored mark (true/false) wins; without it the name decides. */
export const invoiceLineIsPackaging = (line: InvoiceLineLike): boolean =>
  typeof line.packaging === 'boolean' ? line.packaging : isPackagingLineName(line.name);

/** Quantity per article over non-component rows of the week, sorted by article. */
export function weekArticleSummary(operations: WeekPackagingOperation[]): { article: string; qty: number }[] {
  const byArticle = new Map<string, number>();
  for (const op of operations) {
    for (const r of op.rows) {
      if (r.isComponent) continue;
      byArticle.set(r.article, (byArticle.get(r.article) ?? 0) + r.quantity);
    }
  }
  return [...byArticle.entries()]
    .map(([article, qty]) => ({ article, qty }))
    .sort((a, b) => (a.article < b.article ? -1 : a.article > b.article ? 1 : 0));
}

/** Per non-component row: unit price (override of its operation+article, else the week price) x quantity, in kopecks. */
export function weekPackagingTargets(
  operations: WeekPackagingOperation[],
  prices: { article: string; unit: string }[],
  overrides: { opId: string; article: string; unit: string }[]
): WeekPackagingResult {
  const missing: string[] = [];
  const invalid: string[] = [];
  const rows: WeekPackagingTarget[] = [];
  for (const op of operations) {
    for (const r of op.rows) {
      if (r.isComponent) continue;
      const override = overrides.find((o) => o.opId === op.opId && o.article === r.article);
      const price = override ?? prices.find((p) => p.article === r.article);
      if (!price) {
        if (!missing.includes(r.article)) missing.push(r.article);
        continue;
      }
      const unitKop = parseKopecks(String(price.unit ?? ''));
      if (unitKop === null) {
        if (!invalid.includes(r.article)) invalid.push(r.article);
        continue;
      }
      rows.push({ id: r.id, opId: op.opId, article: r.article, quantity: r.quantity, unitKop, targetKop: unitKop * r.quantity });
    }
  }
  return { ok: missing.length === 0 && invalid.length === 0, missing, invalid, rows };
}

export const step1TotalKop = (rows: { targetKop: number }[]): number =>
  rows.reduce((sum, r) => sum + r.targetKop, 0);

/** Sum of packaging lines' sums (kopecks) over every invoice of the week; an unreadable sum counts as 0. */
export function invoicePackagingTotalKop(invoices: { lines: { name: string; sum: string; packaging?: boolean }[] }[]): number {
  let total = 0;
  for (const inv of invoices) {
    for (const l of inv.lines) {
      if (invoiceLineIsPackaging(l)) total += parseKopecks(l.sum) ?? 0;
    }
  }
  return total;
}
