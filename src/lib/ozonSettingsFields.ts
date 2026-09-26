/**
 * Item 87 step 2. Pure data + helpers for the «Настройки Ozon» window: who may open it, the
 * collapsible block layout, the numeric field table (label/hint/help), the recommended values
 * and the save-payload conversion. No React here on purpose — OzonSettingsModal.tsx renders
 * this table, and this file is the source of truth the tests scan against.
 */

/** Same rule as Code.gs `isAdminRole`: role only, username is ignored. */
export function canEditOzonSettings(user: { role?: unknown; username?: unknown } | null | undefined): boolean {
  const role = String(user?.role ?? '').trim().toLowerCase();
  return role === 'admin' || role === 'администратор';
}

export interface OzonSettingsBlock {
  id: string;
  title: string;
}

export const OZON_SETTINGS_BLOCKS: OzonSettingsBlock[] = [
  { id: 'speed', title: 'Скорость продаж' },
  { id: 'supply', title: 'Поставки на Ozon' },
  { id: 'factory', title: 'Заказ на фабрике' },
  { id: 'clusters', title: 'Кластеры' },
  { id: 'turnover', title: 'Оборачиваемость' },
  { id: 'dropoff', title: 'Точка отгрузки и документы' },
  { id: 'advanced', title: 'Дополнительно' },
];

/** Numeric settings shown as plain number inputs, grouped into the blocks above. */
export interface OzonSettingsFormNumeric {
  speedWeeks: number;
  trendWeeks: number;
  demandGrowthPct: number;
  salesGrowthPct: number;
  minStockDays: number;
  targetStockDays: number;
  deliveryToOzonDays: number;
  maxClusterDays: number;
  maxBoxesPerCluster: number;
  returnsToSalePct: number;
  factoryOrderDays: number;
  turnoverPeriodDays: number;
  turnoverSlowDays: number;
  turnoverFastDays: number;
  gmroiGreenPct: number;
  gmroiRedPct: number;
  salesRetentionWeeks: number;
}

/** Non-numeric settings (custom cluster/drop-off UI), unchanged by this step. */
export interface OzonSettingsFormText {
  excludedClusters: string;
  priorityClusters: string;
  dropOffWarehouseId: string;
  dropOffWarehouseName: string;
  dropOffWarehouseType: string;
  /** Item 58. JSON-строка правил прямой поставки, как она лежит в листе настроек. */
  directClusters: string;
}

export type OzonSettingsForm = OzonSettingsFormNumeric & OzonSettingsFormText;

export interface OzonSettingsFieldDef {
  key: keyof OzonSettingsFormNumeric;
  block: string;
  label: string;
  /** The one grey line under the input. */
  hint: string;
  /** The «?» tooltip text. */
  help: string;
  integer?: boolean;
  min?: number;
  max?: number;
  step: string;
}

export const OZON_SETTINGS_FIELDS: OzonSettingsFieldDef[] = [
  // Скорость продаж
  {
    key: 'speedWeeks',
    block: 'speed',
    label: 'Окно скорости, недель',
    hint: 'больше — скорость ровнее, но позже замечает перемены; меньше — быстрее реагирует, но сильнее скачет',
    help: 'Сколько последних ПОЛНЫХ недель продаж берётся для расчёта скорости. Текущая незавершённая неделя добавляется к ним своей фактической длиной.',
    integer: true,
    min: 1,
    step: '1',
  },
  {
    key: 'trendWeeks',
    block: 'speed',
    label: 'Окно тренда и долей кластеров, недель',
    hint: 'больше — тренд и доли кластеров устойчивее; меньше — быстрее следуют за последними неделями',
    help: 'Сколько последних полных недель просматривается для тренда продаж и для долей кластеров при распределении поставки. Окно ограничено историей, которую приложение загрузило с сервера.',
    integer: true,
    min: 1,
    step: '1',
  },
  {
    key: 'demandGrowthPct',
    block: 'speed',
    label: 'Порог резкого роста спроса за 7 дней, %',
    hint: 'больше — «Спрос вырос» срабатывает реже; меньше — чаще; 0 — выключено',
    help: 'Продажи за последние 7 дней сравниваются со скоростью окна. Если рост больше этого процента и за 7 дней продано не меньше 10 шт, на «Складе» появляется предупреждение «Спрос вырос», а рекомендации по товару на время считаются по ускоренной скорости.',
    min: 0,
    step: 'any',
  },
  {
    key: 'salesGrowthPct',
    block: 'speed',
    label: 'Ручная надбавка к заказу на фабрике, %',
    hint: 'больше — заказ на фабрике крупнее; 0 — без надбавки',
    help: 'Ручная надбавка к прогнозной скорости в контуре заказа на фабрике: прогноз = скорость × тренд × (1 + этот %). На рекомендации поставок в кластеры Ozon не влияет.',
    min: 0,
    step: 'any',
  },
  // Поставки на Ozon
  {
    key: 'minStockDays',
    block: 'supply',
    label: 'Неснижаемый запас в кластере, дней',
    hint: 'больше — поставка предлагается раньше; меньше — позже, выше риск пустого кластера',
    help: 'Страховой запас в днях продаж, который всегда должен оставаться в кластере на складах Ozon.',
    min: 0,
    step: 'any',
  },
  {
    key: 'targetStockDays',
    block: 'supply',
    label: 'Целевой запас в кластере, дней',
    hint: 'больше — поставки крупнее и реже; меньше — мельче и чаще',
    help: 'На сколько дней продаж пополняется запас при поставке. Неснижаемый запас входит ВНУТРЬ этого срока, поэтому значение обязано быть больше него.',
    min: 0,
    step: 'any',
  },
  {
    key: 'deliveryToOzonDays',
    block: 'supply',
    label: 'Срок доставки до Ozon, дней',
    hint: 'больше — поставка и заказ на фабрике крупнее и раньше; меньше — наоборот',
    help: 'Сколько дней поставка едет от вашего склада до складов Ozon — всё это время кластер продолжает продавать. Планируется поверх целевого запаса и поверх порога заказа на фабрике.',
    min: 0,
    step: 'any',
  },
  {
    key: 'maxClusterDays',
    block: 'supply',
    label: 'Потолок запаса в кластере после поставки, дней',
    hint: 'больше — в кластер можно везти больше; меньше — меньше лишнего запаса; 0 — без потолка',
    help: 'Защита от заваливания медленных кластеров. Проверяется ПОСЛЕ прихода поставки: если расчётный запас кластера превысит это число дней, кластер из рекомендации исключается целиком.',
    min: 0,
    step: 'any',
  },
  {
    key: 'maxBoxesPerCluster',
    block: 'supply',
    label: 'Не больше коробок на кластер в одной заявке',
    hint: 'больше — реже предупреждение о лишних коробках; меньше — чаще',
    help: 'Тарифный лимит Ozon на бесплатную отгрузку в один кластер. Если коробок больше, остаток лучше оформить отдельной заявкой.',
    integer: true,
    min: 1,
    step: '1',
  },
  {
    key: 'returnsToSalePct',
    block: 'supply',
    label: 'Возвраты, которые снова идут в продажу, %',
    hint: 'больше — возвраты сильнее уменьшают поставку; меньше — слабее',
    help: 'Какая доля возвратов реально возвращается в продажу. Возвраты входят в расчётный остаток кластера с этим коэффициентом.',
    min: 0,
    max: 100,
    step: 'any',
  },
  // Заказ на фабрике
  {
    key: 'factoryOrderDays',
    block: 'factory',
    label: 'Заказ на фабрике — на сколько дней продаж',
    hint: 'больше — заказ крупнее и реже, больше денег в товаре; меньше — мельче и чаще',
    help: 'Размер одного заказа на фабрике в днях продаж: рекомендуемый объём = скорость продаж × это число дней.',
    min: 0,
    step: 'any',
  },
  // Оборачиваемость
  {
    key: 'turnoverPeriodDays',
    block: 'turnover',
    label: 'Период расчёта, дней',
    hint: 'больше — показатели ровнее; меньше — ближе к последним неделям',
    help: 'Вкладка «Оборачиваемость»: за сколько последних дней считаются себестоимость продаж, валовая прибыль и средний капитал (склад + Ozon).',
    integer: true,
    min: 1,
    step: '1',
  },
  {
    key: 'turnoverSlowDays',
    block: 'turnover',
    label: 'Медленный: оборот дольше, дней',
    hint: 'больше — меньше товаров помечено медленными; меньше — больше',
    help: 'Товар считается медленным (красный), если один оборот капитала занимает дольше этого числа дней или продаж за период нет вовсе.',
    min: 0,
    step: '1',
  },
  {
    key: 'turnoverFastDays',
    block: 'turnover',
    label: 'Лидер: оборот быстрее, дней',
    hint: 'больше — больше товаров в лидерах; меньше — меньше',
    help: 'Товар считается лидером (зелёный), если один оборот капитала занимает меньше этого числа дней.',
    min: 0,
    step: '1',
  },
  {
    key: 'gmroiGreenPct',
    block: 'turnover',
    label: 'GMROI (доходность вложений): зелёный от, %',
    hint: 'больше — зелёных товаров меньше; меньше — больше',
    help: 'Вкладка «Оборачиваемость»: GMROI (валовая прибыль ÷ средний капитал) от этого значения и выше подсвечивается зелёным.',
    step: '1',
  },
  {
    key: 'gmroiRedPct',
    block: 'turnover',
    label: 'GMROI (доходность вложений): красный ниже, %',
    hint: 'больше — красных товаров больше; меньше — меньше',
    help: 'GMROI ниже этого значения подсвечивается красным; между красным и зелёным порогом — жёлтый.',
    step: '1',
  },
  // Дополнительно
  {
    key: 'salesRetentionWeeks',
    block: 'advanced',
    label: 'Хранить историю продаж, недель',
    hint: 'больше — длиннее история для сезонности; меньше — таблица легче; не меньше 27',
    help: 'Сколько недель истории продаж хранится в листе «Продажи Ozon». Строки старше удаляются автоматически при синхронизации.',
    integer: true,
    min: 1,
    step: '1',
  },
];

/** Hint lines for the non-numeric fields, which keep their current custom UI. */
export const OZON_SETTINGS_TEXT_HINTS = {
  priorityClusters: 'больше коэффициент — кластер получает больше товара',
  excludedClusters: 'отмеченные кластеры не получают поставок',
  dropOff: 'сюда вы привозите коробки, дальше Ozon развозит сам',
  direct: 'сюда везёте сами, такая заявка едет одна',
} as const;

/** Speed block static line — the poll schedule is set in Настройки системы, not here. */
export const OZON_SETTINGS_AUTO_POLL_LINE = 'Автоопрос: 11:00 и 20:00 МСК — настраивается в Настройках системы';

/**
 * Approved by the owner 2026-09-26. Covers exactly the numeric window fields — nothing about
 * clusters, drop-off or direct supply.
 */
export const OZON_RECOMMENDED_SETTINGS: OzonSettingsFormNumeric = {
  speedWeeks: 2,
  trendWeeks: 8,
  demandGrowthPct: 30,
  salesGrowthPct: 0,
  minStockDays: 10,
  targetStockDays: 20,
  deliveryToOzonDays: 7,
  maxClusterDays: 60,
  maxBoxesPerCluster: 30,
  returnsToSalePct: 95,
  factoryOrderDays: 30,
  turnoverPeriodDays: 90,
  turnoverSlowDays: 60,
  turnoverFastDays: 20,
  gmroiGreenPct: 80,
  gmroiRedPct: 30,
  salesRetentionWeeks: 78,
};

/** Fills the numeric fields with the recommended values; string fields pass through untouched. */
export function applyRecommended(form: OzonSettingsForm): OzonSettingsForm {
  return { ...form, ...OZON_RECOMMENDED_SETTINGS };
}

export type OzonSettingsPayload = OzonSettingsForm;

/**
 * Item 87 step 2: the four item-42 fields (deficitDays, bestWeeks, minSalesForCorrection,
 * maxSpeedGrowth) left the window and are no longer sent — the server keeps their sheet values
 * because a partial save leaves absent keys untouched. Every remaining conversion is identical
 * to the pre-step payload building that used to live inline in OzonSettingsModal.tsx.
 */
export function buildOzonSettingsPayload(form: OzonSettingsForm): OzonSettingsPayload {
  return {
    speedWeeks: Math.max(1, parseInt(String(form.speedWeeks), 10) || 1),
    minStockDays: Math.max(0, parseFloat(String(form.minStockDays)) || 0),
    targetStockDays: Math.max(0, parseFloat(String(form.targetStockDays)) || 0),
    deliveryToOzonDays: Math.max(0, parseFloat(String(form.deliveryToOzonDays)) || 0),
    maxClusterDays: Math.max(0, parseFloat(String(form.maxClusterDays)) || 0),
    factoryOrderDays: Math.max(0, parseFloat(String(form.factoryOrderDays)) || 0),
    returnsToSalePct: Math.min(100, Math.max(0, parseFloat(String(form.returnsToSalePct)) || 0)),
    salesRetentionWeeks: Math.max(1, parseInt(String(form.salesRetentionWeeks), 10) || 1),
    trendWeeks: Math.max(1, parseInt(String(form.trendWeeks), 10) || 1),
    salesGrowthPct: Math.max(0, parseFloat(String(form.salesGrowthPct)) || 0),
    demandGrowthPct: Math.max(0, parseFloat(String(form.demandGrowthPct)) || 0),
    turnoverPeriodDays: Math.max(1, parseInt(String(form.turnoverPeriodDays), 10) || 1),
    turnoverSlowDays: Math.max(0, parseFloat(String(form.turnoverSlowDays)) || 0),
    turnoverFastDays: Math.max(0, parseFloat(String(form.turnoverFastDays)) || 0),
    gmroiGreenPct: parseFloat(String(form.gmroiGreenPct)) || 0,
    gmroiRedPct: parseFloat(String(form.gmroiRedPct)) || 0,
    excludedClusters: form.excludedClusters,
    priorityClusters: form.priorityClusters,
    maxBoxesPerCluster: Math.max(1, parseInt(String(form.maxBoxesPerCluster), 10) || 1),
    dropOffWarehouseId: form.dropOffWarehouseId,
    dropOffWarehouseName: form.dropOffWarehouseName,
    dropOffWarehouseType: form.dropOffWarehouseType,
    directClusters: form.directClusters,
  };
}
