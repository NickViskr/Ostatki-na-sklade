/**
 * Item 47, stage 3: the CSV KAN expects from the «Себестоимость КАН» button.
 *
 * The shape is copied byte for byte from a live KAN export the owner supplied
 * (`products_import_2026-08-25.csv`, 167 rows): a UTF-8 BOM, CRLF line endings, «;» as the
 * separator, string fields in double quotes, numbers unquoted with four decimals and a dot,
 * and the seven columns below in this order.
 *
 * THE SKU IS A NUMBER, NOT A STRING — `2889355693`, unquoted, even though its header is
 * quoted like every other. Guessed wrong once on 26.08.2026 and corrected against the sample.
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

/** KAN's own files start with a BOM; the header must match theirs from the first byte. */
const BOM = '\uFEFF';

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

/**
 * One article, one day, one shop — one row.
 *
 * 03.09.2026, found by the owner on production: he made several separate write-offs of the
 * same article on the same day, and the file carried a row for each of them —
 * BowlGrayMini_01 three times over, at 245,61, 234,61 and 233,67. The numbers were right and
 * all three were stale but the last: the cost on Ozon is a running average, recomputed at
 * every shipment, so 233,67 is what the goods actually cost once all three had gone. The two
 * earlier rows are intermediate states of the same day.
 *
 * The LAST row of the group wins, and that is not an arithmetic mean of the three: the mean
 * (237,96 for that article) matches no state the goods were ever in. The last value already
 * IS a weighted average — every step of the chain mixes the new batch into what lies on Ozon
 * by quantity — and it is the cost the goods carry from that date onward.
 *
 * The order of the rows is the order of the journal, so the last occurrence of a group is its
 * newest computation. The collapsing happens HERE, at the file, and never in the journal: the
 * journal is the ledger the running average is built from and the «Выгружено в КАН» stamps
 * point into, and every row that fed a group still gets stamped.
 */
export const collapseKanCostRows = (rows: KanCostRow[]): KanCostRow[] => {
  const byKey = new Map<string, KanCostRow>();
  (rows || []).forEach((row) => {
    const key = [normaliseKanDate(String(row.date ?? '')), String(row.cabinet ?? ''), String(row.article ?? '')].join('|');
    byKey.set(key, row);
  });
  return Array.from(byKey.values());
};

export const buildKanCostCsv = (rows: KanCostRow[]): string => {
  const lines = [KAN_COST_CSV_HEADER];
  (rows || []).forEach((row) => {
    lines.push([
      quote(normaliseKanDate(row.date)),
      // Unquoted: KAN writes the SKU as a bare number.
      String(row.sku ?? '').trim(),
      quote(row.article),
      number4(row.cost),
      number4(0),
      quote(row.cabinet),
      quote(KAN_STATUS_MAIN)
    ].join(';'));
  });
  return BOM + lines.join('\r\n');
};

/** File name for the download: the day the file was made, so several files never collide. */
export const kanCostFileName = (today: Date): string => {
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  return `kan_cost_${y}-${m}-${d}.csv`;
};
