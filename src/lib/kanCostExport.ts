/**
 * Item 47, stage 3: the CSV KAN expects from the «Себестоимость КАН» button.
 *
 * The shape is copied from a live KAN export the owner supplied
 * (`products_import_2026-08-25.csv`): «;» as the separator, string fields in double quotes,
 * numbers unquoted with four decimals and a dot, and the seven columns below in this order.
 *
 * The owner's rules, settled 26.08.2026:
 *  - EVERY change goes to KAN, one row per shipment, not just the latest cost per article.
 *    The cost of a product on Ozon is recomputed at every new supply, so every recomputation
 *    is a fact KAN has to know about, with the date of the shipment that produced it.
 *  - «Доп. расходы за единицу товара» is ALWAYS 0: the owner already folds packaging and
 *    contractor services into the cost itself, so charging them again here would double them.
 *  - «Статус» is always MAIN.
 */

export interface KanCostRow {
  /** Date of the shipment that produced this cost, ГГГГ-ММ-ДД. */
  date: string;
  /** Numeric Ozon SKU. May be empty — an empty SKU must not break the export. */
  sku: string;
  article: string;
  /** «Себестоимость после» from the journal: the full cost, extras included. */
  cost: number;
  /** Ozon cabinet name — MaxiStore or Mercurius. */
  cabinet: string;
}

export const KAN_COST_CSV_HEADER =
  '"Дата";"SKU";"Артикул";"Себестоимость за единицу товара";"Доп. расходы за единицу товара";"Магазин";"Статус"';

/** KAN's own value for the last column; the owner never ships anything else. */
const KAN_STATUS_MAIN = 'MAIN';

const quote = (value: unknown): string =>
  `"${String(value ?? '').replace(/"/g, '""')}"`;

const number4 = (value: unknown): string => {
  const n = Number(value);
  return (Number.isFinite(n) ? n : 0).toFixed(4);
};

/**
 * Dates reach us as ГГГГ-ММ-ДД from Code.gs, but a row typed into the sheet by hand can
 * carry the Russian ДД.ММ.ГГГГ. Both are accepted; anything else is passed through untouched
 * rather than guessed at, so a strange value is visible in the file instead of silently wrong.
 */
export const normaliseKanDate = (value: string): string => {
  const raw = String(value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const ru = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (ru) return `${ru[3]}-${ru[2]}-${ru[1]}`;
  return raw;
};

export const buildKanCostCsv = (rows: KanCostRow[]): string => {
  const lines = [KAN_COST_CSV_HEADER];
  (rows || []).forEach((row) => {
    lines.push([
      quote(normaliseKanDate(row.date)),
      quote(row.sku),
      quote(row.article),
      number4(row.cost),
      number4(0),
      quote(row.cabinet),
      quote(KAN_STATUS_MAIN)
    ].join(';'));
  });
  return lines.join('\n');
};

/** File name for the download: the day the file was made, so several files never collide. */
export const kanCostFileName = (today: Date): string => {
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  return `kan_cost_${y}-${m}-${d}.csv`;
};
