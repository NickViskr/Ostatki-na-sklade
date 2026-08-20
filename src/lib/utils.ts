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
