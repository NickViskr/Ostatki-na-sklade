import { SKUItem } from '../types';
import { resolveOzonArticle } from './ozonCoverage';

// ===== Грузоместа и этикетки Ozon (пункт 24 плана) =====
// Раскладка состава поставки по коробкам, разбор чек-листа готовности Ozon
// и сопоставление наших ключей коробок с номерами cargo_id.
// ПРАВИЛО РАСКЛАДКИ (решение пользователя 30.07.2026, подтверждено живым прогоном):
// ОДИН АРТИКУЛ — ОДНА КОРОБКА, остаток уходит в отдельную неполную коробку.
// Смешанные коробки не собираются никогда.
// Все функции чистые: без обращения к стору, без сети, без побочных эффектов.
// ВАЖНО: ozonCoverage.ts не должен импортировать этот модуль — получится кольцевая зависимость.

/** Потолок Ozon на одну поставку: не более 30 коробок за вызов /v1/cargoes/create. */
export const MAX_CARGOES_PER_SUPPLY = 30;

/** Позиция состава поставки — как она лежит в itemsJSON листа «Внешние отгрузки». */
export interface CargoSupplyItem {
  offerId: string;
  barcode: string;
  quantity: number;
}

/** Одна коробка раскладки. key — наш ключ, по нему Ozon вернёт cargo_id. */
export interface CargoBox {
  key: string;
  article: string;
  offerId: string;
  barcode: string;
  quantity: number;
  /** Коробка заполнена не до нормы (остаток). */
  isPartial: boolean;
}

/** Сводка по артикулу: сколько всего, сколько в коробке, сколько коробок. */
export interface CargoItemSummary {
  article: string;
  offerId: string;
  barcode: string;
  totalQty: number;
  perBox: number;
  fullBoxes: number;
  remainder: number;
  totalBoxes: number;
}

export interface CargoPlan {
  boxes: CargoBox[];
  items: CargoItemSummary[];
  totalBoxes: number;
  totalQty: number;
  /** Артикулы без нормы «ШТ/КОР» в SKU Базе: разложить их нельзя. */
  noNormArticles: string[];
  /** Коробок больше, чем Ozon принимает за один вызов. */
  exceedsLimit: boolean;
  maxBoxes: number;
}

/** Безопасный разбор itemsJSON из листа «Внешние отгрузки». */
export function parseSupplyItems(itemsJSON?: string): CargoSupplyItem[] {
  const raw = String(itemsJSON || '').trim();
  if (!raw) return [];
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: CargoSupplyItem[] = [];
  for (const it of parsed) {
    const quantity = Number(it && it.quantity) || 0;
    if (quantity <= 0) continue;
    out.push({
      offerId: String((it && it.offerId) || '').trim(),
      barcode: String((it && it.barcode) || '').trim(),
      quantity: quantity
    });
  }
  return out;
}

/** Норма упаковки артикула из SKU Базы; 0 означает «норма не задана». */
function findPcsPerBox(skus: SKUItem[], article: string): number {
  const target = String(article).trim();
  const found = skus.find(function (s) { return String(s.sku).trim() === target; });
  const n = found ? Number(found.pcsPerBox) || 0 : 0;
  return n > 0 ? n : 0;
}

/**
 * Раскладка состава поставки по коробкам.
 * Одинаковые позиции складываются. Артикулы без нормы упаковки коробок не получают
 * и попадают в noNormArticles — отправлять такую раскладку в Ozon нельзя.
 */
export function buildCargoPlan(
  items: CargoSupplyItem[],
  skus: SKUItem[],
  maxBoxes: number = MAX_CARGOES_PER_SUPPLY
): CargoPlan {
  const merged: Record<string, CargoSupplyItem> = {};
  const order: string[] = [];

  for (const it of items) {
    const qty = Number(it.quantity) || 0;
    if (qty <= 0) continue;
    const key = String(it.barcode || '') + '|' + String(it.offerId || '');
    if (!merged[key]) {
      merged[key] = { offerId: it.offerId, barcode: it.barcode, quantity: 0 };
      order.push(key);
    }
    merged[key].quantity += qty;
  }

  const summaries: CargoItemSummary[] = [];
  const boxes: CargoBox[] = [];
  const noNorm: string[] = [];
  let totalQty = 0;
  let boxNumber = 0;

  for (const key of order) {
    const item = merged[key];
    const article = resolveOzonArticle(skus, item.offerId, item.barcode);
    const perBox = findPcsPerBox(skus, article);
    totalQty += item.quantity;

    if (perBox <= 0) {
      if (noNorm.indexOf(article) < 0) noNorm.push(article);
      summaries.push({
        article: article,
        offerId: item.offerId,
        barcode: item.barcode,
        totalQty: item.quantity,
        perBox: 0,
        fullBoxes: 0,
        remainder: item.quantity,
        totalBoxes: 0
      });
      continue;
    }

    const fullBoxes = Math.floor(item.quantity / perBox);
    const remainder = item.quantity % perBox;

    for (let i = 0; i < fullBoxes; i++) {
      boxNumber++;
      boxes.push({
        key: 'box-' + boxNumber,
        article: article,
        offerId: item.offerId,
        barcode: item.barcode,
        quantity: perBox,
        isPartial: false
      });
    }

    if (remainder > 0) {
      boxNumber++;
      boxes.push({
        key: 'box-' + boxNumber,
        article: article,
        offerId: item.offerId,
        barcode: item.barcode,
        quantity: remainder,
        isPartial: true
      });
    }

    summaries.push({
      article: article,
      offerId: item.offerId,
      barcode: item.barcode,
      totalQty: item.quantity,
      perBox: perBox,
      fullBoxes: fullBoxes,
      remainder: remainder,
      totalBoxes: fullBoxes + (remainder > 0 ? 1 : 0)
    });
  }

  return {
    boxes: boxes,
    items: summaries,
    totalBoxes: boxes.length,
    totalQty: totalQty,
    noNormArticles: noNorm,
    exceedsLimit: boxes.length > maxBoxes,
    maxBoxes: maxBoxes
  };
}

/** Коробка в том виде, в каком она уходит на прокси. quant всегда 1: кванты не используем. */
export interface CargoBoxPayload {
  key: string;
  items: Array<{ barcode: string; offerId: string; quantity: number; quant: number }>;
}

/** Тело для отправки раскладки на прокси. Собирать запрос к Ozon — задача прокси. */
export function buildBoxesPayload(plan: CargoPlan): CargoBoxPayload[] {
  return plan.boxes.map(function (b) {
    return {
      key: b.key,
      items: [{ barcode: b.barcode, offerId: b.offerId, quantity: b.quantity, quant: 1 }]
    };
  });
}

/** Одно правило чек-листа готовности поставки. */
export interface CargoRule {
  code: string;
  title: string;
  satisfied: boolean;
  applicable: boolean;
  required: boolean;
  /** Правило мешает отгрузке: не выполнено, применимо и обязательно. */
  blocking: boolean;
  detail: string;
}

export interface CargoChecklist {
  supplyId: string;
  rules: CargoRule[];
  blockingCount: number;
  ready: boolean;
}

const RULE_ORDER = [
  'cargoes_presents_rule',
  'package_units_with_distribution_rule',
  'is_valid_distribution_rule',
  'expire_dates_presented_rule',
  'placement_zones_rule',
  'edit_deadline_expire_rule'
];

const RULE_TITLES: Record<string, string> = {
  cargoes_presents_rule: 'Грузоместа созданы',
  package_units_with_distribution_rule: 'У всех коробок указан состав',
  is_valid_distribution_rule: 'Состав коробок совпадает с составом поставки',
  expire_dates_presented_rule: 'Указаны сроки годности',
  placement_zones_rule: 'Товары распределены по зонам размещения',
  edit_deadline_expire_rule: 'Срок редактирования не истёк'
};

function num(v: any): number {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function ruleDetail(code: string, raw: any): string {
  if (!raw) return '';
  if (code === 'cargoes_presents_rule') {
    return 'Коробок: ' + num(raw.count);
  }
  if (code === 'package_units_with_distribution_rule') {
    return 'Заполнено ' + num(raw.count_with_distribution) + ' из ' + num(raw.count_all);
  }
  if (code === 'is_valid_distribution_rule') {
    return 'Разложено артикулов ' + num(raw.count_distributed_sku) + ' из ' + num(raw.count_sku_total) + ' (' + num(raw.percents_int) + '%)';
  }
  if (code === 'expire_dates_presented_rule') {
    return 'Заполнено ' + num(raw.count_sku_with_expiration_filled) + ' из ' + num(raw.count_sku_with_expiration);
  }
  if (code === 'placement_zones_rule') {
    return 'Моно-зона у ' + num(raw.count_cargoes_with_mono_placement_zone) + ' из ' + num(raw.count_cargoes_all);
  }
  return '';
}

/**
 * Разбор одного элемента supply_check_lists[] из ответа /v1/cargoes/rules/get.
 * Отсутствующие is_applicable и is_required считаются истинными: у части правил
 * этих полей нет вовсе, и такие правила блокируют отгрузку.
 * ВНИМАНИЕ: is_valid_distribution_rule бинарное — percents_int скачет с 0 на 100,
 * строить по нему прогресс-бар нельзя.
 */
export function parseCargoRules(checkList: any): CargoChecklist {
  const supplyId = String((checkList && checkList.supply_id) || '');
  const rules: CargoRule[] = [];

  for (const code of RULE_ORDER) {
    const raw = checkList ? checkList[code] : null;
    if (!raw) continue;
    const satisfied = raw.satisfied === true;
    const applicable = raw.is_applicable === undefined ? true : raw.is_applicable === true;
    const required = raw.is_required === undefined ? true : raw.is_required === true;
    rules.push({
      code: code,
      title: RULE_TITLES[code] || code,
      satisfied: satisfied,
      applicable: applicable,
      required: required,
      blocking: !satisfied && applicable && required,
      detail: ruleDetail(code, raw)
    });
  }

  const blockingCount = rules.filter(function (r) { return r.blocking; }).length;

  return {
    supplyId: supplyId,
    rules: rules,
    blockingCount: blockingCount,
    ready: rules.length > 0 && blockingCount === 0
  };
}

export interface CargoKeyMatch {
  key: string;
  cargoId: string;
}

export interface CargoMatchResult {
  matched: CargoKeyMatch[];
  /** Наши ключи, для которых Ozon не вернул номер. */
  missing: string[];
  /** Ключи, которых мы не отправляли. */
  unexpected: string[];
}

/**
 * Сопоставление наших ключей коробок с номерами cargo_id из /v2/cargoes/create/info.
 * ТОЛЬКО по полю key: порядок элементов в ответе Ozon произвольный и на живом
 * прогоне пришёл обратным.
 */
export function matchCargoKeys(planKeys: string[], createInfoResult: any): CargoMatchResult {
  const list = (createInfoResult && Array.isArray(createInfoResult.cargoes)) ? createInfoResult.cargoes : [];
  const byKey: Record<string, string> = {};

  for (const c of list) {
    const k = String((c && c.key) || '').trim();
    const id = String((c && c.value && c.value.cargo_id) || '').trim();
    if (k && id) byKey[k] = id;
  }

  const matched: CargoKeyMatch[] = [];
  const missing: string[] = [];

  for (const k of planKeys) {
    if (byKey[k]) {
      matched.push({ key: k, cargoId: byKey[k] });
    } else {
      missing.push(k);
    }
  }

  const unexpected = Object.keys(byKey).filter(function (k) { return planKeys.indexOf(k) < 0; });

  return { matched: matched, missing: missing, unexpected: unexpected };
}

export interface CargoCompareResult {
  existingCount: number;
  plannedCount: number;
  /** В поставке уже есть грузоместа: отправка раскладки их перезапишет. */
  willOverwrite: boolean;
  existingCargoIds: string[];
}

/** Сравнение того, что уже лежит в Ozon (/v1/cargoes/get), с новым планом. */
export function compareCargoWithPlan(actualCargoes: any[], plan: CargoPlan): CargoCompareResult {
  const list = Array.isArray(actualCargoes) ? actualCargoes : [];
  const ids = list
    .map(function (c) { return String((c && c.cargo_id) || '').trim(); })
    .filter(function (v) { return v !== ''; });

  return {
    existingCount: ids.length,
    plannedCount: plan.totalBoxes,
    willOverwrite: ids.length > 0,
    existingCargoIds: ids
  };
}
