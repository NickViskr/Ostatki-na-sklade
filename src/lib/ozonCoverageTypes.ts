// Item 88, ticket 02. Coverage result types: article/cluster rows, kit components, input/output.
import type { KitItem, OzonSalesRow, OzonStockHistoryRow, OzonStockRow, SKUItem } from '../types';
import type { OzonClusterRef, OzonCoverageSettings } from './ozonClusters';
import type { SalesSpeedResult, SpeedCorrectionInfo, DemandGrowthInfo } from './ozonSalesSpeed';
import type { SupplyRecommendation } from './ozonSupplyRecommendation';
import type { FactorySignal } from './ozonFactorySignal';
import type { SalesTrend } from './ozonSalesTrend';

export interface ClusterCoverageRow {
  clusterId: string;
  clusterName: string;
  qtySold: number;
  perDay: number;
  available: number;
  transit: number;
  returns: number;
  /** Item 85. Shelf + on their way: what the cluster can count on. Coverage and need use it. */
  estimated: number;
  coverageDays: number | null;
  excluded: boolean;
  /** Кластер отмечен как приоритетный. */
  priority: boolean;
  /** Коэффициент повышенного запаса приоритетного кластера (1 — обычный кластер). */
  priorityK: number;
  /** Непокрытая потребность кластера, шт: сколько не досталось из-за нехватки на Моём складе. */
  unmetQty: number;
  /** Item 85. On their way by our own supplies (status before acceptance at the storage warehouse), шт. */
  pendingQty: number;
  /** «В заявках» по данным Ozon для этого кластера, шт. */
  requestedQty: number;
  /** Item 85. On their way by Ozon: «В пути» + «В заявках», шт. */
  ozonInFlightQty: number;
  /** Item 85. On their way, counted once: the larger of pendingQty and ozonInFlightQty, шт. */
  inFlightQty: number;
  recommendation: SupplyRecommendation | null;
  /** Item 86, step B. Share (%) of the article's sales over `shareWindowWeeks` this cluster took
   *  in the LONG share window — the multiplier behind `perDay` (= article speed × this share). */
  speedSharePct: number;
  /** Item 86, step B. Length of the share window, weeks (full weeks, +1 for a part-week). */
  shareWindowWeeks: number;
}

export interface ArticleCoverage {
  article: string;
  qtySold: number;
  /** ФАКТИЧЕСКАЯ скорость продаж, шт/день. Тренд её не трогает: по ней считаются кластеры. */
  perDay: number;
  /** Пункт 38 / item 85 step 1.4. Прогнозная скорость для заказа на фабрике:
   *  max(window speed × trend, 7-day speed when «Спрос вырос» fired) × (1 + прирост, %). */
  forecastPerDay: number;
  /** Пункт 38. Разбор тренда продаж. null — тренд не считался (продаж за окно нет). */
  trend: SalesTrend | null;
  pcsPerBox: number;
  leadTimeDays: number;
  myStockAvailable: number;
  totalEstimated: number;
  unboundEstimated: number;
  /** Продажи товара, не привязанные к кластеру («Без кластера» и неизвестные названия), шт. */
  unboundQtySold: number;
  /** Суммарная непокрытая потребность кластеров товара, шт. */
  unmetDeficitQty: number;
  /** Весь локальный зачёт по товару, шт (включая позиции без кластера). */
  pendingTotal: number;
  /** Свободный остаток Моего склада после резерва под созданные заявки, шт. Item 85, step 1.6:
   *  the reserve is taken per PHYSICAL article, so a kit's reserve of shared bottles lowers every
   *  other kit (and the bottles themselves) too. */
  freeMyStock: number;
  /** Item 85, step 1.6. What the recommendation may hand out: freeMyStock, cut further when a
   *  component shared with other kits is short and is split between them. */
  shippableMyStock: number;
  /** Item 85, step 1.6. Shared components whose split cut this article below its free stock. */
  sharedLimitedBy: string[];
  clusters: ClusterCoverageRow[];
  factory: FactorySignal | null;
  /** Пункт 42. Разбор коррекции скорости при дефиците. null — коррекция не применялась. */
  speedCorrection: SpeedCorrectionInfo | null;
  /** Item 73. The last 7 days against the speed window. null — no base speed or no sales rows for the last 7 days. */
  demandGrowth: DemandGrowthInfo | null;
  /** Item 86, step D. Where `perDay` came from: 'daysInStock' — history covers the speed window
   *  and gave ≥ MIN_HISTORY_DAYS in-stock days; 'lookback' — history covers it but gave fewer, so
   *  an earlier period was walked back into; 'calendar' — history does not cover the window
   *  (including no `stockHistory` at all) and `perDay` is calendar-days speed as before this item. */
  speedSource: 'daysInStock' | 'lookback' | 'calendar';
  /** Effective (or, in a lookback, counted) in-stock days behind `perDay`. 0 for 'calendar'. */
  speedDaysInStock: number;
  /** Sold over the same period, pcs — the tooltip's «продано N шт». Taken from the calculation, not
   *  rebuilt as perDay × days: «Спрос вырос» (item 73) may have replaced perDay afterwards. */
  speedSoldQty: number;
  /** Calendar days of the period behind `perDay`: the short window's own length for 'daysInStock'
   *  and 'calendar', the lookback's actual span (period.from … today) for 'lookback'. */
  speedWindowDays: number;
  /** 'lookback' only: the period actually walked, oldest Monday to today. */
  speedPeriod?: { from: string; to: string };
  /** 'lookback' only: the walk used at least one week/block before history started (18.08.2026),
   *  approximated from sales presence rather than measured in-stock days. */
  speedApproximate: boolean;
  /** No sales anywhere in the 26-week lookback ceiling: `perDay` is 0, no recommendation and no
   *  factory signal for this article — real stock-out is indistinguishable from never having sold. */
  noSales26: boolean;
}

/**
 * Готовый локальный зачёт по созданным заявкам (пункт 23).
 * Структура повторяет PendingSuppliesResult из ozonPending.ts, но объявлена здесь отдельно:
 * прямой импорт создал бы кольцевую зависимость между модулями.
 */
export interface OzonPendingLike {
  /** On their way to a cluster: артикул -> КластерID -> шт. */
  byArticleCluster: Record<string, Record<string, number>>;
  /** Reserve of «Мой склад» по товару целиком, шт (включая позиции без кластера). */
  byArticle: Record<string, number>;
  /** Item 85. On their way without КластерID: артикул -> шт. Absent — none. */
  unboundInFlightByArticle?: Record<string, number>;
}

// ===== Пункт 36: компоненты виртуальных комплектов =====

/**
 * Покрытие по одному компоненту виртуальных комплектов.
 * У фабрики заказывают не комплекты, а компоненты: сроки поставки и размеры коробок у них
 * свои, а один компонент может входить сразу в несколько комплектов и расходоваться кратно
 * быстрее. Поэтому сигнал заказа на фабрике считается здесь, а не по комплекту.
 */
export interface ComponentCoverage {
  /** Артикул компонента. */
  component: string;
  /** Скорость расхода, шт/день: Σ по комплектам (скорость комплекта × норма расхода). */
  perDay: number;
  /** Пункт 38. Прогнозная скорость расхода: то же, но по ПРОГНОЗНОЙ скорости комплектов. */
  forecastPerDay: number;
  /** ТРУБА, шт: fromKitsQty + Мой склад + заказанное на фабрике по этому компоненту. */
  pipelineQty: number;
  /** Собственный остаток компонента на Моём складе, шт (сырой, без вычета резервов). */
  myStockQty: number;
  /** Зарезервировано под созданные заявки на поставку, шт: Σ по комплектам (резерв комплекта × норма). */
  reservedQty: number;
  /** Свободный остаток на Моём складе, шт: myStockQty − reservedQty, не меньше нуля. */
  freeMyStockQty: number;
  /** Заказано на фабрике по самому компоненту и ещё не получено, шт. */
  onOrderQty: number;
  /** Пришло из расчётных остатков комплектов на Ozon, шт: Σ (totalEstimated комплекта × норма). */
  fromKitsQty: number;
  /** Срок поставки из карточки КОМПОНЕНТА в SKU Базе, дней. */
  leadTimeDays: number;
  /** Размер коробки из карточки КОМПОНЕНТА в SKU Базе, шт. */
  pcsPerBox: number;
  /** Сигнал «пора заказать на фабрике» по компоненту. */
  factory: FactorySignal | null;
  /** Артикулы виртуальных комплектов, в которые входит компонент. */
  usedInKits: string[];
}

/** Узкое место виртуального комплекта — компонент с наименьшим покрытием в днях. */
export interface KitBottleneck {
  kitSku: string;
  /** Артикул компонента с наименьшим покрытием. */
  componentSku: string;
  /** Покрытие узкого места, дней. null — скорость расхода 0, покрытие «бесконечное». */
  daysLeft: number | null;
  /** Сколько комплектов можно собрать прямо сейчас: min floor(СВОБОДНЫЙ остаток компонента ÷ норма). */
  canAssembleQty: number;
}

export interface OzonCoverageInput {
  stocks: OzonStockRow[];
  sales: OzonSalesRow[];
  skus: SKUItem[];
  clusters: OzonClusterRef[];
  settings: OzonCoverageSettings;
  /** Доступность на Моём складе по артикулу (виртуальные комплекты уже учтены вызывающей стороной). */
  myStockAvailability: Record<string, number>;
  /** Локальный зачёт по созданным заявкам; не передан — расчёт идёт как раньше. */
  pending?: OzonPendingLike;
  /** Пункт 35. Заказано на фабрике и ещё не получено, шт по артикулу. Просроченные заказы сюда не попадают. */
  factoryOnOrder?: Record<string, number>;
  /** Пункт 36. Состав комплектов; не передан — расчёт по компонентам не выполняется. */
  kits?: KitItem[];
  /** Момент расчёта; по умолчанию — текущее время. */
  now?: Date;
  /** Item 86, step D. Daily in-stock marks («История остатков Ozon»). Absent or empty — every
   *  result is byte-identical to before this item (speed by calendar days). */
  stockHistory?: OzonStockHistoryRow[];
}

export interface OzonCoverageResult {
  speed: SalesSpeedResult;
  articles: ArticleCoverage[];
  /** Пункт 36. Покрытие по компонентам виртуальных комплектов. Без input.kits — пустой массив. */
  components: ComponentCoverage[];
  /** Пункт 36. Узкие места виртуальных комплектов. Без input.kits — пустой массив. */
  bottlenecks: KitBottleneck[];
  /** Пункт 38. Тренд продаж по артикулу. */
  trends: Record<string, SalesTrend>;
}

