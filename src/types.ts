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
}
