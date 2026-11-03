/**
 * Item 97 ticket 05: the weekly contractor invoice read by AI.
 *
 * All values are TEXT exactly as printed — the AI copies cells and never computes. The money
 * checks live here, in integer kopecks (digits are parsed as strings, no float result).
 */

export interface ContractorInvoiceHeader {
  number: string;
  /** dd.MM.yyyy */
  date: string;
  supplier: string;
  buyer: string;
  total: string;
  vat: string;
  /** «Всего наименований N»; '' when the template has no such row. */
  itemCount: string;
}

export interface ContractorInvoiceLine {
  name: string;
  qty: string;
  unit: string;
  price: string;
  sum: string;
  /** false = the line's service does not go to supplies; undefined counts as true. */
  toSupply?: boolean;
  /** «упаковка/стикеровка» mark (item 97 ticket 06); undefined = decided by the name. */
  packaging?: boolean;
}

export interface ContractorInvoiceDraft {
  header: ContractorInvoiceHeader;
  lines: ContractorInvoiceLine[];
}

export interface ContractorInvoiceCheck {
  ok: boolean;
  headerErrors: string[];
  lineErrors: { index: number; message: string }[];
  notes: string[];
}

const toStr = (v: unknown): string => (v === undefined || v === null ? '' : String(v).trim());

const pad2 = (n: number) => String(n).padStart(2, '0');

const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
];

/** 'yyyy-MM-dd', 'd.M.yyyy' or '12 октября 2026 г.' -> 'dd.MM.yyyy'; anything else is kept as is. */
function toDdMmYyyy(value: unknown): string {
  const s = toStr(value);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return `${iso[3]}.${iso[2]}.${iso[1]}`;
  const dotted = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  if (dotted) return `${pad2(Number(dotted[1]))}.${pad2(Number(dotted[2]))}.${dotted[3]}`;
  const words = /^(\d{1,2})\s+([а-яё]+)\s+(\d{4})(?:\s*г\.?)?$/i.exec(s);
  const month = words ? MONTHS.indexOf(words[2].toLowerCase()) : -1;
  if (words && month >= 0) return `${pad2(Number(words[1]))}.${pad2(month + 1)}.${words[3]}`;
  return s;
}

/** AI JSON -> draft of trimmed text fields; null when it is not an object or `lines` is not an array. */
export function contractorInvoiceNormalise(raw: unknown): ContractorInvoiceDraft | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.lines)) return null;
  const h = (r.header && typeof r.header === 'object' ? r.header : {}) as Record<string, unknown>;
  return {
    header: {
      number: toStr(h.number),
      date: toDdMmYyyy(h.date),
      supplier: toStr(h.supplier),
      buyer: toStr(h.buyer),
      total: toStr(h.total),
      vat: toStr(h.vat),
      itemCount: toStr(h.itemCount)
    },
    lines: r.lines.map((item) => {
      const l = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      return { name: toStr(l.name), qty: toStr(l.qty), unit: toStr(l.unit), price: toStr(l.price), sum: toStr(l.sum) };
    })
  };
}

/** Text without spaces (incl. NBSP, thin spaces) and without a trailing currency mark. */
const compactNumber = (text: string): string =>
  text.replace(/[\s   ]/g, '').replace(/(₽|руб\.?|р\.)$/i, '');

/** '9 022,74' / '9022.74' / '1 299' -> integer kopecks; null for >2 decimals, letters, empty, negative. */
export function parseKopecks(text: string): number | null {
  const m = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(compactNumber(text));
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0');
}

/** Quantity in thousandths (up to 3 decimals), strictly positive; null otherwise. */
export function parseQtyMilli(text: string): number | null {
  const m = /^(\d+)(?:[.,](\d{1,3}))?$/.exec(compactNumber(text));
  if (!m) return null;
  const milli = Number(m[1]) * 1000 + Number((m[2] ?? '').padEnd(3, '0') || '0');
  return milli > 0 ? milli : null;
}

/** Kopecks -> '9 022,74' style text without grouping: '9022,74'. */
export const formatKopecks = (kop: number): string =>
  `${Math.floor(kop / 100)},${pad2(kop % 100)}`;

/** Kopecks of the lines that go to supplies; null when such a line's sum is unreadable, 0 when none is ticked. */
export function supplyTotalKopecks(draft: ContractorInvoiceDraft): number | null {
  let total = 0;
  for (const l of draft.lines) {
    if (l.toSupply === false) continue;
    const kop = parseKopecks(l.sum);
    if (kop === null) return null;
    total += kop;
  }
  return total;
}

function isRealDate(ddMMyyyy: string): boolean {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(ddMMyyyy);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  return d.getUTCDate() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1;
}

/** The same checks run on the screen and (as a twin) in Code.gs before anything is saved. */
export function checkContractorInvoice(draft: ContractorInvoiceDraft): ContractorInvoiceCheck {
  const { header, lines } = draft;
  const headerErrors: string[] = [];
  const lineErrors: { index: number; message: string }[] = [];
  const notes: string[] = [];

  if (!header.number.trim()) headerErrors.push('Не указан номер счёта');
  if (!isRealDate(header.date.trim())) headerErrors.push('Дата счёта должна быть настоящей датой в виде дд.мм.гггг');
  if (!header.supplier.trim()) headerErrors.push('Не указан поставщик');
  const totalKop = parseKopecks(header.total);
  if (totalKop === null) headerErrors.push('Не удалось прочитать сумму «Всего к оплате»');
  if (lines.length === 0) headerErrors.push('В счёте нет ни одной строки');

  let linesSumKop = 0;
  let allLinesReadable = true;
  lines.forEach((l, index) => {
    const n = index + 1;
    const qtyMilli = parseQtyMilli(l.qty);
    const priceKop = parseKopecks(l.price);
    const sumKop = parseKopecks(l.sum);
    if (!l.name.trim()) lineErrors.push({ index, message: `Строка ${n}: нет наименования` });
    if (qtyMilli === null) lineErrors.push({ index, message: `Строка ${n}: не удалось прочитать количество «${l.qty}»` });
    if (priceKop === null) lineErrors.push({ index, message: `Строка ${n}: не удалось прочитать цену «${l.price}»` });
    if (sumKop === null) lineErrors.push({ index, message: `Строка ${n}: не удалось прочитать сумму «${l.sum}»` });
    if (sumKop === null) { allLinesReadable = false; return; }
    linesSumKop += sumKop;
    if (qtyMilli === null || priceKop === null) return;
    // The printed sum is the product rounded half-up to the kopeck (integers only).
    const expectedKop = Math.floor((qtyMilli * priceKop + 500) / 1000);
    if (sumKop !== expectedKop) {
      lineErrors.push({
        index,
        message: `Строка ${n}: ${l.qty} × ${formatKopecks(priceKop)} = ${formatKopecks(expectedKop)}, а в счёте ${formatKopecks(sumKop)}`
      });
    }
  });

  if (totalKop !== null && allLinesReadable && lines.length > 0 && linesSumKop !== totalKop) {
    headerErrors.push(
      `Сумма строк ${formatKopecks(linesSumKop)} не равна «Всего к оплате» ${formatKopecks(totalKop)}`
    );
  }

  if (header.itemCount.trim() === '') {
    notes.push('В счёте нет строки «Всего наименований» — проверка числа строк пропущена');
  } else if (Number(header.itemCount) !== lines.length || !/^\d+$/.test(header.itemCount.trim())) {
    headerErrors.push(`В счёте указано наименований: ${header.itemCount}, а строк: ${lines.length}`);
  }

  return { ok: headerErrors.length === 0 && lineErrors.length === 0, headerErrors, lineErrors, notes };
}

/** Duplicate key: supplier (lower case, quotes dropped, spaces collapsed) + number + date. */
export function contractorInvoiceKey(header: ContractorInvoiceHeader): string {
  const supplier = header.supplier.toLowerCase().replace(/[«»"']/g, '').replace(/\s+/g, ' ').trim();
  return `${supplier}|${header.number.trim()}|${header.date.trim()}`;
}

/** The Gemini prompt: copy cells, never compute. */
export function contractorInvoicePrompt(): string {
  return [
    'Ты читаешь PDF-счёт подрядчика на оплату. Твоя задача — только ПЕРЕПИСАТЬ ячейки так, как они напечатаны.',
    'Правила:',
    '- Копируй шапку и каждую ячейку строк дословно, как напечатано (числа с пробелами и запятыми — тоже как есть).',
    '- Ничего не считай, ничего не суммируй, ничего не исправляй.',
    '- Если значения в счёте нет — верни пустую строку "", ничего не придумывай и не подставляй.',
    '- itemCount заполняй только числом из строки «Всего наименований N»; если такой строки нет — "".',
    'Верни только JSON такой формы:',
    '{"header":{"number":"","date":"","supplier":"","buyer":"","total":"","vat":"","itemCount":""},',
    '"lines":[{"name":"","qty":"","unit":"","price":"","sum":""}]}',
    'number — номер счёта, date — дата счёта, supplier — поставщик, buyer — покупатель,',
    'total — «Всего к оплате», vat — строка про НДС, lines — все строки таблицы по порядку.'
  ].join('\n');
}
