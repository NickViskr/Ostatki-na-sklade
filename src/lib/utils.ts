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
