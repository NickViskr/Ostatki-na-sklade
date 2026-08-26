// ===== Пункт 58, этап 4. Черновик ПРЯМОЙ поставки =====
// У кросс-докинга склад размещения выбирает Ozon, и приложению он не интересен.
// У прямой поставки продавец везёт груз сам, поэтому склад надо назвать самому:
// /v2/draft/supply/create принимает storage_warehouse_id — поле, существующее только
// для DIRECT. Склад берётся из настройки (пункт 58, этап 2), но Ozon может его не дать:
// расчёт черновика отвечает по каждому складу доступностью и причиной отказа.
// Решение владельца 26.08.2026: в этом случае предложить другой ДОСТУПНЫЙ склад кластера.
//
// Модуль без зависимостей: его импортирует и прокси (Node), и тесты.

/** Склад размещения из ответа /v2/draft/create/info. */
export interface DraftWarehouse {
  warehouseId: string;
  name: string;
  address: string;
  /** FULL_AVAILABLE | PARTIAL_AVAILABLE | NOT_AVAILABLE | UNSPECIFIED */
  state: string;
  /** NOT_AVAILABLE_RANK, NOT_AVAILABLE_MATRIX и прочее; UNSPECIFIED когда всё в порядке. */
  invalidReason: string;
  /** 1 — лучший склад по мнению Ozon. */
  rank: number;
  /** Товары, которые попадут в поставку. */
  bundleId: string;
  /** Товары, которые НЕ попадут. */
  restrictedBundleId: string;
}

/** Почему выбранный склад не подошёл. Пустая строка — подошёл. */
export type DirectWarehouseProblem = '' | 'not_offered' | 'not_available';

export interface DirectWarehouseChoice {
  chosen: DraftWarehouse | null;
  problem: DirectWarehouseProblem;
  /** Доступные склады этого кластера, лучшие первыми. */
  alternatives: DraftWarehouse[];
}

const num = (value: any): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const str = (value: any): string => String(value === null || value === undefined ? '' : value).trim();

/** Разбор warehouses[] из ответа Ozon в понятный вид. Склад без идентификатора пропускается. */
export function readDraftWarehouses(raw: any): DraftWarehouse[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: DraftWarehouse[] = [];
  for (const wh of list) {
    if (!wh) continue;
    const storage = wh.storage_warehouse || {};
    const warehouseId = str(storage.warehouse_id);
    if (!warehouseId) continue;
    const status = wh.availability_status || {};
    out.push({
      warehouseId,
      name: str(storage.name),
      address: str(storage.address),
      state: str(status.state).toUpperCase(),
      invalidReason: str(status.invalid_reason).toUpperCase(),
      rank: num(wh.total_rank),
      bundleId: str(wh.bundle_id),
      restrictedBundleId: str(wh.restricted_bundle_id)
    });
  }
  return out;
}

/**
 * Склад готов принять поставку. PARTIAL_AVAILABLE считается годным: часть товара Ozon
 * возьмёт, а что именно не возьмёт — видно из restricted_bundle_id и показывается человеку.
 * Пустое состояние тоже годно: у складов, которые Ozon предлагает без оговорок,
 * поле приходит пустым или UNSPECIFIED, и отказывать из-за молчания неправильно.
 */
export function isWarehouseAvailable(warehouse: DraftWarehouse): boolean {
  if (!warehouse) return false;
  const state = String(warehouse.state || '').toUpperCase();
  return state !== 'NOT_AVAILABLE';
}

/** Доступные склады, лучшие первыми. Ранг 0 означает «Ozon ранг не прислал» — такие в конце. */
export function availableWarehouses(warehouses: DraftWarehouse[]): DraftWarehouse[] {
  return (warehouses || [])
    .filter(isWarehouseAvailable)
    .slice()
    .sort((a, b) => {
      const ra = a.rank > 0 ? a.rank : Number.MAX_SAFE_INTEGER;
      const rb = b.rank > 0 ? b.rank : Number.MAX_SAFE_INTEGER;
      return ra - rb;
    });
}

/**
 * Выбор склада для прямой поставки: сначала тот, что назван в настройках, и только если
 * Ozon его не даёт — список доступных на замену. Сам приложение НЕ подменяет:
 * решение, куда физически ехать, остаётся за человеком.
 */
export function chooseDirectWarehouse(warehouses: DraftWarehouse[], wantedId: string): DirectWarehouseChoice {
  const list = warehouses || [];
  const wanted = str(wantedId);
  const alternatives = availableWarehouses(list);

  const found = wanted ? list.find((w) => w.warehouseId === wanted) || null : null;
  if (!found) {
    return { chosen: null, problem: 'not_offered', alternatives };
  }
  if (!isWarehouseAvailable(found)) {
    // Отсеивать сам недоступный склад из замен не нужно: availableWarehouses его уже не пустил.
    return { chosen: null, problem: 'not_available', alternatives };
  }
  return { chosen: found, problem: '', alternatives };
}

/** Текст для человека по итогу выбора. Пустая строка — склад подошёл. Текст видит пользователь. */
export function directWarehouseMessage(choice: DirectWarehouseChoice, wantedName: string): string {
  if (!choice || choice.problem === '') return '';
  const name = str(wantedName) || 'выбранный склад';
  const head = choice.problem === 'not_offered'
    ? 'Ozon не предложил склад «' + name + '» для этой поставки'
    : 'Ozon не принимает поставку на склад «' + name + '»';
  if (choice.alternatives.length === 0) {
    return head + ', и других доступных складов в этом кластере тоже нет';
  }
  const names = choice.alternatives.slice(0, 3).map((w) => w.name || w.warehouseId).join(', ');
  return head + '. Доступны: ' + names;
}
