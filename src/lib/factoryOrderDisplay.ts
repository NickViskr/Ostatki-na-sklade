import { FactoryOrder } from '../types';

/** Item 83g: whether a factory-order row came from the China module («Заказы в Китае»), as
 * opposed to a manual row (`source === ''`). China rows are read-only in `FactoryOrderModal`. */
export function isChinaFactoryOrder(order: FactoryOrder): boolean {
  const source = String(order.source || '').trim();
  return source === 'Китай' || source === 'Китай прогноз';
}

/**
 * Item 85, step 1.7. The factory orders of one article as the screen shows them, by the SAME
 * rule as the pipeline (`factoryOnOrderByArticle`): `waiting` is exactly what the pipeline
 * counts, `overdue` is a manual order whose date has passed (it dropped out of the pipeline and
 * waits for the owner). A China row is never overdue — late, it stays in the pipeline with
 * «задерживается N дн» (item 83d). Received and «replaced» rows, and manual rows hidden by a China
 * row of the article (`hiddenIds`), are in neither list. Both tables of «Остатки Озон» use it:
 * the components table used to call a late China order «просрочен — в запас не входит», and
 * both counted replaced and hidden rows into «уже заказано».
 */
export function splitFactoryOrders(
  orders: FactoryOrder[],
  todayIso: string,
  hiddenIds: Set<string> = new Set()
): { waiting: FactoryOrder[]; overdue: FactoryOrder[] } {
  const live = (orders || []).filter((o) => {
    const status = String(o.status || '').trim();
    return status !== 'received' && status !== 'replaced' && !hiddenIds.has(o.id);
  });
  const late = (o: FactoryOrder) => !!o.expectedAt && o.expectedAt < todayIso;
  return {
    waiting: live.filter((o) => isChinaFactoryOrder(o) || !late(o)),
    overdue: live.filter((o) => !isChinaFactoryOrder(o) && late(o))
  };
}

/** Item 83g: badge text next to a factory-order row — «Китай · NV-0923-4» for a shipped batch,
 * «Китай · прогноз, заказ 31» for a saved forecast that has not shipped yet; '' for a manual row. */
export function factoryOrderBadge(order: FactoryOrder): string {
  const source = String(order.source || '').trim();
  if (source === 'Китай') {
    const code = String(order.chinaBatchCode || '').trim();
    return code ? `Китай · ${code}` : 'Китай';
  }
  if (source === 'Китай прогноз') {
    const orderNo = String(order.chinaOrderNo || '').trim();
    return orderNo ? `Китай · прогноз, заказ ${orderNo}` : 'Китай · прогноз';
  }
  return '';
}

/** Item 83d: «задерживается N дн» for a China row whose expected date has passed; '' otherwise —
 * a China row stays in the pipeline even late, so the label is informational, not a warning that
 * the row dropped out. */
export function factoryLateLabel(lateDays: number | undefined): string {
  return lateDays && lateDays > 0 ? `задерживается ${lateDays} дн` : '';
}

/** Item 83b: whether a saved forecast's own lines are still in the pipeline as 'Китай прогноз'
 * rows. A forecast needs BOTH an order number and an expected ship date to enter the pipeline
 * (`syncChinaFactoryOrders`, server side); once a real batch of the same order number exists, its
 * forecast rows are removed — the batch replaces them, one order ships as one batch. */
export type ForecastPipelineStatus = 'inPipeline' | 'replaced' | 'notInPipeline';

export function forecastPipelineStatus(
  forecast: { orderNo: string; expectedShipAt: string },
  hasBatchOfOrder: boolean
): ForecastPipelineStatus {
  if (hasBatchOfOrder) return 'replaced';
  if (String(forecast.orderNo || '').trim() && String(forecast.expectedShipAt || '').trim()) return 'inPipeline';
  return 'notInPipeline';
}

export function forecastPipelineStatusLabel(status: ForecastPipelineStatus): string {
  if (status === 'inPipeline') return 'в трубе';
  if (status === 'replaced') return 'заменён партией';
  return 'не в трубе: нет номера заказа или даты';
}
