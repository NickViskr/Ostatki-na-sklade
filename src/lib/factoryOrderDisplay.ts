import { FactoryOrder } from '../types';

/** Item 83g: whether a factory-order row came from the China module («Заказы в Китае»), as
 * opposed to a manual row (`source === ''`). China rows are read-only in `FactoryOrderModal`. */
export function isChinaFactoryOrder(order: FactoryOrder): boolean {
  const source = String(order.source || '').trim();
  return source === 'Китай' || source === 'Китай прогноз';
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
