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
  /** 'active' — партия в пути; 'received' — партия получена. */
  status: string;
  /** Дата отметки о получении, 'yyyy-MM-dd'. */
  receivedAt: string;
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
  weightKg: number;
  weightSource: string;
  chinaShareCny: number;
  freightShareCny: number;
  rubShare: number;
  costRub: number;
  unitRub: number;
  article: string;
  /** Lines carrying the same marker are one product and are costed as one. */
  group: string;
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

export interface ChinaBatch {
  id: string;
  orderNo: string;
  code: string;
  shippedAt: string;
  arrivedAt: string;
  status: string;
  goodsCny: number;
  chinaDeliveryCny: number;
  weightKg: number;
  volumeM3: number;
  ratePerKgUsd: number;
  packingUsd: number;
  otherCargoUsd: number;
  freightUsd: number;
  cargoRate: number;
  freightCny: number;
  rubCosts: number;
  rubRate: number;
  totalRub: number;
  /** How far the estimated weights had to be stretched to meet the waybill; null if unknown. */
  weightFactor: number | null;
  comment: string;
  user: string;
  updatedAt: string;
  lines: ChinaBatchLine[];
  costs: ChinaBatchCost[];
}
