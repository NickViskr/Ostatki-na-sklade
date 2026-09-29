// ===== Item 90: the whole shipment — its rows, its orders and the per-order share preview =====
//
// Twins of the Code.gs functions `shipmentRowsOfTransaction(id, true)`, `resolveShipmentOrdersGs`
// and `updateShipmentExtras` (the share arithmetic) — see docs/adr/0001-twin-rules-parity-not-bundling.md.
// The twin-rules parity test feeds both sides the same generated combined shipments. Pure: no
// store, no network. The preview is what the window shows before saving; the amounts written to
// the books are worked out by the server.

import type { Transaction } from '../types';
import { splitByQuantity } from './ozonBatchWriteOff';
import { roundToTwo as round2 } from './utils';
import {
  amountTotal, extrasTotal, parseShipmentExtras, type ExtrasMode, type ExtrasServiceEntry, type ShipmentExtras
} from './shipmentExtras';

export type WholeShipmentRow = Pick<Transaction,
  'id' | 'date' | 'type' | 'article' | 'quantity' | 'destination' | 'isComponent'
  | 'shipmentId' | 'opId' | 'additionalCosts'>;

export interface WholeShipmentOrder<R extends WholeShipmentRow = WholeShipmentRow> {
  /** '' for orders that lost their OpID and could not be attached to any order that has one. */
  opId: string;
  rows: R[];
}

export interface OrderSharePreview {
  opId: string;
  pieces: number;
  oldShare: number;
  newShare: number;
}

/** Thrown when a row of a shipment with a number has no OpID: the correction must write nothing. */
export class AmbiguousOrderError extends Error {}

/** Pieces the costs are spread over: rows less kit components (twin of `shipmentPieces`). */
export const shipmentPiecesOf = (rows: WholeShipmentRow[]): number =>
  rows.reduce((sum, r) => (r.isComponent === true ? sum : sum + (Number(r.quantity) || 0)), 0);

/**
 * The rows of the whole shipment the anchor belongs to: all rows sharing its shipment number,
 * else the rows of its operation (same OpID, or — before OpID — same moment, type and object).
 */
export function wholeShipmentRows<R extends WholeShipmentRow>(transactions: R[], anchor: R): R[] {
  const ship = (anchor.shipmentId ?? '').trim();
  const op = (anchor.opId ?? '').trim();
  return transactions.filter((t) => {
    if (ship) return (t.shipmentId ?? '').trim() === ship;
    if (op) return (t.opId ?? '').trim() === op;
    return t.date === anchor.date && t.type === anchor.type && t.destination === anchor.destination;
  });
}

const opSuffix = (opId: string): number => {
  const m = String(opId).match(/-(\d+)$/);
  return m ? Number(m[1]) : Infinity;
};

/**
 * Orders of a whole-shipment set. No shipment number → one operation, one order. With one: the key
 * is the OpID and a row without OpID cannot be placed — AmbiguousOrderError (the server refuses and
 * writes nothing). Sequence: OpID numeric suffix, then first appearance.
 */
export function wholeShipmentOrders<R extends WholeShipmentRow>(rows: R[]): WholeShipmentOrder<R>[] {
  if (rows.length === 0) return [];
  if (!(rows[0].shipmentId ?? '').trim()) return [{ opId: (rows[0].opId ?? '').trim(), rows: rows.slice() }];

  const groups: WholeShipmentOrder<R>[] = [];
  const byOp = new Map<string, WholeShipmentOrder<R>>();
  for (const r of rows) {
    const op = (r.opId ?? '').trim();
    if (!op) throw new AmbiguousOrderError(r.article);
    let g = byOp.get(op);
    if (!g) { g = { opId: op, rows: [] }; byOp.set(op, g); groups.push(g); }
    g.rows.push(r);
  }
  return groups
    .map((g, i) => ({ g, i }))
    // Infinity - Infinity is NaN (falsy): two suffix-less OpIDs fall back to first appearance
    .sort((a, b) => (opSuffix(a.g.opId) - opSuffix(b.g.opId)) || (a.i - b.i))
    .map((x) => x.g);
}

/**
 * Per-order pieces and shares for a new shipment total. A shipment with a number: the old share is
 * the order's stored «ДопРасходы» (empty → 0) and the new total is cut by pieces (`splitByQuantity`,
 * kopecks, largest remainder). A single operation: the old total is read out of «Объект», the new
 * one is carried by the one order whole.
 */
export function orderSharesPreview<R extends WholeShipmentRow>(
  orders: WholeShipmentOrder<R>[],
  newTotal: number
): OrderSharePreview[] {
  const pieces = orders.map((o) => shipmentPiecesOf(o.rows));
  const hasShipmentId = orders.length > 0 && !!(orders[0].rows[0]?.shipmentId ?? '').trim();
  const newShares = hasShipmentId ? splitByQuantity(newTotal, pieces) : orders.map(() => round2(newTotal));
  return orders.map((o, i) => {
    let oldShare = 0;
    if (!hasShipmentId) {
      oldShare = extrasTotal(parseShipmentExtras(o.rows[0].destination));
    } else {
      const carrier = o.rows.find((r) => r.isComponent !== true);
      oldShare = carrier && carrier.additionalCosts != null ? round2(Number(carrier.additionalCosts)) : 0;
    }
    return { opId: o.opId, pieces: pieces[i], oldShare, newShare: newShares[i] };
  });
}

// ----- The window «Вся отгрузка»: everything it shows, derived in one pure function -----

export interface WholeShipmentOrderView {
  opId: string;
  /** Order label from the «Общая поставка» note, else «Заявка N», else the object of the operation. */
  label: string;
  pieces: number;
  /** Articles of the order (kit components excluded — the kit row carries their pieces). */
  articles: { article: string; quantity: number }[];
  oldShare: number;
  newShare: number;
}

export type WholeShipmentView =
  | { kind: 'refused'; reason: string }
  | { kind: 'ok'; orders: WholeShipmentOrderView[]; totalPieces: number; oldTotal: number; newTotal: number };

export const OLD_COMBINED_SHIPMENT_REASON =
  'Эта общая поставка записана до появления номера отгрузки — целиком её исправить нельзя. '
  + 'Её доля расходов посчитана от всей партии, а найти остальные заявки по номеру отгрузки невозможно. '
  + 'Исправьте операцию вручную.';

const isBatchNote = (tag: string): boolean => tag.replace(/^\s+/, '').toLowerCase().startsWith('общая поставка');

/** Order labels out of the first «Общая поставка: заявки № A, № B; …» note found on the orders' rows. */
const noteLabelsOf = (orders: WholeShipmentOrder[]): string[] => {
  for (const o of orders) {
    for (const group of parseShipmentExtras(o.rows[0].destination).keptGroups) {
      for (const tag of group) {
        if (!isBatchNote(tag)) continue;
        const m = tag.match(/заявки\s+([^;]*);/);
        return m ? m[1].split(',').map((l) => l.trim().replace(/^№\s*/, '')).filter((l) => l !== '') : [];
      }
    }
  }
  return [];
};

/**
 * Twin of the server's refusal: rows written before shipment numbers that carry the «Общая поставка»
 * note. False for a set that has a shipment number.
 */
export const isOldCombinedShipment = (rows: WholeShipmentRow[]): boolean =>
  rows.length > 0 && !(rows[0].shipmentId ?? '').trim()
  && rows.some((r) => parseShipmentExtras(r.destination).keptGroups.some((g) => g.some(isBatchNote)));

/**
 * Raw order labels, twin of the label rule of `updateShipmentExtras` (Code.gs, ADR 0001):
 * all-or-nothing — labels only when the shipment has a number and EVERY order's OpID is
 * `<shipmentId>-N` with N inside the note's label list; otherwise '' for every order.
 */
export function orderLabels(orders: WholeShipmentOrder[], shipmentId: string): string[] {
  const labels = noteLabelsOf(orders);
  const indexOf = (opId: string): number => {
    if (!opId.startsWith(`${shipmentId}-`)) return -1;
    const rest = opId.slice(shipmentId.length + 1);
    const n = /^\d+$/.test(rest) ? Number(rest) : 0;
    return n >= 1 && n <= labels.length ? n - 1 : -1;
  };
  const known = shipmentId !== '' && labels.length > 0 && orders.every((o) => indexOf(o.opId) !== -1);
  return orders.map((o) => (known ? labels[indexOf(o.opId)] : ''));
}

export interface WholeShipmentExtrasInput {
  packaging: { mode: ExtrasMode; value: number };
  other: { mode: ExtrasMode; value: number };
  services: ExtrasServiceEntry[];
}

/**
 * The new extras of a whole shipment and their total, twin of the head of `updateShipmentExtras`:
 * the anchor's «Объект» parsed, packaging and «Прочее» by unit × the pieces of the WHOLE shipment
 * (or per batch), services normalised the way the server does. Used by the window and pinned
 * against the server's `newTotal` in the parity test.
 */
export function wholeShipmentNewExtras(
  transactions: WholeShipmentRow[],
  anchor: WholeShipmentRow,
  input: WholeShipmentExtrasInput
): { pieces: number; extras: ShipmentExtras; total: number } {
  const pieces = shipmentPiecesOf(wholeShipmentRows(transactions, anchor));
  const original = parseShipmentExtras(anchor.destination);
  const unitOf = (f: { mode: ExtrasMode; value: number }): number => (f.mode === 'unit' ? round2(Number(f.value) || 0) : 0);
  const extras: ShipmentExtras = {
    ...original,
    packaging: amountTotal(input.packaging.mode, round2(Number(input.packaging.value) || 0), pieces),
    packagingUnit: unitOf(input.packaging),
    other: amountTotal(input.other.mode, round2(Number(input.other.value) || 0), pieces),
    otherUnit: unitOf(input.other),
    services: input.services
      .map((e) => ({
        name: String(e.name || '').trim(),
        quantity: Math.max(0, Math.round(Number(e.quantity) || 0)),
        unitCost: round2(Number(e.unitCost) || 0)
      }))
      .filter((e) => e.name !== '' && e.quantity > 0)
  };
  return { pieces, extras, total: extrasTotal(extras) };
}

/**
 * What the window shows for an anchor row and a candidate new total: the orders with labels,
 * articles, pieces and shares — or the reason the shipment cannot be corrected as a whole
 * (twin of the server's refusals; the server decides in the end).
 */
export function wholeShipmentView(
  transactions: WholeShipmentRow[],
  anchor: WholeShipmentRow,
  newTotal: number
): WholeShipmentView {
  const rows = wholeShipmentRows(transactions, anchor);
  const hasShipmentId = !!(anchor.shipmentId ?? '').trim();
  if (isOldCombinedShipment(rows)) {
    return { kind: 'refused', reason: OLD_COMBINED_SHIPMENT_REASON };
  }
  let orders: WholeShipmentOrder[];
  try {
    orders = wholeShipmentOrders(rows);
  } catch (e) {
    if (e instanceof AmbiguousOrderError) {
      return {
        kind: 'refused',
        reason: `Не удаётся понять, к какой заявке отгрузки относится строка «${e.message}»: у неё нет номера операции. Ничего не записано.`
      };
    }
    throw e;
  }
  if (orders.length === 0) return { kind: 'refused', reason: 'Строки отгрузки не найдены.' };

  const rawLabels = orderLabels(orders, (anchor.shipmentId ?? '').trim());
  // The window's own fallback for an order whose label the note cannot give (the twin output stays raw).
  const labelOf = (index: number): string =>
    rawLabels[index] || (hasShipmentId ? `Заявка ${index + 1}` : parseShipmentExtras(orders[index].rows[0].destination).main);

  const shares = orderSharesPreview(orders, newTotal);
  const views = orders.map<WholeShipmentOrderView>((o, i) => {
    const byArticle = new Map<string, number>();
    for (const r of o.rows) {
      if (r.isComponent === true) continue;
      byArticle.set(r.article, (byArticle.get(r.article) ?? 0) + (Number(r.quantity) || 0));
    }
    return {
      opId: o.opId,
      label: labelOf(i),
      pieces: shares[i].pieces,
      articles: [...byArticle].map(([article, quantity]) => ({ article, quantity })),
      oldShare: shares[i].oldShare,
      newShare: shares[i].newShare
    };
  });
  return {
    kind: 'ok',
    orders: views,
    totalPieces: views.reduce((s, v) => s + v.pieces, 0),
    oldTotal: round2(views.reduce((s, v) => s + v.oldShare, 0)),
    newTotal: round2(views.reduce((s, v) => s + v.newShare, 0))
  };
}
