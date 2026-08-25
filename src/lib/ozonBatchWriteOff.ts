/**
 * Multi-supply write-off: several Ozon orders shipped as one physical batch.
 *
 * The owner's rule (25.08.2026): contractors pack and haul several Ozon orders as a single
 * supply, so packaging, other costs and services are paid once for the whole batch and must
 * be spread over the COMBINED article list — not counted separately per order.
 *
 * The History still keeps one expense record per order (owner's choice), which forces the
 * split done here: the batch total is cut into per-order shares by piece count, and each
 * order is committed with its own share. Because a share is proportional to the pieces of
 * that order, the cost carried by one piece is the same in every order of the batch — the
 * outcome matches a single combined write-off.
 *
 * Everything is divided BY PIECE COUNT, never by line value (owner's decision, 25.08.2026):
 * that is what the server already does when it spreads costs over an expense, and the two
 * must not disagree.
 */

export interface BatchWriteOffItem {
  article: string;
  quantity: number;
  /** Unit cost before any additional costs are added. */
  price: number;
  status: 'ok' | 'unknown' | 'error' | string;
  errorMsg?: string;
}

export interface BatchWriteOffGroup {
  /** Id of the Ozon order group, as built by buildOzonGroups. */
  groupId: string;
  /** Order number shown to the user. */
  label: string;
  /** Postings of this order that the expense will be linked to. */
  postingIds: string[];
  items: BatchWriteOffItem[];
}

export interface BatchWriteOffGroupPlan extends BatchWriteOffGroup {
  /** Pieces of this order, all articles together. */
  quantity: number;
  /** Roubles of the batch total that this order carries. */
  extrasShare: number;
}

export interface BatchWriteOffPlan {
  /** Combined article list of the whole batch; equal articles are summed. */
  mergedItems: BatchWriteOffItem[];
  /** Pieces of the whole batch. */
  totalQuantity: number;
  /** Additional costs of the whole batch, as entered by the user. */
  extrasTotal: number;
  /** Additional costs carried by one piece, the same for every article of the batch. */
  extrasPerUnit: number;
  groups: BatchWriteOffGroupPlan[];
}

const toKopecks = (rub: number): number => Math.round((Number(rub) || 0) * 100);
const toRoubles = (kop: number): number => Math.round(kop) / 100;

/** Items are merged per article, but a problem item never merges into a healthy one. */
const mergeKey = (item: BatchWriteOffItem): string => `${item.article}|${item.status}`;

/**
 * Folds the orders into the single article list the costs are divided over.
 * Order of appearance is preserved so the screen does not reshuffle rows between renders.
 */
export const mergeBatchItems = (groups: BatchWriteOffGroup[]): BatchWriteOffItem[] => {
  const merged = new Map<string, BatchWriteOffItem>();
  for (const group of groups) {
    for (const item of group.items) {
      const key = mergeKey(item);
      const existing = merged.get(key);
      if (existing) {
        existing.quantity += Number(item.quantity) || 0;
      } else {
        merged.set(key, { ...item, quantity: Number(item.quantity) || 0 });
      }
    }
  }
  return Array.from(merged.values());
};

export const countPieces = (items: BatchWriteOffItem[]): number =>
  items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);

/**
 * Cuts a sum of money into shares proportional to piece counts.
 *
 * Works in kopecks and hands the rounding leftovers to the largest remainders, so the shares
 * add up to the original sum EXACTLY. Without that, money would quietly evaporate or appear
 * out of nowhere in the books whenever the division was not clean.
 *
 * Ties go to the earlier order — the result must not depend on sort stability.
 */
export const splitByQuantity = (total: number, quantities: number[]): number[] => {
  const totalKop = toKopecks(total);
  const qtys = quantities.map((q) => Math.max(0, Number(q) || 0));
  const totalQty = qtys.reduce((sum, q) => sum + q, 0);
  if (totalQty === 0 || totalKop === 0) return qtys.map(() => 0);

  const exact = qtys.map((q) => (totalKop * q) / totalQty);
  const base = exact.map((v) => Math.floor(v));
  let leftover = totalKop - base.reduce((sum, v) => sum + v, 0);

  const order = exact
    .map((v, index) => ({ index, remainder: v - Math.floor(v) }))
    .sort((a, b) => (b.remainder - a.remainder) || (a.index - b.index));

  const result = base.slice();
  for (let i = 0; leftover > 0 && i < order.length; i += 1) {
    result[order[i].index] += 1;
    leftover -= 1;
  }
  return result.map(toRoubles);
};

/**
 * Additional costs carried by one piece. Used for the preview only: the amount actually
 * written to the books is recomputed by the server from the share of each order.
 */
export const extrasPerUnit = (total: number, totalQuantity: number): number => {
  const qty = Math.max(0, Number(totalQuantity) || 0);
  if (qty === 0) return 0;
  return (Number(total) || 0) / qty;
};

/**
 * The whole plan of a multi-supply write-off: what the user sees (the combined list) and
 * what is committed (one expense per order, each with its own share of the costs).
 */
export const buildBatchWriteOffPlan = (
  groups: BatchWriteOffGroup[],
  extrasTotal: number
): BatchWriteOffPlan => {
  const mergedItems = mergeBatchItems(groups);
  const totalQuantity = countPieces(mergedItems);
  const perGroupItems = groups.map((group) => mergeBatchItems([group]));
  const quantities = perGroupItems.map(countPieces);
  const shares = splitByQuantity(extrasTotal, quantities);

  return {
    mergedItems,
    totalQuantity,
    extrasTotal: Number(extrasTotal) || 0,
    extrasPerUnit: extrasPerUnit(extrasTotal, totalQuantity),
    groups: groups.map((group, index) => ({
      ...group,
      items: perGroupItems[index],
      quantity: quantities[index],
      extrasShare: shares[index],
    })),
  };
};
