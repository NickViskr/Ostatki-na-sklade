import type { CommitOptions } from '../store/useWarehouseStore';

/** `{ comment }` for a request payload, or nothing when the comment is empty (payload stays as before). */
export const commentPayload = (comment?: string): { comment?: string } => {
  const trimmed = (comment ?? '').trim();
  return trimmed ? { comment: trimmed } : {};
};

/**
 * Commit options of ONE order of a combined Ozon write-off; every order gets the same comment
 * and the same shipment number (item 90), which later finds all orders of the shipment.
 */
export const batchOrderOptions = (
  group: { postingIds: string[]; extrasShare: number },
  comment: string,
  shipmentId: string,
): CommitOptions => ({
  postingIds: group.postingIds,
  additionalCosts: group.extrasShare,
  silent: true,
  skipShipmentsRefresh: true,
  comment,
  shipmentId,
});

/** True when a History row carries a non-blank comment (drives the 💬 marker). */
export const hasComment = (tx: { comment?: string }): boolean => !!(tx.comment ?? '').trim();

/** History search: does the comment contain the (already lower-cased) query? */
export const commentMatches = (tx: { comment?: string }, lowerQuery: string): boolean =>
  (tx.comment ?? '').toLowerCase().includes(lowerQuery);

/** Fields whose change makes a row edit more than a note: only then the row is deleted and re-committed. */
const NON_COMMENT_FIELDS = ['date', 'type', 'article', 'quantity', 'price', 'writeOffCost', 'destination', 'deliveryDate', 'total'] as const;

/**
 * True when the edited row differs from the stored one in the comment ONLY (the comment itself may
 * be unchanged too). Such a save goes through setTransactionComment and never touches money.
 */
export const isCommentOnlyEdit = (
  original: Record<string, unknown> | undefined,
  edited: Record<string, unknown>,
): boolean => {
  if (!original) return false;
  const same = (a: unknown, b: unknown) => String(a ?? '').trim() === String(b ?? '').trim();
  return NON_COMMENT_FIELDS.every((f) => same(original[f], edited[f]));
};
