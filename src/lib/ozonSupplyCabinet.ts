// ===== Пункт 59. Заявка на поставку принадлежит ОДНОМУ магазину =====
// Ключи API у кабинетов разные, и SKU одного магазина в другом не существуют, поэтому
// смешанная заявка либо отвергается Ozon, либо уезжает не от того юрлица.
// Решение владельца 27.08.2026: магазин задаёт ПЕРВАЯ галочка, дальше товары остальных
// магазинов гаснут — тем же способом, каким пункт 58 разводит кластеры.
//
// Товар описывается СПИСКОМ магазинов, а не одним: на боевых данных 27.08.2026 ни один
// артикул не продаётся в двух кабинетах сразу, но модель это допускает, и такой товар
// обязан подходить к любой из двух заявок. Поэтому магазин заявки — ПЕРЕСЕЧЕНИЕ списков
// выбранных товаров, а не магазин первой строки.

/** Непустые уникальные названия в порядке первого появления. */
function normalize(names: string[] | undefined): string[] {
  const out: string[] = [];
  for (const raw of names || []) {
    const name = String(raw ?? '').trim();
    if (name && out.indexOf(name) < 0) out.push(name);
  }
  return out;
}

/**
 * Магазины, которыми ещё может оказаться заявка: пересечение списков выбранных товаров.
 * Пустой выбор — пустой массив: заявка пока не привязана ни к одному магазину.
 */
export function possibleCabinets(selected: string[][]): string[] {
  let acc: string[] | null = null;
  for (const raw of selected || []) {
    const cabinets = normalize(raw);
    // Товар без магазина ничего не сужает: незнание — не повод привязывать заявку.
    if (cabinets.length === 0) continue;
    acc = acc === null ? cabinets : acc.filter((c) => cabinets.indexOf(c) >= 0);
  }
  return acc === null ? [] : acc;
}

/** Товар можно добавить к заявке: он продаётся в одном из ещё возможных магазинов. */
export function isCabinetCompatible(selected: string[][], articleCabinets: string[]): boolean {
  const article = normalize(articleCabinets);
  if (article.length === 0) return true;
  const possible = possibleCabinets(selected);
  if (possible.length === 0) return true;
  return possible.some((c) => article.indexOf(c) >= 0);
}

/** Почему товар недоступен. Пустая строка — доступен. Текст видит пользователь. */
export function cabinetDisabledReason(selected: string[][], articleCabinets: string[]): string {
  if (isCabinetCompatible(selected, articleCabinets)) return '';
  const possible = possibleCabinets(selected);
  return 'Заявка собирается по магазину ' + possible.join(' / ') +
    ': товары другого магазина в неё не попадают — у магазинов разные ключи Ozon';
}

/**
 * Магазин готовой заявки. Пустая строка — магазин не определён, и заявку отправлять нельзя:
 * прокси в этом случае молча взял бы первый кабинет из настроек.
 */
export function resolveSupplyCabinet(selected: string[][]): string {
  const possible = possibleCabinets(selected);
  return possible.length === 1 ? possible[0] : '';
}
