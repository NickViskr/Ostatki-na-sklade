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

/* ---- Ozon's answer folded into the composition ---------------------------------- */

export interface OzonClusterVerdict {
  state: string;
  invalidReason: string;
  /** article -> how many pieces Ozon takes and how many it refuses */
  byArticle: Record<string, { accepted: number; rejected: number }>;
}

/**
 * Ozon answers per cluster with two lists of items — what goes into the supply and what
 * does not — and identifies items by offerId plus its own SKU. This folds that into
 * «per cluster, per article: accepted / rejected» so the answer can be printed inside the
 * row it belongs to instead of in a separate read-only block.
 *
 * `resolveArticle` is passed in rather than imported to keep this module free of the
 * SKU-matching machinery; the component hands it the same resolver the rest of the screen
 * uses. An item whose article cannot be restored is dropped: it cannot be shown on any row.
 */
export const foldOzonVerdict = (
  clusters: any[],
  resolveArticle: (offerId: string, sku: string) => string
): Record<string, OzonClusterVerdict> => {
  const map: Record<string, OzonClusterVerdict> = {};
  for (const c of clusters || []) {
    const byArticle: Record<string, { accepted: number; rejected: number }> = {};
    const put = (it: any, field: 'accepted' | 'rejected') => {
      const article = resolveArticle(String((it && it.offerId) || ''), String((it && it.sku) || ''));
      if (!article) return;
      if (!byArticle[article]) byArticle[article] = { accepted: 0, rejected: 0 };
      byArticle[article][field] += Number(it && it.quantity) || 0;
    };
    for (const it of ((c && c.accepted) || [])) put(it, 'accepted');
    for (const it of ((c && c.rejected) || [])) put(it, 'rejected');
    map[String(c && c.clusterId)] = {
      state: String((c && c.state) || ''),
      invalidReason: String((c && c.invalidReason) || ''),
      byArticle
    };
  }
  return map;
};

/** How many pieces Ozon takes from a line, and how many it leaves behind. */
export const acceptedForLine = (
  folded: Record<string, OzonClusterVerdict>,
  line: SupplyLine & { qty: number }
): { accepted: number; notAccepted: number } => {
  const cluster = folded[line.clusterId];
  const seen = cluster ? cluster.byArticle[line.article] : undefined;
  const accepted = seen ? seen.accepted : 0;
  return { accepted, notAccepted: Math.max(0, (Number(line.qty) || 0) - accepted) };
};

export interface OzonCorrection {
  /** row key -> quantity Ozon agreed to take, for the lines that stay */
  quantities: Record<string, number>;
  /** row keys to drop from the supply: Ozon takes none of them */
  removedKeys: string[];
  /** clusters that lose every line and therefore leave the supply altogether */
  removedClusterIds: string[];
}

/**
 * «Скорректировать поставку»: every line that survives gets the quantity Ozon agreed to
 * take, and every line Ozon takes nothing of LEAVES the supply — a zero line is not a
 * supply line, it is a line that should not be there. When a cluster loses all of its
 * lines it leaves too: shipping nothing to a warehouse is not a shipment.
 *
 * A line in a cluster Ozon never answered about counts as fully refused, not as silently
 * accepted — the safe direction when the answer is missing.
 */
export const applyOzonCorrection = (
  folded: Record<string, OzonClusterVerdict>,
  lines: Array<SupplyLine & { qty: number }>
): OzonCorrection => {
  const quantities: Record<string, number> = {};
  const removedKeys: string[] = [];
  const keptByCluster: Record<string, number> = {};
  const seenClusters: string[] = [];

  for (const line of lines) {
    if (seenClusters.indexOf(line.clusterId) < 0) seenClusters.push(line.clusterId);
    const key = supplyLineKey(line);
    const accepted = acceptedForLine(folded, line).accepted;
    if (accepted > 0) {
      quantities[key] = accepted;
      keptByCluster[line.clusterId] = (keptByCluster[line.clusterId] || 0) + 1;
    } else {
      removedKeys.push(key);
    }
  }

  return {
    quantities,
    removedKeys,
    removedClusterIds: seenClusters.filter((id) => !keptByCluster[id])
  };
};
