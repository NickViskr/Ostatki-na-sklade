export interface StockItem {
  article: string;
  quantity: number;
  avgCost: number;
  capitalization: number;
  sales120: number;
  turnover: number;
}

export interface KitComponent {
  componentSku: string;
  quantity: number;
}

export interface KitItem {
  kitSku: string;
  components: KitComponent[];
  type?: 'legacy' | 'virtual';
}

export interface Transaction {
  id: string;
  date: string;
  type: 'Приход' | 'Расход' | 'Корректировка';
  article: string;
  quantity: number;
  price: number;
  writeOffCost: number;
  total: number;
  destination: string;
  deliveryDate?: string;
  comment?: string;
  user?: string;
  groupId?: string;
  isComponent?: boolean;
  componentsTotal?: number;
}

export interface RecognitionHistoryItem {
  id: string;
  timestamp: string;
  rawText: string;
  items: ParsedItem[];
  opType: 'Приход' | 'Расход';
  uploadDestination: string;
}

export interface ParsedItem {
  article: string;
  quantity: number;
  price: number;
  status?: 'ok' | 'unknown' | 'error';
  errorMsg?: string;
}

export interface SKUItem {
  sku: string;
  price: number;
  minStock: number;
  pcsPerBox: number;
  ozonBarcode?: string;
  wbBarcode?: string;
  boxesPerPallet: number;
  volumeLiters: number;
  leadTimeDays: number;
  /** Название товара из Ozon: хранится в SKU Базе, чтобы пережить распродажу товара в ноль. */
  name?: string;
  /** Item 49. Needs a fulfilment-centre box (service «короб» on an expense). Undefined = yes. */
  needsFfBox?: boolean;
}

export interface User {
  username: string;
  role: 'admin' | 'user';
  password?: string;
}

export interface ArchivedItem {
  archiveId: string;
  type: string;
  deletedAt: number;
  dataJSON: string;
  deletedBy?: string;
}

export interface ServiceItem {
  id: string;
  name: string;
  cost: number;
  isActive: boolean;
  currentCost?: number;
}

export interface ServiceRate {
  serviceId: string;
  cost: number;
  validFrom: string;
}

export interface ExternalShipment {
  postingId: string;
  detectedAt: string;
  shipmentDate: string;
  status: 'new' | 'processed' | 'ignored' | string;
  itemsJSON: string;
  transGroupInfo: string;
  orderId?: string;
  orderNumber?: string;
  ozonStatus?: string;
  ozonStatusDate?: string;
  dropOffWarehouse?: string;
  storageWarehouse?: string;
  timeslot?: string;
  cabinet?: string;
  acceptedJSON?: string;
  recalcJSON?: string;
  peresortJSON?: string;
  /** КластерID поставки (MULTI_CLUSTER): у каждой строки свой кластер. */
  clusterId?: string;
  /** Пункт 31. Заявку создал сам Ozon: резерв не строится, списание не проводится. */
  isVirtual?: boolean;
  /** Пункт 31. Исходная поставка виртуальной заявки. Хранится только для справки. */
  originalSupplyId?: string;
  /** Item 68 stage 2. The return of the unshipped part: lines, receipt ids, when and by whom. Empty = never returned. */
  shippedJSON?: string;
}

export interface OzonStockRow {
  cabinet: string;
  sku: string;
  offerId: string;
  name: string;
  warehouseName: string;
  clusterName: string;
  clusterId: string;
  available: number;
  preparing: number;
  requested: number;
  transit: number;
  excess: number;
  returns: number;
  other: number;
  updatedAt: string;
}

export interface OzonSalesRow {
  week: string;
  cabinet: string;
  offerId: string;
  clusterName: string;
  qty: number;
  updatedAt: string;
  days: number;
}

/** Заказ партии товара у производителя. На остатки и себестоимость не влияет. */
export interface FactoryOrder {
  id: string;
  article: string;
  /** Дата размещения заказа, 'yyyy-MM-dd'. */
  orderedAt: string;
  qty: number;
  /** Ожидаемая дата прибытия, 'yyyy-MM-dd'; пустая строка — дата не задана. */
  expectedAt: string;
  comment: string;
  user: string;
  /** 'active' — партия в пути; 'received' — партия получена; 'replaced' (item 83e) — ручной
   * заказ закрыт как ДУБЛИКАТ существующего заказа из Китая того же артикула. */
  status: string;
  /** Дата отметки о получении, 'yyyy-MM-dd'. */
  receivedAt: string;
  /** Item 83: '' — ручной заказ; 'Китай' — из партии; 'Китай прогноз' — из сохранённого
   * прогноза с номером заказа, пока для него нет своей партии. */
  source: string;
  /** Item 83: номер заказа в Китае, если этот ряд создан модулем «Заказы в Китае». */
  chinaOrderNo: string;
  /** Item 83: код партии в Китае (пусто у строки прогноза — у прогноза партии ещё нет). */
  chinaBatchCode: string;
  /** Item 83: стабильный ключ строки ('B:<batchId>:<article>' / 'F:<forecastId>:<article>'),
   * по которому syncChinaFactoryOrders узнаёт СВОИ строки при повторном запуске. */
  chinaKey: string;
  /** Item 83e: владелец подтвердил, что ручной заказ — ДРУГОЙ заказ, не тот же China-заказ
   * того же артикула ('это разные заказы') — тогда оба считаются в трубе. */
  checked: boolean;
}


/**
 * Item 81, the module «Заказы в Китае». The shapes below mirror what `ChinaOrders.gs`
 * returns; every money figure in them was computed by the script, never in the browser.
 */
export interface ChinaBatchLine {
  id: string;
  batchId: string;
  /** The carrier's own marking (NV-99). It identifies goods inside ONE batch only. */
  marking: string;
  name: string;
  boxes: number;
  pcsPerBox: number;
  qty: number;
  priceCny: number;
  sumCny: number;
  pallet: string;
  palletWeightKg: number;
  /** Weight of one box, entered by hand; it beats the estimate taken from the pallets. */
  boxWeightKg: number;
  /** Item 81e: dimensions of ONE factory box, from the arrival file at the Yiwu warehouse. */
  boxLengthM: number;
  boxWidthM: number;
  boxHeightM: number;
  /** Gross weight of ONE factory box, from the arrival file — beats the pallet estimate too. */
  factoryBoxKg: number;
  weightKg: number;
  weightSource: string;
  chinaShareCny: number;
  freightShareCny: number;
  /** Item 81f: the ¥/$ figures above converted to ₽ by the script, so the browser shows both
   * without computing anything. Absent on data saved before item 81f. */
  goodsRub?: number;
  chinaShareRub?: number;
  freightShareRub?: number;
  rubShare: number;
  costRub: number;
  unitRub: number;
  article: string;
  /** Lines carrying the same marker are one product and are costed as one. */
  group: string;
  /** boxes * boxLengthM * boxWidthM * boxHeightM; 0 when the box was not measured. */
  boxVolumeM3: number;
  /** Weight of the goods of this line: qty pieces at their share of the box weight. */
  goodsKg: number;
  densityKgM3: number;
  kgPerPiece: number;
}

export interface ChinaBatchCost {
  id: string;
  batchId: string;
  date: string;
  kind: string;
  amountRub: number;
  comment: string;
  user: string;
}

/** Item 81d: rubles the owner paid and the yuan they bought. */
export interface ChinaPayment {
  id: string;
  date: string;
  amountRub: number;
  /** Rubles per yuan: stated by the owner, or worked out from the yuan the report confirmed. */
  rate: number;
  amountCny: number;
  /** 'Товар' or 'Перевозка'. */
  purpose: string;
  /** The order the payment was put against; empty until the report says where it went. */
  orderNo: string;
  confirmed: boolean;
  comment: string;
  user: string;
}

/**
 * Item 81g: money the owner paid, matched (or not yet) against a receipt of the Chinese
 * financial report — no order, no purpose any more, `saveChinaPayment` takes only date, rubles,
 * rate and comment, and `matchChinaPayment`/`unmatchChinaPayment` decide which order it feeds.
 */
export interface ChinaMoneyPayment {
  id: string;
  date: string;
  amountRub: number;
  rate: number;
  amountCny: number;
  comment: string;
  user: string;
  status: 'не распределена' | 'распределена';
  receiptId: string;
  /** What the matched receipt says the payment bought, in yuan; 0 until matched. */
  reportCny: number;
  /** amountRub / reportCny of the matched receipt; 0 until matched. */
  actualRate: number;
  /** Human sentences describing an unmatched receipt this payment could be — for the picker. */
  candidates: string[];
}

/** Item 81g: one date's worth of goods and freight the report says arrived, grouped exactly as
 * the Chinese side wrote it — the goods log and the freight settlement keep no other link. */
export interface ChinaMoneyReceipt {
  id: string;
  date: string;
  goodsCny: number;
  freightCny: number;
  freightUsd: number;
  cargoRate: number;
  totalCny: number;
  status: 'история' | 'ждёт оплату' | 'сопоставлено';
  paymentId: string;
  rubGoods: number;
  rubFreight: number;
  /** Item 89: true when `status: 'история'` came from the owner's own «это старое — в историю»
   * button, not from the report itself predating tracking — only these can be undone. */
  historyManual: boolean;
}

/** Item 81g: per order, what the report says was received and what of that is backed by an
 * actual payment at a known rate, versus history from before tracking started in August 2026. */
export interface ChinaMoneyOrder {
  orderNo: string;
  date: string;
  totalCny: number;
  receivedCny: number;
  unpaidCny: number;
  knownCny: number;
  knownRub: number;
  rate: number;
  pendingCny: number;
  historyCny: number;
  /** The owner's own rule: an advance under 30 % of the goods is worth a second look. */
  advanceWarning: boolean;
}

export interface ChinaMoneyPool {
  cny: number;
  knownCny: number;
  knownRub: number;
  pendingCny: number;
  historyCny: number;
}

export interface ChinaMoneyReportEntry {
  id: string;
  loadedAt: string;
  reportDate: string;
  source: string;
  aiReason: string;
}

/** Item 81g: the whole answer of `getChinaMoney`. */
export interface ChinaMoney {
  payments: ChinaMoneyPayment[];
  receipts: ChinaMoneyReceipt[];
  orders: ChinaMoneyOrder[];
  pool: ChinaMoneyPool;
  reports: ChinaMoneyReportEntry[];
  warnings: string[];
}

/** Item 82a: one carrier bill turned into a tariff record — `chinaTariffFromFreight`'s shape. */
export interface ChinaTariff {
  code: string;
  orderNo: string;
  shippedAt: string;
  arrivedAt: string;
  /** null when the bill has not arrived yet. */
  transitDays: number | null;
  rate: number;
  /** 'кг' or 'м³' — which unit the carrier actually billed, inferred from the bill's own total. */
  basis: string;
  weightKg: number;
  volumeM3: number;
  densityKgM3: number;
  billedUsd: number;
  amountUsd: number;
  extrasUsd: number;
  extrasPct: number;
  realPerKgUsd: number;
  reportId: string;
  updatedAt: string;
}

/** Item 82a/c: `chinaTariffPick`'s answer — which tariff a forecast is costed at, and why. */
export interface ChinaTariffPick {
  empty: boolean;
  /** Only set when `empty` is true — «нет истории тарифов». */
  message?: string;
  basis: string;
  /** The density boundary between м³- and кг-billed shipments; null with only one basis known. */
  switchDensity: number | null;
  typicalUsd: number;
  lowUsd: number;
  highUsd: number;
  /** Codes of the (up to 5) bills the typical/low/high figures were taken from. */
  codes: string[];
  n: number;
  extrasPct: number;
  transitDays: number | null;
}

/** Item 82b: one entry of `chinaBoxDirectory`, keyed by article (or marking, lacking one). */
export interface ChinaBoxEntry {
  article: string;
  name: string;
  boxLengthM: number;
  boxWidthM: number;
  boxHeightM: number;
  boxVolumeM3: number;
  boxKg: number;
  pcsPerBox: number;
  kgPerPiece: number;
  densityKgM3: number;
  priceCny: number;
  /** Number of distinct batches this article/marking was seen in. */
  batches: number;
  /** True when the box dimensions/weight/pcs differed between batches. */
  changed: boolean;
  codes: string[];
}

/** Item 82c: one line of a forecast, as computed and returned by `chinaForecastCalc`. */
export interface ChinaForecastLine {
  article: string;
  pieces: number;
  /** Absent when `warning` is set — the line took no part in any total. */
  boxes?: number;
  missingToFullBox?: number;
  kg?: number;
  m3?: number;
  goodsCny?: number;
  freightUsdTypical?: number;
  freightUsdLow?: number;
  freightUsdHigh?: number;
  domesticCny?: number;
  rubShare?: number;
  /** Coordinator fix, 2026-09-25: the ₽ equivalent of every ¥/$ figure above, computed by the
   * script (goodsCny × rubRate, domesticCny × rubRate, freightUsd… × cargoRate × rubRate) —
   * the owner's display rule («¥/$ followed by its ₽ in brackets») without the browser ever
   * multiplying a rate itself. */
  goodsRub?: number;
  domesticRub?: number;
  freightRubTypical?: number;
  freightRubLow?: number;
  freightRubHigh?: number;
  costRubTypical?: number;
  costRubLow?: number;
  costRubHigh?: number;
  costPerPieceTypical?: number;
  costPerPieceLow?: number;
  costPerPieceHigh?: number;
  /** 'нет данных о коробке' when the article has no box in the directory. */
  warning?: string;
}

export interface ChinaForecastTotals {
  /** Weight/volume of the goods themselves, from box data — NOT what the carrier bills. */
  goodsKg: number;
  goodsM3: number;
  goodsDensityKgM3: number;
  /** Coordinator fix, 2026-09-25: the CHARGEABLE (waybill) weight/volume the carrier actually
   * bills — goods figures scaled by `ChinaPackagingFactors` — is what the tariff is picked and
   * priced by, not the goods figures alone. */
  chargeableKg: number;
  chargeableM3: number;
  chargeableDensityKgM3: number;
  goodsCny: number;
  /** Coordinator fix, 2026-09-25: ₽ equivalents, summed from the already-exact per-line shares
   * (see `ChinaForecastLine`) — never an independent grand-total × rate, which could round a
   * kopeck away from the sum of its own parts. */
  goodsRub: number;
  domesticCny: number;
  domesticRub: number;
  freightUsdTypical: number;
  freightUsdLow: number;
  freightUsdHigh: number;
  freightRubTypical: number;
  freightRubLow: number;
  freightRubHigh: number;
  russianCosts: number;
  costRubTypical: number;
  costRubLow: number;
  costRubHigh: number;
}

/** Coordinator fix, 2026-09-25: how far a batch's waybill runs over its own goods figures — the
 * carrier's own packaging (pallets, dunnage) included in the waybill but not in a factory box's
 * dimensions. Median across every batch stating BOTH; 1 (no scaling) with no such batch yet. */
export interface ChinaPackagingFactors {
  weightFactor: number;
  weightFactorN: number;
  volumeFactor: number;
  volumeFactorN: number;
}

/** Item 82c: the whole answer of `calcChinaForecast`/`chinaForecastCalc`. */
export interface ChinaForecastResult {
  lines: ChinaForecastLine[];
  /** null when every line was missing its box. */
  totals: ChinaForecastTotals | null;
  pick: ChinaTariffPick;
  cargoRate: number;
  rubRate: number;
  /** e.g. «2026-08-20 CP3» — the payment `rubRate` was taken from; '' when there is none. */
  rubRateSource: string;
  packagingFactors: ChinaPackagingFactors;
  /** e.g. «нет курса: ни одной оплаты» when there is no payment to price the forecast at. */
  warnings: string[];
  /** Historic China-domestic-delivery share of goods ¥, as a percentage. */
  domesticShare: number;
  estimatedArrival: string;
}

/** Item 82d: forecast vs fact for one figure of one article. */
export interface ChinaForecastFactFigure {
  forecast: number;
  /** null when the batch has not arrived, or never costed this article at all. */
  fact: number | null;
  errorPct: number | null;
}

export interface ChinaForecastFact {
  article: string;
  pieces: ChinaForecastFactFigure;
  kg: ChinaForecastFactFigure;
  freightUsd: ChinaForecastFactFigure;
  costPerPiece: ChinaForecastFactFigure;
}

/** Item 82d: one saved forecast, with its vs-fact comparison already attached. */
export interface ChinaSavedForecast {
  id: string;
  orderNo: string;
  createdAt: string;
  user: string;
  comment: string;
  lines: { article: string; pieces: number }[];
  result: ChinaForecastResult;
  updatedAt: string;
  fact: ChinaForecastFact[];
  /** Item 83b: ожидаемая дата отгрузки с фабрики, 'yyyy-MM-dd' — вместе с орденом заказа
   * позволяет forecast-строке попасть в «Заказы на фабрике» (см. syncChinaFactoryOrders). */
  expectedShipAt: string;
}

/** Coordinator fix, 2026-09-25: the switch density/medians the tariff chart needs, computed by
 * `chinaTariffSummary` (reusing `chinaTariffPick`'s own formula) so the screen never has to run
 * a forecast first just to draw the switch line. `n` is the WHOLE bill count, unlike
 * `ChinaTariffPick.n` (the nearest-5 count of an actual pick). */
export interface ChinaTariffSummary {
  switchDensity: number | null;
  transitDays: number | null;
  extrasPct: number;
  n: number;
}

/** Item 82: the whole answer of `getChinaForecastData`. */
export interface ChinaForecastData {
  tariffs: ChinaTariff[];
  tariffSummary: ChinaTariffSummary;
  boxes: Record<string, ChinaBoxEntry>;
  forecasts: ChinaSavedForecast[];
  settings: Record<string, number | string>;
}

export interface ChinaBatch {
  id: string;
  orderNo: string;
  code: string;
  shippedAt: string;
  arrivedAt: string;
  /** Item 81e: date the goods reached the carrier's Yiwu warehouse, from the arrival file. */
  receivedAt: string;
  status: string;
  goodsCny: number;
  chinaDeliveryCny: number;
  /** Item 81f: the three lines above converted to ₽ by the script — `freightRub` is 0 when no
   * rate is known. Absent on data saved before item 81f. */
  goodsRub?: number;
  chinaDeliveryRub?: number;
  freightRub?: number;
  /** Item 82: freight per one kilogram of the batch's own goods (or, on `freightPerKgBase:
   * 'накладной'`, of the waybill weight) — 0 without a rate. Absent on data saved earlier. */
  freightPerKgUsd?: number;
  freightPerKgRub?: number;
  /** 'товара' or 'накладной' — which kilogram the carrier actually bills; '' when unknown. */
  freightPerKgBase?: string;
  weightKg: number;
  volumeM3: number;
  ratePerKgUsd: number;
  /** Item 82: `ratePerKgUsd` converted to ₽ by the script — 0 without a rate. Absent on data
   * saved earlier. The waybill's own carro tariff, as opposed to `freightPerKgUsd/Rub` below,
   * which is what the batch actually paid per kilogram once packaging and the tariff basis are
   * worked in. */
  tariffRub?: number;
  packingUsd: number;
  otherCargoUsd: number;
  freightUsd: number;
  cargoRate: number;
  freightCny: number;
  rubCosts: number;
  rubRate: number;
  /** The ₽/¥ rate the owner typed; the fallback when the order has no payments. */
  manualRate: number;
  /** 'оплаты' when the rate came from the payments of the order, 'вручную' when typed in,
   * 'предыдущая партия' when borrowed from another batch of the same order — see `rubRateFrom`. */
  rubRateSource: string;
  /** Item 81f: the code of the batch `rubRateSource: 'предыдущая партия'` borrowed its rate
   * from; '' otherwise. Absent on data saved before item 81f. */
  rubRateFrom?: string;
  /** Item 81g, owner's live check of 2026-09-25: `rubRateSource: 'последняя оплата'` names the
   * rate of the order's latest payment, used as a provisional rate before the report confirms
   * one. Text like «2026-08-20 CP3» — the payment's own date and code, read by
   * `chinaRateSourceLabel`/`chinaRateStatusText` for the short «от DD.MM» the owner sees. Absent
   * when no such rate applies. */
  rateFromPayment?: string;
  /** What the report of the Chinese side says about the order, kept at import time. */
  paidCny: number;
  unpaidCny: number;
  totalRub: number;
  /** How far the estimated weights had to be stretched to meet the waybill; null if unknown. */
  weightFactor: number | null;
  comment: string;
  user: string;
  updatedAt: string;
  lines: ChinaBatchLine[];
  costs: ChinaBatchCost[];
  /** The payments put against this batch's order. */
  payments: ChinaPayment[];
  /** Item 81e: packaging and carriage, worked out from the box measurements of the lines. */
  goodsKg: number;
  goodsVolumeM3: number;
  packagingKg: number;
  packagingM3: number;
  goodsDensity: number;
  packedDensity: number;
  /** 'кг' or 'м³' — whichever the carrier's rate actually bills; '' when unknown. */
  tariffBasis: string;
  packagingUsd: number;
  goodsFreightUsd: number;
  packagingRub: number;
  goodsFreightRub: number;
  /** Share of the freight, and of the whole batch cost, that packaging alone accounts for. */
  packagingShareFreight: number;
  packagingShareCost: number;
  goodsFreightShareCost: number;
  /** Item 81g: the two rates that used to be one — `rubRate`/`rubRateSource` above stay the
   * goods rate, kept for old code that reads them; these are the same pair for the goods and,
   * separately, for the freight, since a move between orders can leave them at different rates. */
  goodsRate?: number;
  goodsRateSource?: string;
  freightRate?: number;
  freightRateSource?: string;
  /** Item 81g: the owner's own mark that the RF-side costs (which the script cannot verify) are
   * all in. */
  rubCostsDone?: boolean;
  /** What the batch still needs for a closed cost — empty once `closed` is true. */
  missing?: string[];
  closed?: boolean;
  /** True for a batch predating the report's tracking (August 2026): no rate is missing, none
   * was ever expected. */
  history?: boolean;
  /** 'скрипт' (one tick), 'скрипт+ИИ' (two), 'ИИ' (a warning) or 'расхождение ИИ' (a cross);
   * '' when the batch predates the check. */
  checkMark?: string;
  /** The AI's own words for `checkMark` of 'ИИ' or 'расхождение ИИ'. */
  checkNote?: string;
  /** Item 89: what of the batch's own cost is still unpaid, worked out by the script from the
   * rate the batch actually has — 0 without a rate even if `remainingGoodsCny`/
   * `remainingFreightUsd` say otherwise. Absent on data saved before item 89. */
  remainingRub?: number;
  remainingGoodsCny?: number;
  remainingFreightUsd?: number;
}
