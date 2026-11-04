/** Item 97 ticket 07, part A: week spread (step 2) pure rules, integer kopecks only.
 *  Twins in Code.gs: invoiceSelectionKopGs, splitKopByWeightsGs, weekSpreadTargetsGs. */
import { parseKopecks, parseQtyMilli } from './contractorInvoice';

export interface SpreadInvoiceLine { n: number; qty: string; price: number | string; sum: number | string; toSupply: boolean }
export interface SpreadSelection { n: number; qty: string }
export interface SpreadSelectionResult { ok: boolean; errors: string[]; selectedKop: number; unallocatedKop: number; totalKop: number }
export interface SpreadRow { id: number; article: string; quantity: number; isComponent: boolean }
export interface SpreadOperation { opId: string; cabinet: string; rows: SpreadRow[] }
export interface SpreadRowTarget { id: number; article: string; boxes: number; shareKop: number }
export interface SpreadOperationTarget { opId: string; cabinet: string; boxes: number; shareKop: number; rows: SpreadRowTarget[] }
export interface SpreadResult {
  ok: boolean; missing: string[]; operations: SpreadOperationTarget[]; byCabinet: Record<string, number>;
}

/** Kopecks of the ticked invoice lines. Full quantity takes the line sum; a part is qtyMilli x priceKop / 1000 half-up. */
export function invoiceSelectionKop(lines: SpreadInvoiceLine[], selections: SpreadSelection[]): SpreadSelectionResult {
  const errors: string[] = [];
  let totalKop = 0;
  for (const l of lines) totalKop += parseKopecks(String(l.sum)) ?? 0;
  if (selections.length === 0) errors.push('Не выбрано ни одной строки счёта');
  const seen: number[] = [];
  let selectedKop = 0;
  for (const s of selections) {
    const line = lines.find((l) => l.n === s.n);
    if (!line) { errors.push('Строки ' + s.n + ' нет в счёте'); continue; }
    if (seen.indexOf(s.n) >= 0) { errors.push('Строка ' + s.n + ' выбрана дважды'); continue; }
    seen.push(s.n);
    if (!line.toSupply) { errors.push('Строка ' + s.n + ' не отмечена «На поставку»'); continue; }
    const qtyMilli = parseQtyMilli(String(s.qty));
    const lineMilli = parseQtyMilli(String(line.qty));
    if (qtyMilli === null) { errors.push('Строка ' + s.n + ': количество «' + s.qty + '» не подходит (нужно число больше 0, до 3 знаков)'); continue; }
    if (lineMilli === null || qtyMilli > lineMilli) { errors.push('Строка ' + s.n + ': количество «' + s.qty + '» больше, чем в счёте'); continue; }
    const sumKop = parseKopecks(String(line.sum));
    const priceKop = parseKopecks(String(line.price));
    if (qtyMilli === lineMilli && sumKop !== null) { selectedKop += sumKop; continue; }
    if (priceKop === null) { errors.push('Строка ' + s.n + ': не удалось прочитать цену'); continue; }
    selectedKop += Math.floor((qtyMilli * priceKop + 500) / 1000);
  }
  return { ok: errors.length === 0, errors, selectedKop, unallocatedKop: totalKop - selectedKop, totalKop };
}

/** Largest-remainder split of totalKop by integer weights; ties go to the earlier index; all-zero weights give zeros. */
export function splitKopByWeights(totalKop: number, weights: number[]): number[] {
  const sum = weights.reduce((a, w) => a + w, 0);
  if (sum <= 0) return weights.map(() => 0);
  const shares = weights.map((w) => Math.floor((totalKop * w) / sum));
  const order = weights
    .map((w, i) => ({ i, rem: (totalKop * w) % sum }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  let left = totalKop - shares.reduce((a, s) => a + s, 0);
  for (let k = 0; left > 0 && k < order.length; k++, left--) shares[order[k].i] += 1;
  return shares;
}

const hasNorm = (v: number | null | undefined): v is number => typeof v === 'number' && isFinite(v) && v > 0;

/** Total -> operations by boxes -> rows by boxes. Component and qty <= 0 rows carry 0 and need no norm; a missing norm blocks. */
export function weekSpreadTargets(
  totalKop: number,
  operations: SpreadOperation[],
  pcsPerBox: Record<string, number | null>
): SpreadResult {
  const missing: string[] = [];
  const opRows = operations.map((op) => op.rows.map((r) => {
    if (r.isComponent || !(r.quantity > 0)) return 0;
    const norm = pcsPerBox[r.article];
    if (!hasNorm(norm)) {
      if (missing.indexOf(r.article) < 0) missing.push(r.article);
      return 0;
    }
    return Math.ceil(r.quantity / norm);
  }));
  if (missing.length > 0) return { ok: false, missing: missing.sort(), operations: [], byCabinet: {} };
  const opBoxes = opRows.map((boxes) => boxes.reduce((a, b) => a + b, 0));
  const opShares = splitKopByWeights(totalKop, opBoxes);
  const byCabinet: Record<string, number> = {};
  const result = operations.map((op, i) => {
    const rowShares = splitKopByWeights(opShares[i], opRows[i]);
    byCabinet[op.cabinet] = (byCabinet[op.cabinet] ?? 0) + opShares[i];
    return {
      opId: op.opId, cabinet: op.cabinet, boxes: opBoxes[i], shareKop: opShares[i],
      rows: op.rows.map((r, j) => ({ id: r.id, article: r.article, boxes: opRows[i][j], shareKop: rowShares[j] }))
    };
  });
  return { ok: true, missing: [], operations: result, byCabinet };
}
