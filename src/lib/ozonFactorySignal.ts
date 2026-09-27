// Item 88, ticket 02. Factory pipeline: on-order lookup and the reorder signal.
import { FactoryOrder } from '../types';
import type { OzonCoverageSettings } from './ozonClusters';

/** Дней, разделяющих две ISO-даты (toDay − fromDay), считается через UTC-полночь. */
export function daysBetweenIso(fromDay: string, toDay: string): number {
  const DAY_MS = 24 * 60 * 60 * 1000;
  return Math.round((Date.parse(toDay + 'T00:00:00Z') - Date.parse(fromDay + 'T00:00:00Z')) / DAY_MS);
}

export interface FactoryOnOrderResult {
  /** Заказано и ещё не получено, шт, по артикулу — то, что входит в ТРУБУ. */
  qty: Record<string, number>;
  /** Ручные заказы, скрытые из ТРУБЫ: по их артикулу есть активный заказ из Китая, а
   * владелец ещё не подтвердил, что это РАЗНЫЕ заказы. */
  hiddenManual: FactoryOrder[];
  /** Просроченные заказы из Китая (id → сколько дней просрочки). Ручные просроченные заказы
   * сюда не попадают — они просто выпадают из ТРУБЫ, как и раньше (пункт 35). */
  late: Record<string, number>;
}

/**
 * Пункт 83d/83e. ЕДИНОЕ правило «что считается заказанным на фабрике и ещё не полученным» —
 * общее для OzonStocksTab и Dashboard (иначе они неизбежно разойдутся), и зеркалируется на
 * сервере (Code.gs, `factoryPipelineQtyByArticleGs`) для отчёта до/после синхронизации.
 *
 * - 'received' и 'replaced' никогда не считаются: товар либо уже пришёл, либо ручной заказ
 *   закрыт как дубликат заказа из Китая.
 * - Ручной заказ (`source === ''`) выпадает из ТРУБЫ, если дата ожидания в прошлом — фабрика
 *   сорвала срок (правило пункта 35 без изменений).
 * - Заказ из Китая ('Китай' / 'Китай прогноз') остаётся в ТРУБЕ даже просроченным: недосчёт
 *   может лишь навести на мысль о лишнем заказе, а перебор — скрыть нехватку. `late` показывает,
 *   на сколько дней просрочка.
 * - An active manual row is hidden whenever the SAME article has a China row (active OR
 *   RECEIVED — a China row never disappears from `orders`, only its status changes) whose
 *   `orderedAt` (shipping date) is on or after the manual row's own `orderedAt`. From item 83
 *   on, China orders reach the warehouse only through the China module, so a China shipment
 *   no older than the manual order is that SAME order — arrival must not un-hide it, or the
 *   goods are counted twice (as received stock AND as the still-open manual order). Exception:
 *   `checked` (the owner confirmed «это разные заказы») — then both are counted, in every
 *   state. Hidden rows are returned separately so the screen keeps offering the two buttons
 *   even after arrival — the owner still has to close the manual row as 'replaced'.
 *   A manual row ordered AFTER the China shipment is NOT hidden: it is a later, separate order.
 */
export function factoryOnOrderByArticle(orders: FactoryOrder[], todayIso: string): FactoryOnOrderResult {
  const list = orders || [];
  // Every China row (active or received — a 'replaced' status is a MANUAL-only state, a China
  // row is never 'replaced') is a candidate to hide a manual row of the same article, keyed by
  // article -> the shipping dates of every such row still present in `orders`.
  const chinaOrderedAtByArticle = new Map<string, string[]>();
  for (const o of list) {
    const source = String(o.source || '').trim();
    if (source !== 'Китай' && source !== 'Китай прогноз') continue;
    const article = String(o.article || '').trim();
    if (!article) continue;
    const list2 = chinaOrderedAtByArticle.get(article) || [];
    list2.push(String(o.orderedAt || '').trim());
    chinaOrderedAtByArticle.set(article, list2);
  }

  const qty: Record<string, number> = {};
  const late: Record<string, number> = {};
  const hiddenManual: FactoryOrder[] = [];

  for (const o of list) {
    const status = String(o.status || '').trim();
    if (status === 'received' || status === 'replaced') continue;
    const article = String(o.article || '').trim();
    if (!article) continue;
    const source = String(o.source || '').trim();
    const isChina = source === 'Китай' || source === 'Китай прогноз';
    const expected = String(o.expectedAt || '').trim();

    if (!isChina) {
      const manualOrderedAt = String(o.orderedAt || '').trim();
      const chinaDates = chinaOrderedAtByArticle.get(article) || [];
      const hiddenByChina = chinaDates.some((d) => d >= manualOrderedAt);
      if (hiddenByChina && !o.checked) {
        hiddenManual.push(o);
        continue;
      }
      if (expected && expected < todayIso) continue;
    } else if (expected && expected < todayIso) {
      late[o.id] = daysBetweenIso(expected, todayIso);
    }

    qty[article] = (qty[article] || 0) + (Number(o.qty) || 0);
  }

  return { qty, hiddenManual, late };
}

export interface FactorySignal {
  /** На сколько дней хватит ТРУБЫ: ТРУБА ÷ скорость. */
  daysLeft: number;
  /** ТРУБА, шт: остаток всех кластеров Ozon + Мой склад + заказанное на фабрике и ещё не полученное. */
  pipelineQty: number;
  /** Заказано на фабрике и ещё не получено, шт. Просроченные заказы сюда НЕ входят. */
  onOrderQty: number;
  /** Порог срабатывания в днях: срок поставки + неснижаемый запас. */
  thresholdDays: number;
  /** Тот же порог в штуках: скорость × thresholdDays. */
  thresholdQty: number;
  /** Сколько дозаказать, шт, кратно коробке. 0 — заказывать не нужно. */
  orderQty: number;
  /** Тот же объём в коробках. */
  orderBoxes: number;
  /** Причина сигнала: 'total' — ТРУБА ниже порога; 'clusterDeficit' — ТРУБЫ хватает, но кластерам нужна поставка, а везти нечего. */
  reason: 'total' | 'clusterDeficit';
  /** Непокрытая потребность кластеров, шт. */
  unmetDeficitQty: number;
}

/**
 * Пункт 35. Сигнал «пора заказать на фабрике» по модели ТРУБА.
 * ТРУБА = остаток всех кластеров Ozon + Мой склад + заказанное на фабрике и ещё не полученное.
 * ПОРОГ = скорость × (срок поставки + неснижаемый запас).
 * ОБЪЁМ = скорость × (срок поставки + неснижаемый запас + объём заказа в днях) − ТРУБА,
 * округление вверх до целых коробок один раз по товару.
 * Сигнал больше НЕ гасится наличием заказа: заказ входит в ТРУБУ и уменьшает объём дозаказа.
 * Просроченный заказ в ТРУБУ не входит — вызывающая сторона такие заказы сюда не передаёт.
 * Если ТРУБЫ хватает, но у кластеров есть непокрытая потребность, возвращается reason
 * 'clusterDeficit' с orderQty = 0: товар есть, он просто лежит не в том кластере, заказывать не надо.
 * Остатки исключённых кластеров и строки без КластерID входят в ТРУБУ.
 *
 * Item 86, step C (owner, 26.09.2026): a factory order must ALSO cover the week the goods spend
 * travelling from «Мой склад» to Ozon (settings.deliveryToOzonDays, D) — thresholdDays widens to
 * lead + D + minStockDays. D = 0 reproduces the old threshold exactly.
 */
export function calcFactorySignal(
  totalEstimated: number,
  myStockAvailable: number,
  perDay: number,
  leadTimeDays: number,
  pcsPerBox: number,
  settings: OzonCoverageSettings,
  unmetDeficitQty: number = 0,
  onOrderQty: number = 0
): FactorySignal | null {
  if (!(perDay > 0)) return null;
  const lead = Number(leadTimeDays) || 0;
  const deliveryDays = Math.max(0, Number(settings.deliveryToOzonDays) || 0);
  const onOrder = Math.max(0, Number(onOrderQty) || 0);
  const pipelineQty = totalEstimated + Math.max(0, myStockAvailable) + onOrder;
  const thresholdDays = lead + deliveryDays + settings.minStockDays;
  const thresholdQty = perDay * thresholdDays;
  const belowThreshold = pipelineQty < thresholdQty;
  const unmet = Math.max(0, Number(unmetDeficitQty) || 0);
  if (!belowThreshold && unmet <= 0) return null;
  const box = pcsPerBox > 0 ? pcsPerBox : 1;
  const targetQty = perDay * (thresholdDays + settings.factoryOrderDays);
  const rawNeed = targetQty - pipelineQty;
  const orderQty = belowThreshold && rawNeed > 0 ? Math.ceil(rawNeed / box) * box : 0;
  return {
    daysLeft: pipelineQty / perDay,
    pipelineQty,
    onOrderQty: onOrder,
    thresholdDays,
    thresholdQty,
    orderQty,
    orderBoxes: Math.ceil(orderQty / box),
    reason: belowThreshold ? 'total' : 'clusterDeficit',
    unmetDeficitQty: unmet
  };
}
