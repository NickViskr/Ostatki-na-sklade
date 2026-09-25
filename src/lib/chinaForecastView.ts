/**
 * Item 82: pure mappings feeding the forecast screen, kept apart from `ChinaForecastPanel` and
 * `OzonStocksTab` so they can be unit-tested without a component render. Neither function
 * computes any money — they only decide WHICH rows go where.
 */

export interface ChinaFactoryRow {
  article: string;
  factory: { orderQty: number } | null | undefined;
}

/**
 * Item 82: «Прогноз Китай» on the warehouse screen — the signal «Заказ на фабрике» is exactly
 * `recommendations.factories`, and every row there already asks for a positive quantity; a
 * quantity of 0 (or a missing `factory`) is skipped rather than sent as a zero-piece line.
 */
export function chinaFactoryOrdersToForecastLines(rows: ChinaFactoryRow[]): { article: string; pieces: number }[] {
  return (rows || [])
    .filter((r) => r && r.factory && r.factory.orderQty > 0)
    .map((r) => ({ article: r.article, pieces: r.factory!.orderQty }));
}

export interface ChinaForecastPrefillSplit {
  /** Lines whose article has a box in the directory — go straight into the calculator. */
  known: { article: string; pieces: number }[];
  /** «артикул: N шт» for every prefilled article the directory does not know. */
  missing: string[];
}

/**
 * Item 82: the warehouse screen's prefill can name an article with no box in «Заказы в Китае» —
 * the calculator would silently answer `warning: 'нет данных о коробке'` for it, so the split
 * happens before the calculator ever sees the line, and the owner is told plainly which articles
 * were left out. A zero (or negative) piece count is dropped outright, same as the source list.
 */
export function chinaForecastPrefillSplit(
  lines: { article: string; pieces: number }[],
  boxes: Record<string, unknown>
): ChinaForecastPrefillSplit {
  const known: { article: string; pieces: number }[] = [];
  const missing: string[] = [];
  (lines || []).forEach((l) => {
    const article = String((l && l.article) || '').trim();
    const pieces = Number(l && l.pieces) || 0;
    if (!article || pieces <= 0) return;
    if (Object.prototype.hasOwnProperty.call(boxes || {}, article)) {
      known.push({ article, pieces });
    } else {
      missing.push(`${article}: ${pieces} шт`);
    }
  });
  return { known, missing };
}

/** 'yyyy-MM-dd' -> 'DD.MM.YYYY', string-only (no `Date` arithmetic, nothing to drift a day). */
export function chinaForecastDateText(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso || '');
}
