// «Склад» → «Скачать CSV»: the list of what can be shipped right now.
// Only the article and its free quantity — the quantity on the shelf minus the pieces already
// reserved by the supply orders created in Ozon (the same figure the «Свободно» column shows).
// Articles with nothing free are left out: the report is a picking list, not a stock sheet.

export interface FreeStockRow {
  article: string;
  quantity: number;
}

export function buildFreeStockRows(
  rows: FreeStockRow[],
  reservedByArticle: Record<string, number>
): { article: string; free: number }[] {
  const out: { article: string; free: number }[] = [];
  for (const r of rows) {
    const reserved = Number(reservedByArticle[r.article]) || 0;
    const free = Math.max(0, (Number(r.quantity) || 0) - reserved);
    if (free > 0) out.push({ article: r.article, free });
  }
  return out;
}

export function buildFreeStockCsv(rows: FreeStockRow[], reservedByArticle: Record<string, number>): string {
  const lines = ['Артикул;Свободно'];
  for (const r of buildFreeStockRows(rows, reservedByArticle)) {
    lines.push(`${r.article};${r.free}`);
  }
  return lines.join('\n');
}
