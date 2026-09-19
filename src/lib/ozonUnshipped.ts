// ===== Item 68, stages 2 and 3: a written-off supply that left the warehouse only in part =====
//
// The owner's case of 15.09.2026: supply 2000065651020 (order 127380557-1) was written off as
// 36 pcs, one box of 18 actually reached Ozon, Ozon refused the acceptance and created a
// VIRTUAL supply 2000066659799 for the 18 that arrived, pointing back through
// «Исходная поставка». The other 18 stayed on the shelf and the books did not know.
//
// Everything here is pure: what the supply declared, what Ozon's virtual supply says arrived,
// and the difference — the screen prefills the return with it, the dashboard raises an alert
// from it. The return itself is posted by Code.gs (commitUnshippedReturn).

import type { ExternalShipment, SKUItem } from '../types';
import { resolveOzonArticle } from './ozonCoverage';

export interface UnshippedLine {
  offerId: string;
  article: string;
  declared: number;
  /** What actually left: Ozon's virtual supply when it exists, otherwise the declared quantity. */
  shipped: number;
}

export interface ShippedRecord {
  lines: Array<{ offerId: string; article: string; declared: number; shipped: number }>;
  returnTxIds: string[];
  returnedAt: string;
  by: string;
}

function parseItems(itemsJSON?: string): Array<{ offerId: string; barcode: string; quantity: number }> {
  if (!itemsJSON) return [];
  try {
    const parsed = JSON.parse(itemsJSON);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((it: any) => it && typeof it === 'object')
      .map((it: any) => ({
        offerId: String(it.offerId || it.offer_id || '').trim(),
        barcode: String(it.barcode || '').trim(),
        quantity: Number(it.quantity !== undefined && it.quantity !== null ? it.quantity : it.qty) || 0
      }));
  } catch {
    return [];
  }
}

/** The record written by the return, or null when the supply was never returned. */
export function parseShippedRecord(shippedJSON?: string): ShippedRecord | null {
  if (!shippedJSON || !String(shippedJSON).trim()) return null;
  try {
    const parsed = JSON.parse(shippedJSON);
    if (!parsed || !Array.isArray(parsed.lines)) return null;
    return {
      lines: parsed.lines,
      returnTxIds: Array.isArray(parsed.returnTxIds) ? parsed.returnTxIds.map(String) : [],
      returnedAt: String(parsed.returnedAt || ''),
      by: String(parsed.by || '')
    };
  } catch {
    return null;
  }
}

/** Quantity that reached Ozon by its own account: the virtual supplies pointing at this one, by offerId. */
export function arrivedByVirtualSupply(supply: ExternalShipment, all: ExternalShipment[]): Record<string, number> | null {
  const id = String(supply.postingId || '').trim();
  const virtual = (all || []).filter(
    s => s !== supply && s.isVirtual === true && String(s.originalSupplyId || '').trim() === id && id !== ''
  );
  if (virtual.length === 0) return null;
  const byOffer: Record<string, number> = {};
  for (const v of virtual) {
    for (const it of parseItems(v.itemsJSON)) {
      if (it.offerId) byOffer[it.offerId] = (byOffer[it.offerId] || 0) + it.quantity;
    }
  }
  return byOffer;
}

/**
 * Lines of the return form: every declared position with the quantity that actually left.
 * When Ozon has a virtual supply for this one, its quantities are the truth (a position missing
 * from it left as 0); without one the form starts at «declared» and the owner types the fact.
 */
export function buildUnshippedLines(supply: ExternalShipment, all: ExternalShipment[], skus: SKUItem[]): UnshippedLine[] {
  const arrived = arrivedByVirtualSupply(supply, all);
  const byOffer: Record<string, UnshippedLine> = {};
  for (const it of parseItems(supply.itemsJSON)) {
    if (!it.offerId || it.quantity <= 0) continue;
    if (!byOffer[it.offerId]) {
      byOffer[it.offerId] = {
        offerId: it.offerId,
        article: resolveOzonArticle(skus, it.offerId, it.barcode),
        declared: 0,
        shipped: 0
      };
    }
    byOffer[it.offerId].declared += it.quantity;
  }
  const lines = Object.values(byOffer);
  for (const line of lines) {
    line.shipped = arrived ? Math.min(line.declared, arrived[line.offerId] || 0) : line.declared;
  }
  return lines;
}

export interface ShortShipment {
  supply: ExternalShipment;
  lines: UnshippedLine[];
  declaredTotal: number;
  shippedTotal: number;
}

/**
 * Stage 3. Supplies that, by Ozon's own virtual supply, left short and were not returned yet.
 * Only a written-off (`processed`) supply qualifies: for a `new` one nothing was written off,
 * so there is nothing to return.
 */
export function findShortShipments(all: ExternalShipment[], skus: SKUItem[]): ShortShipment[] {
  const out: ShortShipment[] = [];
  for (const s of all || []) {
    if (s.isVirtual === true || s.status !== 'processed') continue;
    if (parseShippedRecord(s.shippedJSON)) continue;
    // No separate «has a virtual supply» check: without one the lines start at «declared»
    // and the totals below are equal — a mutation proved that check dead (15.09.2026).
    const lines = buildUnshippedLines(s, all, skus);
    const declaredTotal = lines.reduce((sum, l) => sum + l.declared, 0);
    const shippedTotal = lines.reduce((sum, l) => sum + l.shipped, 0);
    if (shippedTotal >= declaredTotal) continue;
    out.push({ supply: s, lines, declaredTotal, shippedTotal });
  }
  return out;
}

// ===== Item 69: «Вернуть в новые» per supply row =====
//
// The group button used to flip EVERY processed or ignored row of an order back to `new` at
// once and said nothing about which ones — on a mixed order (nine written off, one ignored) a
// second «Оформить» would double the expense. Now each row can be returned on its own, and a
// row whose unshipped return is already posted (item 68) is never returned: the return went
// into the books as a receipt, and re-posting the supply without deleting BOTH entries would
// break the stock. The group button keeps working but names its rows and skips those.

export interface ReturnToNewPlan {
  /** Rows that can go back to `new`. */
  rows: ExternalShipment[];
  /** Processed or ignored rows kept out because their return is on record. */
  blocked: ExternalShipment[];
}

export const canReturnToNew = (s: ExternalShipment): boolean =>
  (s.status === 'processed' || s.status === 'ignored') && !parseShippedRecord(s.shippedJSON);

export function returnToNewPlan(items: ExternalShipment[]): ReturnToNewPlan {
  const rows: ExternalShipment[] = [];
  const blocked: ExternalShipment[] = [];
  for (const s of items || []) {
    if (s.status !== 'processed' && s.status !== 'ignored') continue;
    if (parseShippedRecord(s.shippedJSON)) blocked.push(s);
    else rows.push(s);
  }
  return { rows, blocked };
}

const rowLabel = (s: ExternalShipment): string => `${s.storageWarehouse || 'склад не указан'} (№ ${s.postingId})`;

/** Confirmation text for one row: names it and, for a written-off row, the write-off to delete first. */
export function returnRowToNewMessage(s: ExternalShipment, orderLabel: string): string {
  const head = `Поставка ${rowLabel(s)} заявки № ${orderLabel} снова станет новой — её можно будет оформить или игнорировать заново.`;
  if (s.status === 'processed') {
    return `${head} Она была списана: сначала удалите её отгрузку из Истории, иначе при повторном оформлении получится дубль расхода.`;
  }
  return `${head} Остальные поставки заявки не изменятся.`;
}

/** Confirmation text for the group button: lists the rows and says which stay put. */
export function returnGroupToNewMessage(plan: ReturnToNewPlan, orderLabel: string): string {
  const listed = plan.rows.map(rowLabel).join(', ');
  const written = plan.rows.filter((s) => s.status === 'processed').length;
  let text = `Снова станут новыми поставки заявки № ${orderLabel}: ${listed}.`;
  if (written > 0) {
    text += ` Из них списано: ${written} — сначала удалите их отгрузки из Истории, иначе при повторном оформлении получится дубль расхода.`;
  }
  if (plan.blocked.length > 0) {
    text += ` Не вернутся (возврат неотгруженного уже проведён): ${plan.blocked.map(rowLabel).join(', ')}.`;
  }
  return text;
}
