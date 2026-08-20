/**
 * Item 45. The ceiling for one line of a supply.
 *
 * The owner's rule (20.08.2026): a line may not ask for more than is actually free to ship,
 * and the screen must say how much that is. «Free» is stock on «Мой склад» minus the reserve
 * held by supplies already created — the warehouse can physically hold more.
 *
 * One article can sit in several clusters of the same supply, so the ceiling for a line is
 * the free stock LESS what the other lines of the same article already take. The
 * recommendation itself is distributed within free stock, so this only ever catches a
 * hand-made increase or a hand-added line.
 */

export interface SupplyLine {
  article: string;
  clusterId: string;
}

export const supplyLineKey = (line: SupplyLine): string => `${line.article}|||${line.clusterId}`;

/**
 * @param freeByArticle  free-to-ship pieces per article
 * @param lines          every ACTIVE line of the supply, with its current quantity
 * @param article        the article being sized
 * @param exceptKey      key of the line being edited; pass '' when adding a new line
 * @returns pieces still available for this line, or Infinity when the article has no stock
 *          figure at all — an unknown limit must not silently become a limit of zero.
 */
export const capForSupplyLine = (
  freeByArticle: Record<string, number>,
  lines: Array<SupplyLine & { qty: number }>,
  article: string,
  exceptKey: string
): number => {
  if (!Object.prototype.hasOwnProperty.call(freeByArticle, article)) return Number.POSITIVE_INFINITY;
  const free = Math.max(0, Number(freeByArticle[article]) || 0);
  const taken = lines
    .filter((l) => l.article === article && supplyLineKey(l) !== exceptKey)
    .reduce((sum, l) => sum + (Number(l.qty) || 0), 0);
  return Math.max(0, free - taken);
};
