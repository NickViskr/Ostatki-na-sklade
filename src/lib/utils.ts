export const formatCurrency = (value: number | undefined): string => {
  if (value === undefined || isNaN(value)) return '0,00';
  // Округляем до двух знаков и используем локаль RU
  return value.toLocaleString('ru-RU', { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2 
  });
};

export const roundToTwo = (num: number) => Math.round((num + Number.EPSILON) * 100) / 100;

/**
 * Универсальный разбор даты из БД. Понимает форматы:
 * "DD-MM-YYYY", "DD.MM.YYYY" (с опц. ", HH:MM:SS"),
 * "YYYY-MM-DD", "YYYY-MM-DD HH:MM:SS", полный ISO с "T"/"Z".
 * Возвращает объект Date или null, если разобрать нельзя.
 */
export const parseAppDate = (raw?: string | null): Date | null => {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // 1) Полный ISO со временем: 2026-05-22T16:33:41.350Z
  if (s.includes('T')) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  // 2) День впереди: DD-MM-YYYY или DD.MM.YYYY (берём часть до запятой)
  const head = s.split(',')[0].trim();
  const dmy = head.match(/^(\d{2})[.\-](\d{2})[.\-](\d{4})$/);
  if (dmy) {
    const d = new Date(`${dmy[3]}-${dmy[2]}-${dmy[1]}T00:00:00`);
    return isNaN(d.getTime()) ? null : d;
  }

  // 3) ISO-дата без T: YYYY-MM-DD или "YYYY-MM-DD HH:MM:SS"
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s.includes(' ') ? s.replace(' ', 'T') : s);
    return isNaN(d.getTime()) ? null : d;
  }

  // 4) Запасной вариант
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

/**
 * Пункт 28, этап B. Ключ операции для защиты от двойного проведения.
 * Один ключ = одна операция, сколько бы раз её ни отправили повторно.
 */
export const newOperationId = (): string => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Переходим к запасному варианту ниже
  }
  return 'op-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
};

/**
 * Пункт 40, этап E. Порог тревоги по «долгу себестоимости».
 * Почему именно 1,5, а не что-то строже: средняя себестоимость законно расходится
 * с ценой последнего прихода, когда партии приходили по разным ценам, — это норма,
 * а не ошибка. Поэтому сигналим только на грубом расхождении. Реальные случаи,
 * ради которых сделан бейдж, дают 7,7x и 12x, так что запас до них огромный.
 */
const COST_DEBT_ALERT_FACTOR = 1.5;

/**
 * Пункт 40, этап E. Сколько капитализации «висит» сверх того, во что реально
 * мог обойтись текущий остаток.
 *
 * Откуда берётся долг: при списании брака («Списание - Брак») количество на артикуле
 * уменьшается, а капитализация — нет. Себестоимость списанных штук остаётся на артикуле
 * и тихо расползается по тому, что осталось, а при следующем приходе размазывается
 * по новой партии и становится неотслеживаемой.
 *
 * Только показ: функция ничего не пересчитывает и не сохраняет.
 */
export function calcCostDebt(
  quantity: number,
  capitalization: number,
  lastPurchasePrice: number | null | undefined
): number {
  if (!Number.isFinite(quantity) || !Number.isFinite(capitalization)) return 0;

  // Товара нет, а капитализация есть — весь остаток капитализации и есть долг.
  if (quantity <= 0) return capitalization > 0 ? capitalization : 0;

  // Без цены последнего прихода сравнивать не с чем — молчим, а не гадаем.
  if (lastPurchasePrice === null || lastPurchasePrice === undefined) return 0;
  if (!Number.isFinite(lastPurchasePrice) || lastPurchasePrice <= 0) return 0;

  return Math.max(0, capitalization - quantity * lastPurchasePrice);
}

/**
 * Пункт 40, этап E. Показывать ли бейдж «долг себестоимости».
 * Порог живёт здесь же, рядом с объяснением, чтобы не разъезжаться с расчётом долга.
 */
export function hasCostDebt(
  quantity: number,
  capitalization: number,
  lastPurchasePrice: number | null | undefined
): boolean {
  if (!Number.isFinite(quantity) || !Number.isFinite(capitalization)) return false;

  // Капитализация без товара за ней — сигналим независимо от цены прихода.
  if (quantity <= 0) return capitalization > 0;

  if (lastPurchasePrice === null || lastPurchasePrice === undefined) return false;
  if (!Number.isFinite(lastPurchasePrice) || lastPurchasePrice <= 0) return false;

  return capitalization > quantity * lastPurchasePrice * COST_DEBT_ALERT_FACTOR;
}

/**
 * A date for the user's eyes: ДД.ММ.ГГГГ. See rule 11.9 in the technical brief.
 * The database stores dates as yyyy-MM-dd, which is right for sorting and comparing but
 * must never reach the screen. Parsing goes through parseAppDate, so already-flipped and
 * full ISO strings are understood too. An unparseable value is returned untouched, so an
 * empty cell does not turn into «NaN.NaN.NaN».
 */
export const formatDateRu = (raw?: string | null): string => {
  const d = parseAppDate(raw);
  if (!d) return raw ? String(raw) : '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()}`;
};

/**
 * Пункт 47, этап 4, подэтап 3. Себестоимость поступившего товара правится не позднее
 * 30 дней с даты поступления на склад — правило владельца от 26.08.2026. Число обязано
 * совпадать с RECEIPT_EDIT_WINDOW_DAYS в Code.gs: сервер решает, экран лишь не обманывает.
 */
export const RECEIPT_EDIT_WINDOW_DAYS = 30;

/**
 * Сколько ПОЛНЫХ суток прошло с даты операции. Дата в будущем и нечитаемая дата дают ноль,
 * то есть правку не запрещают: отказывать из-за собственного непонимания даты неправильно.
 * Повторяет арифметику daysSinceTransactionDate в Code.gs — расхождение означало бы, что
 * кнопка обещает одно, а сервер делает другое.
 */
export const daysSinceReceipt = (raw?: string | null, now: Date = new Date()): number => {
  const then = parseAppDate(raw);
  if (!then) return 0;
  const diff = now.getTime() - then.getTime();
  if (diff <= 0) return 0;
  return Math.floor(diff / 86400000);
};

/**
 * Splits a stored destination into the object itself and the tail the app appends to it.
 *
 * 29.08.2026. The History filter used to compare the WHOLE stored string with the name of a
 * warehouse, and the stored string routinely carries a tail: «Услуги: …» and «Доп. расходы …»
 * are appended in square brackets when an operation is confirmed, and a batch write-off adds
 * «[Общая поставка: заявки № …]» on top of that. One and the same warehouse therefore lives in
 * the sheet under many different strings, and the filter matched only the bare ones — so the
 * owner saw some months of a warehouse and not others.
 *
 * The parsing itself is not new: the History table has always drawn the cell this way. What is
 * new is that the filter, the drop-down list and the cell now share ONE function, so a filter
 * can no longer disagree with what the row on screen shows.
 */
export function parseDestination(destination?: string | null): { main: string; tags: string[] } {
  const raw = String(destination || '');
  if (!raw.trim()) return { main: '', tags: [] };

  const bracketMatch = raw.match(/(.*?)\[(.*?)\]$/);
  const stringMatch = raw.match(/(.*?)(?:\.\s*)?(Услуги:\s*.*|Доп\. услуги:\s*.*)$/);

  if (bracketMatch) {
    return { main: bracketMatch[1].trim(), tags: bracketMatch[2].split('|').map(s => s.trim()) };
  }
  if (stringMatch) {
    return { main: stringMatch[1].trim(), tags: stringMatch[2] ? [stringMatch[2].trim()] : [] };
  }
  return { main: raw.trim(), tags: [] };
}

/** The object of an operation without the appended tail. What the History filter matches on. */
export const destinationMain = (destination?: string | null): string => parseDestination(destination).main;

/**
 * The list of objects for the History filter: every object that actually occurs in the
 * operations, plus the ones configured in the browser even when nothing has been written to
 * them yet. Sorted by the Russian alphabet, because the list is long and is read by eye.
 *
 * 29.08.2026. Before this the drop-down offered ONLY the configured list, which lives in this
 * browser's localStorage and grows by one path alone: someone typing a new object by hand in
 * «Загрузка» or «Ручной ввод» on this very machine. An object created on another device, or
 * composed by the app itself (an Ozon shipment, «Списание - Брак», a receipt from the
 * factory), never entered it — so it could not be filtered on at all.
 */
export function buildDestinationOptions(
  rows: { destination?: string | null }[],
  configured: string[] = []
): string[] {
  const seen = new Set<string>();
  for (const row of rows || []) {
    const main = destinationMain(row && row.destination);
    if (main) seen.add(main);
  }
  for (const dest of configured || []) {
    const main = destinationMain(dest);
    if (main) seen.add(main);
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b, 'ru'));
}
