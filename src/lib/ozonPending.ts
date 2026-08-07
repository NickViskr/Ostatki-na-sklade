import { ExternalShipment, SKUItem } from '../types';
import { resolveOzonArticle } from './ozonCoverage';

// ===== Локальный зачёт потребности после создания заявки (пункт 23) =====
// Задача: количества из уже созданных заявок на поставку вычитаются из потребности сразу,
// не дожидаясь, пока Ozon отразит их в колонке «В заявках» (задержка — часы).
// Резерв держится до фактического списания: пока расход по поставке не проведён,
// товар числится на складе и не должен повторно распределяться в другой кластер.
// Зачёт снимается ПО ФАКТУ: отмена заявки, отказ в приёмке, просрочка либо обработка
// строки поставки локально (списание проведено или поставка помечена проигнорированной).
// Предохранитель — 7 дней: если статус заявки получить не удалось, зачёт истекает сам.
// Все функции чистые: без обращения к стору и без побочных эффектов.

/** Предохранитель зачёта по умолчанию, дней. */
export const PENDING_SAFETY_DAYS = 7;

/** Статусы Ozon, при которых заявка закрыта и зачёт снимается. */
export const PENDING_CLEARED_STATUSES = ['CANCELLED', 'REJECTED_AT_SUPPLY_WAREHOUSE', 'OVERDUE'];

/**
 * Известные статусы Ozon, при которых заявка жива: зачёт действует без ограничения по сроку.
 * Отгрузка на Ozon зачёт НЕ снимает — его снимает только фактическое списание со склада.
 */
export const PENDING_ACTIVE_STATUSES = [
  'DATA_FILLING',
  'READY_TO_SUPPLY',
  'ACCEPTED_AT_SUPPLY_WAREHOUSE',
  'IN_TRANSIT',
  'ACCEPTANCE_AT_STORAGE_WAREHOUSE',
  'REPORTS_CONFIRMATION_AWAITING',
  'REPORT_REJECTED',
  'COMPLETED'
];

/** Локальный статус строки «Внешних отгрузок», при котором зачёт уже не нужен. */
export function isShipmentSettled(localStatus?: string): boolean {
  const s = String(localStatus || '').trim().toLowerCase();
  return s === 'processed' || s === 'ignored';
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Зачёт по этой поставке снят: заявка отменена, отказано в приёмке или просрочена. */
export function isPendingCleared(ozonStatus?: string): boolean {
  const s = String(ozonStatus || '').toUpperCase().trim();
  if (!s) return false;
  return PENDING_CLEARED_STATUSES.indexOf(s) >= 0;
}

/** Статус заявки известен и заявка жива: предохранитель по сроку не применяется. */
export function isPendingActive(ozonStatus?: string): boolean {
  const s = String(ozonStatus || '').toUpperCase().trim();
  return PENDING_ACTIVE_STATUSES.indexOf(s) >= 0;
}

/** Разбор даты из листа: 'yyyy-MM-dd HH:mm:ss', 'yyyy-MM-dd' или ISO. */
function parseSheetDate(value?: string): number | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const normalized = raw.indexOf('T') < 0 && raw.indexOf(' ') > 0 ? raw.replace(' ', 'T') : raw;
  const time = new Date(normalized).getTime();
  return isNaN(time) ? null : time;
}

/** Дата укладывается в окно предохранителя (пустая или нечитаемая дата — не укладывается). */
function isWithinSafetyWindow(value: string | undefined, now: Date, safetyDays: number): boolean {
  const time = parseSheetDate(value);
  if (time === null) return false;
  return now.getTime() - time <= safetyDays * DAY_MS;
}

/** Разбор JSON-массива; при любой ошибке — пустой массив. */
function parseArray(json?: string): any[] {
  const raw = String(json || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Строка листа «Заявки Ozon» — журнал заявок, созданных мастером приложения. */
export interface OzonSupplyRequestRow {
  id: string;
  date: string;
  cabinet: string;
  draftId: string;
  orderId: string;
  dropOffName: string;
  clusters: string;
  /** JSON вида [{"article":"...","clusterId":"...","qty":10}] */
  itemsJSON: string;
  who: string;
  status: string;
}

/** Одна зачтённая позиция — для расшифровки в интерфейсе. */
export interface PendingSupplyDetail {
  /** 'shipment' — данные Ozon из «Внешних отгрузок»; 'request' — журнал «Заявки Ozon». */
  source: 'shipment' | 'request';
  orderId: string;
  /** ID поставки; для журнала — пустая строка. */
  postingId: string;
  cabinet: string;
  article: string;
  /** Пустая строка — позиция без кластера (в кластерные расчёты не идёт). */
  clusterId: string;
  qty: number;
  /** Статус Ozon; для журнала — пустая строка. */
  ozonStatus: string;
  /** Дата, от которой считается предохранитель. */
  since: string;
}

export interface PendingSuppliesResult {
  /** Зачёт по кластерам: артикул -> КластерID -> шт. */
  byArticleCluster: Record<string, Record<string, number>>;
  /** Зачёт по товару целиком, шт (включая позиции без кластера). */
  byArticle: Record<string, number>;
  /** Зачёт позиций без КластерID, шт — только в общие итоги. */
  unboundByArticle: Record<string, number>;
  /** Расшифровка всех зачтённых позиций. */
  details: PendingSupplyDetail[];
}

export interface PendingSuppliesInput {
  /** Лист «Внешние отгрузки» (данные Ozon). */
  shipments: ExternalShipment[];
  /** Лист «Заявки Ozon» (журнал приложения). */
  requests: OzonSupplyRequestRow[];
  skus: SKUItem[];
  /** Момент расчёта; по умолчанию — текущее время. */
  now?: Date;
  /** Предохранитель, дней; по умолчанию PENDING_SAFETY_DAYS. */
  safetyDays?: number;
}

/**
 * Локальный зачёт потребности по незавершённым заявкам на поставку.
 *
 * Источник правды — лист «Внешние отгрузки»: при MULTI_CLUSTER каждая строка это поставка
 * в один кластер со своим составом и КластерID, поэтому зачёт получается покластерным
 * с момента создания заявки. Заявки, созданные вручную в Ozon Seller, подхватываются так же.
 *
 * Журнал «Заявки Ozon» — только подстраховка на разрыв между созданием заявки в приложении
 * и ближайшим опросом Ozon: он используется лишь тогда, когда по этому OrderID во «Внешних
 * отгрузках» ещё нет ни одной строки с составом и ни одна строка не сняла зачёт.
 */
export function buildPendingSupplies(input: PendingSuppliesInput): PendingSuppliesResult {
  const now = input.now || new Date();
  const safetyDays = input.safetyDays && input.safetyDays > 0 ? input.safetyDays : PENDING_SAFETY_DAYS;
  const skus = input.skus || [];
  const shipments = input.shipments || [];
  const requests = input.requests || [];

  const details: PendingSupplyDetail[] = [];

  // Строки «Внешних отгрузок» по OrderID — чтобы понять, знает ли Ozon об этой заявке.
  const rowsByOrderId: Record<string, ExternalShipment[]> = {};
  for (const row of shipments) {
    const orderId = String(row.orderId || '').trim();
    if (!orderId) continue;
    if (!rowsByOrderId[orderId]) rowsByOrderId[orderId] = [];
    rowsByOrderId[orderId].push(row);
  }

  // Часть 1. Зачёт по данным Ozon.
  for (const row of shipments) {
    // Списание проведено или поставка проигнорирована — резерв больше не нужен
    if (isShipmentSettled(row.status)) continue;
    const status = String(row.ozonStatus || '').trim();
    if (isPendingCleared(status)) continue;
    if (!isPendingActive(status)) {
      // Статус неизвестен или пуст — работает предохранитель по сроку.
      const since = String(row.detectedAt || '').trim() || String(row.shipmentDate || '').trim();
      if (!isWithinSafetyWindow(since, now, safetyDays)) continue;
    }

    const clusterId = String(row.clusterId || '').trim();
    const items = parseArray(row.itemsJSON);
    for (const item of items) {
      if (!item) continue;
      const rawQty = item.quantity !== undefined && item.quantity !== null ? item.quantity : item.qty;
      const qty = Number(rawQty) || 0;
      if (qty <= 0) continue;
      const offerId = String(item.offerId || item.offer_id || '').trim();
      const barcode = String(item.barcode || '').trim();
      const article = resolveOzonArticle(skus, offerId, barcode);
      details.push({
        source: 'shipment',
        orderId: String(row.orderId || '').trim(),
        postingId: String(row.postingId || '').trim(),
        cabinet: String(row.cabinet || '').trim(),
        article,
        clusterId,
        qty,
        ozonStatus: status,
        since: String(row.detectedAt || '').trim()
      });
    }
  }

  // Часть 2. Подстраховка журналом «Заявки Ozon».
  for (const req of requests) {
    const reqStatus = String(req.status || '').trim().toLowerCase();
    if (reqStatus.indexOf('отмен') === 0) continue;

    const orderId = String(req.orderId || '').trim();
    const rows = orderId ? (rowsByOrderId[orderId] || []) : [];
    if (rows.length > 0) {
      const anyCleared = rows.some(r => isPendingCleared(r.ozonStatus) || isShipmentSettled(r.status));
      const anyItems = rows.some(r => parseArray(r.itemsJSON).length > 0);
      // Ozon уже знает эту заявку: либо снял зачёт, либо прислал состав — журнал не нужен.
      if (anyCleared || anyItems) continue;
    }
    if (!isWithinSafetyWindow(req.date, now, safetyDays)) continue;

    const items = parseArray(req.itemsJSON);
    for (const item of items) {
      if (!item) continue;
      const qty = Number(item.qty !== undefined && item.qty !== null ? item.qty : item.quantity) || 0;
      if (qty <= 0) continue;
      const article = String(item.article || '').trim();
      if (!article) continue;
      details.push({
        source: 'request',
        orderId,
        postingId: '',
        cabinet: String(req.cabinet || '').trim(),
        article,
        clusterId: String(item.clusterId || '').trim(),
        qty,
        ozonStatus: '',
        since: String(req.date || '').trim()
      });
    }
  }

  const byArticleCluster: Record<string, Record<string, number>> = {};
  const byArticle: Record<string, number> = {};
  const unboundByArticle: Record<string, number> = {};

  for (const d of details) {
    byArticle[d.article] = (byArticle[d.article] || 0) + d.qty;
    if (!d.clusterId) {
      unboundByArticle[d.article] = (unboundByArticle[d.article] || 0) + d.qty;
      continue;
    }
    if (!byArticleCluster[d.article]) byArticleCluster[d.article] = {};
    byArticleCluster[d.article][d.clusterId] = (byArticleCluster[d.article][d.clusterId] || 0) + d.qty;
  }

  return { byArticleCluster, byArticle, unboundByArticle, details };
}

/** Зачёт по конкретной паре «артикул + кластер», шт. */
export function getPendingQty(
  pending: PendingSuppliesResult,
  article: string,
  clusterId: string
): number {
  const byCluster = pending.byArticleCluster[article];
  if (!byCluster) return 0;
  return byCluster[clusterId] || 0;
}

/**
 * Локальный зачёт и колонка «В заявках» из «Остатков Ozon» описывают ОДНИ И ТЕ ЖЕ заявки,
 * поэтому берётся наибольшее из двух, а не сумма (решение пользователя 29.07.2026).
 */
export function mergePendingWithRequested(pendingQty: number, requestedQty: number): number {
  const pending = Math.max(0, Number(pendingQty) || 0);
  const requested = Math.max(0, Number(requestedQty) || 0);
  return Math.max(pending, requested);
}
