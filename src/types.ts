export interface StockItem {
  article: string;
  quantity: number;
  avgCost: number;
  capitalization: number;
  sales120: number;
  turnover: number;
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
