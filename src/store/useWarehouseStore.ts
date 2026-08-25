import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { StockItem, Transaction, SKUItem, ParsedItem, User, ArchivedItem, ServiceItem, KitItem, KitComponent, ServiceRate, ExternalShipment, OzonStockRow, OzonSalesRow, FactoryOrder } from '../types';
import { useSettingsStore } from './useSettingsStore';
import { useUIStore } from './useUIStore';
import { parseInvoiceWithGemini } from '../lib/gemini';
import { OzonSupplyRequestRow } from '../lib/ozonPending';
import { OzonCoverageSettings, OzonClusterRef } from '../lib/ozonCoverage';
import { BatchWriteOffGroup } from '../lib/ozonBatchWriteOff';
import { toast } from 'sonner';

// Пункт 40. Капитализацию здесь обнулять НЕЛЬЗЯ: у артикула с нулевым остатком она несёт
// «долг себестоимости» — стоимость списанного брака, которая ляжет на ближайший приход.
// Раньше это правило дублировало принудительное обнуление в Code.gs; там оно снято, и если
// оставить его здесь, сервер будет хранить долг, а приложение — показывать ноль.
// Средняя себестоимость при нулевом остатке действительно ноль: она не определена.
// Item 26: два экрана и стартовая загрузка могут попросить составное чтение Ozon почти
// одновременно. Пока запрос в полёте, все получают один и тот же промис — иначе к Apps Script
// ушли бы два одинаковых запроса, и оба мимо кэша, потому что первый ещё не успел его наполнить.
// Повторный вызов ПОСЛЕ завершения запускает новое чтение — этим пользуется сохранение настроек.
let ozonInitialInFlight: Promise<boolean> | null = null;

/**
 * Item 56, stage 3. Extras a single commit needs when it is one order of a batch write-off.
 * Empty for every ordinary operation, which keeps behaving exactly as before.
 */
export interface CommitOptions {
  /** Postings of THIS order; without it the shared pending list is used. */
  postingIds?: string[];
  /** This order's share of the additional costs, in roubles. */
  additionalCosts?: number;
  /** One summary toast for the whole batch instead of one per order. */
  silent?: boolean;
  /** The supplies are reloaded once after the loop, not after every order. */
  skipShipmentsRefresh?: boolean;
}

// Роль администратора определяется одинаково в нескольких местах приложения.
const isAdminUser = (user: { role?: string; username?: string } | null | undefined): boolean => {
  if (!user) return false;
  const role = String(user.role || '').trim().toLowerCase();
  const name = String(user.username || '').trim().toLowerCase();
  return role === 'admin' || ['admin', 'админ', 'администратор'].includes(name);
};

const normalizeStock = (items: StockItem[]): StockItem[] =>
  items.map(item =>
    Number(item.quantity) <= 0
      ? { ...item, quantity: 0, avgCost: 0, turnover: 0, sales120: 0 }
      : item
  );

const expandIdsWithCascade = (ids: string[], transactions: Transaction[]): string[] => {
  const idsSet = new Set(ids);
  const mainGroupIds = new Set<string>();
  transactions.forEach(t => {
    if (idsSet.has(t.id) && !t.isComponent && t.groupId) {
      mainGroupIds.add(t.groupId);
    }
  });
  transactions.forEach(t => {
    if (t.isComponent && t.groupId && mainGroupIds.has(t.groupId)) {
      idsSet.add(t.id);
    }
  });
  return Array.from(idsSet);
};

interface WarehouseState {
  stock: StockItem[];
  transactions: Transaction[];
  skus: SKUItem[];
  services: ServiceItem[];
  serviceRates: ServiceRate[];
  usersList: User[];
  archivedItems: ArchivedItem[];
  kits: KitItem[];
  currentUser: User | null;
  sessionToken: string | null;
  isSyncing: boolean;
  isProcessing: boolean;
  isAddingSku: boolean;
  gasError: boolean;
  lastSyncTime: string | null;
  
  setGasError: (gasError: boolean) => void;
  setLastSyncTime: (time: string | null) => void;
  setStock: (stock: StockItem[]) => void;
  setTransactions: (transactions: Transaction[]) => void;
  setSkus: (skus: SKUItem[]) => void;
  setServices: (services: ServiceItem[]) => void;
  setServiceRates: (serviceRates: ServiceRate[]) => void;
  setUsersList: (users: User[]) => void;
  setCurrentUser: (user: User | null) => void;
  setSessionToken: (token: string | null) => void;
  setIsSyncing: (isSyncing: boolean) => void;
  setIsProcessing: (isProcessing: boolean) => void;
  
  hasMoreTransactions: boolean;
  setHasMoreTransactions: (hasMore: boolean) => void;
  fetchMoreTransactions: () => Promise<void>;
  
  fetchGas: (action: string, extraPayload?: any) => Promise<any>;
  fetchStock: () => Promise<void>;
  handleSetupDatabase: () => Promise<boolean>;
  handleSaveSku: (skuForm: SKUItem, editingSku: SKUItem | null) => Promise<boolean>;
  handleDeleteSku: (sku: string) => Promise<boolean>;
  handleSaveKit: (kitSku: string, components: KitComponent[], kitType?: 'legacy' | 'virtual') => Promise<boolean>;
  handleDeleteKit: (kitSku: string) => Promise<boolean>;
  handleAddService: (name: string, cost: number) => Promise<boolean>;
  handleUpdateService: (id: string, name: string, cost: number, isActive: boolean) => Promise<boolean>;
  handleDeleteService: (id: string) => Promise<boolean>;
  handleAddServiceRate: (serviceId: string, cost: number, validFrom: string) => Promise<boolean>;
  commitTransaction: (items: ParsedItem[], type: string, destination: string, deliveryDate?: string, opId?: string, options?: CommitOptions) => Promise<boolean>;
  handleDeleteTransaction: (id: string) => Promise<boolean>;
  handleDeleteMultipleTransactions: (ids: string[]) => Promise<boolean>;
  handleUpdateTransaction: (id: string, data: Transaction) => Promise<boolean>;
  handleProcessInvoice: (feedback?: any) => Promise<void>;
  
  checkSession: () => Promise<void>;
  handleLogin: (username: string, password: string) => Promise<boolean>;
  handleLogout: () => void;
  fetchUsersList: () => Promise<void>;
  handleAddUser: (username: string, password: string, role: 'admin' | 'user') => Promise<boolean>;
  handleDeleteUser: (username: string) => Promise<boolean>;
  fetchArchivedItems: () => Promise<void>;
  handleRestoreArchivedItem: (archiveId: string) => Promise<boolean>;
  handleRestoreMultipleArchivedItems: (archiveIds: string[]) => Promise<boolean>;
  handleHardDeleteArchivedItems: (archiveIds: string[]) => Promise<boolean>;
  externalShipments: ExternalShipment[];
  checkOzonShipments: () => Promise<void>;
  markExternalShipment: (postingId: string, status: 'processed' | 'ignored' | 'new', transGroupInfo?: string) => Promise<boolean>;
  /** Пункт 32. Пакетная пометка: N записей подряд, перезагрузка листа одна в самом конце. */
  markExternalShipmentsBatch: (postingIds: string[], status: 'processed' | 'ignored' | 'new', transGroupInfo?: string) => Promise<boolean>;
  saveShipmentAcceptance: (postingId: string, acceptedJSON: string) => Promise<boolean>;
  saveShipmentPeresort: (postingId: string, peresortJSON: string) => Promise<boolean>;
  commitShipmentPeresort: (postingId: string) => Promise<boolean>;
  saveShipmentShortageRecalc: (postingId: string, recalcJSON: string, historyNotes: { article: string; note: string }[]) => Promise<boolean>;
  returnLinkedOzonSupplies: (deletedIds: string[]) => Promise<void>;
  fetchExternalShipments: () => Promise<void>;
  pendingOzonPostingIds: string[];
  setPendingOzonPostingIds: (ids: string[]) => void;
  /** Item 56. Orders of a batch write-off; null for an ordinary single-order operation. */
  pendingOzonBatch: BatchWriteOffGroup[] | null;
  setPendingOzonBatch: (groups: BatchWriteOffGroup[] | null) => void;
  getEffectiveAvailability: (article: string) => number;
  getEffectiveAvgCost: (article: string) => number;
  devMode: boolean;
  setDevMode: (v: boolean) => void;
  ozonSyncStatus: { enabled: boolean; triggersCount: number; target: string; lastRun: any | null; history?: any[] } | null;
  fetchOzonSyncStatus: () => Promise<void>;
  setOzonSyncEnabled: (enabled: boolean) => Promise<void>;
  runOzonSyncNow: () => Promise<void>;
  ozonStocks: OzonStockRow[];
  ozonStocksSyncIssues: { name: string; message: string }[];
  /** Item 26 stage A1: one composite read replacing five separate start-up calls. */
  fetchOzonInitialData: () => Promise<boolean>;
  // Item 26 stage A2: Ozon settings and the cluster reference book used to live in the local state
  // of BOTH the dashboard and the «Остатки Озон» tab, and each of them fetched its own copy — the
  // same two reads twice per session. They live here now and are filled by the composite call.
  ozonSettings: OzonCoverageSettings;
  ozonSupplySettings: { maxBoxesPerCluster: number; dropOffWarehouseId: string; dropOffWarehouseName: string; dropOffWarehouseType: string };
  ozonClusterRefs: OzonClusterRef[];
  /** Сырые кластеры со служебным флагом «Уведомлён» — для сообщения о новых кластерах (пункт 29, этап D). */
  ozonClustersRaw: any[];
  /** Ответ по справочникам получен — успешно или с ошибкой. До этого расчёт покрытия не запускается. */
  ozonRefsLoaded: boolean;
  /** Item 26: стартовая загрузка данных уже запущена — чтобы не выстрелить её дважды. */
  bootFetchStarted: boolean;
  fetchOzonStocks: () => Promise<void>;
  runOzonStocksSync: () => Promise<void>;
  ozonSales: OzonSalesRow[];
  fetchOzonSales: () => Promise<void>;
  ozonSupplyRequests: OzonSupplyRequestRow[];
  fetchOzonSupplyRequests: () => Promise<void>;
  factoryOrders: FactoryOrder[];
  fetchFactoryOrders: () => Promise<void>;
  saveFactoryOrder: (order: { id?: string; article: string; qty: number; expectedAt: string; orderedAt?: string; comment?: string }) => Promise<boolean>;
  setFactoryOrderReceived: (id: string) => Promise<boolean>;
  /** Пункт 35. Отмена заказа на фабрике: строка удаляется на сервере безвозвратно. */
  cancelFactoryOrder: (id: string) => Promise<boolean>;
  /** Пункт 35. Цена и дата последнего поступления по артикулу. Ключ — артикул. */
  lastPurchasePrices: Record<string, { price: number; date: string }>;
  fetchLastPurchasePrices: () => Promise<void>;
}

export const useWarehouseStore = create<WarehouseState>()(
  persist(
    (set, get) => ({
  stock: [],
  transactions: [],
  lastPurchasePrices: {},
  skus: [],
  services: [],
  serviceRates: [],
  usersList: [],
  archivedItems: [],
  kits: [],
  currentUser: null,
  sessionToken: null,
  isSyncing: false,
  isProcessing: false,
  isAddingSku: false,
  gasError: false,
  lastSyncTime: null,
  hasMoreTransactions: false,
  externalShipments: [],
  pendingOzonPostingIds: [],
  pendingOzonBatch: null,
  devMode: typeof localStorage !== 'undefined' && localStorage.getItem('devMode') === 'true',
  ozonSyncStatus: null,
  ozonStocks: [],
  ozonStocksSyncIssues: [],
  ozonSales: [],
  ozonSupplyRequests: [],
  factoryOrders: [],
  ozonSettings: {
    speedWeeks: 4,
    minStockDays: 7,
    targetStockDays: 30,
    factoryOrderDays: 60,
    returnsToSalePct: 80,
    excludedClusters: '',
    priorityClusters: '',
    deficitDays: 7,
    trendWeeks: 13,
    bestWeeks: 4,
    minSalesForCorrection: 50,
    maxSpeedGrowth: 5,
    salesGrowthPct: 0,
  },
  ozonSupplySettings: { maxBoxesPerCluster: 30, dropOffWarehouseId: '', dropOffWarehouseName: '', dropOffWarehouseType: '' },
  ozonClusterRefs: [],
  ozonClustersRaw: [],
  ozonRefsLoaded: false,
  bootFetchStarted: false,

  getEffectiveAvailability: (article) => {
    const kits = get().kits;
    const virtualKit = kits.find(k => k.kitSku === article && k.type === 'virtual');
    if (virtualKit) {
      if (!virtualKit.components || virtualKit.components.length === 0) {
        return 0;
      }
      let minAvail = Infinity;
      for (const comp of virtualKit.components) {
        const stockItem = get().stock.find(s => s.article === comp.componentSku);
        const stockQty = stockItem ? Number(stockItem.quantity) : 0;
        const norm = Number(comp.quantity) || 1;
        const avail = Math.floor(stockQty / norm);
        if (avail < minAvail) {
          minAvail = avail;
        }
      }
      return minAvail === Infinity ? 0 : minAvail;
    } else {
      const stockItem = get().stock.find(s => s.article === article);
      return stockItem ? Number(stockItem.quantity) : 0;
    }
  },

  getEffectiveAvgCost: (article) => {
    const kits = get().kits;
    const virtualKit = kits.find(k => k.kitSku === article && k.type === 'virtual');
    if (virtualKit) {
      if (!virtualKit.components || virtualKit.components.length === 0) {
        return 0;
      }
      let sum = 0;
      for (const comp of virtualKit.components) {
        const stockItem = get().stock.find(s => s.article === comp.componentSku);
        const avgCost = stockItem ? Number(stockItem.avgCost) : 0;
        const norm = Number(comp.quantity) || 0;
        sum += avgCost * norm;
      }
      return sum;
    } else {
      const stockItem = get().stock.find(s => s.article === article);
      return stockItem ? Number(stockItem.avgCost) : 0;
    }
  },

  setPendingOzonPostingIds: (pendingOzonPostingIds) => set({ pendingOzonPostingIds }),
  setPendingOzonBatch: (pendingOzonBatch) => set({ pendingOzonBatch }),
  setHasMoreTransactions: (hasMoreTransactions) => set({ hasMoreTransactions }),
  
  setGasError: (gasError) => set({ gasError }),
  setLastSyncTime: (lastSyncTime) => set({ lastSyncTime }),
  setStock: (stock) => set({ stock }),
  setTransactions: (transactions) => set({ transactions }),
  setSkus: (skus) => set({ skus }),
  setServices: (services) => set({ services }),
  setServiceRates: (serviceRates) => set({ serviceRates }),
  setUsersList: (usersList) => set({ usersList }),
  setCurrentUser: (currentUser) => set({ currentUser }),
  setSessionToken: (sessionToken) => set({ sessionToken }),
  setIsSyncing: (isSyncing) => set({ isSyncing }),
  setIsProcessing: (isProcessing) => set({ isProcessing }),
  setDevMode: (v) => {
    localStorage.setItem('devMode', v ? 'true' : 'false');
    set({ devMode: v });
    get().fetchStock();
    get().fetchArchivedItems();
  },

  fetchGas: async (action, extraPayload = {}) => {
    const sessionToken = get().sessionToken;
    const role = get().currentUser?.role?.toLowerCase() || '';
    const isAdminRole = role === 'admin' || role === 'администратор';
    const authActions = ['login', 'logout', 'verifySession'];
    const sendDevMode = get().devMode && isAdminRole && !authActions.includes(action);
    
    try {
      const response = await fetch('/api/gas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, sessionToken, ...(sendDevMode ? { devMode: true } : {}), ...extraPayload })
      });
      
      if (!response.ok) {
        set({ gasError: true });
        return { status: 'error', message: `Ошибка HTTP ${response.status}` };
      }

      const text = await response.text();
      try {
        const json = JSON.parse(text);
        if (json.status === 'error' && typeof json.message === 'string' &&
          json.message.includes('Недействительная сессия')
        ) {
          sessionStorage.removeItem('sessionToken');
          localStorage.removeItem('sessionToken');
          set({ sessionToken: null, currentUser: null });
        } else {
          set({ gasError: false });
        }
        return json;
      } catch (e) {
        set({ gasError: true });
        if (text.includes('<!DOCTYPE html>')) {
          return { status: 'error', message: 'GAS вернул HTML (возможно, ошибка в коде скрипта или нет доступа)' };
        }
        return { status: 'error', message: 'Ответ сервера не является JSON' };
      }
    } catch (e) {
      set({ gasError: true });
      return { status: 'error', message: `Ошибка сети: ${(e as Error).message}` };
    }
  },

  fetchStock: async () => {
    set({ isSyncing: true });
    try {
      const result = await get().fetchGas('getInitialData');

      if (result.status === 'success') {
        const data = result.data;
        let parsedKits: KitItem[] = [];
        if (data.kits) {
          parsedKits = Object.entries(data.kits as Record<string, { type?: 'legacy' | 'virtual', components: KitComponent[] }>).map(
            ([kitSku, kitData]) => ({
              kitSku,
              components: kitData.components || [],
              type: kitData.type || 'legacy'
            })
          );
        }

        let loadedRates: ServiceRate[] = [];
        try {
          const ratesResult = await get().fetchGas('getServiceRates');
          if (ratesResult.status === 'success' && Array.isArray(ratesResult.data)) {
            loadedRates = ratesResult.data;
          }
        } catch (e) {
          console.error("Failed to load service rates:", e);
        }

        set({
          stock: normalizeStock(data.stock || []),
          skus: data.skus || [],
          services: data.services || [],
          serviceRates: loadedRates,
          kits: parsedKits,
          transactions: Array.isArray(data.transactions) ? data.transactions : (data.transactions?.rows || []),
          hasMoreTransactions: !Array.isArray(data.transactions) && typeof data.transactions?.hasMore === 'boolean' ? data.transactions.hasMore : false,
          lastSyncTime: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
        });
      } else {
        toast.error("Ошибка загрузки данных: " + result.message);
      }
    } catch (error) {
      console.error("Fetch Error:", error);
    } finally {
      set({ isSyncing: false });
    }
  },

  fetchMoreTransactions: async () => {
    const currentCount = get().transactions.length;
    set({ isSyncing: true });
    try {
      const result = await get().fetchGas('getTransactions', {
        data: { offset: currentCount, limit: 100 }
      });
      if (result.status === 'success' && result.data) {
         set(state => ({ 
           transactions: [...state.transactions, ...(result.data.rows || [])],
           hasMoreTransactions: result.data.hasMore || false
         }));
      }
    } catch (e) {
      console.error(e);
    } finally {
      set({ isSyncing: false });
    }
  },

  handleSetupDatabase: async () => {
    set({ isSyncing: true });
    try {
      const result = await get().fetchGas('setup');
      if (result.status === 'success') {
        toast.success('База данных успешно инициализирована!');
        set({ stock: [], transactions: [], skus: [], services: [] });
        return true;
      } else {
        toast.error('Ошибка инициализации: ' + result.message);
        return false;
      }
    } catch (error) {
      console.error("Setup Error:", error);
      toast.error('Ошибка сети при инициализации базы данных. Проверьте URL и доступ.');
      return false;
    } finally {
      set({ isSyncing: false });
    }
  },

  handleSaveSku: async (skuForm, editingSku) => {
    if (!skuForm.sku) return false;
    
    set({ isAddingSku: true });
    try {
      const result = await get().fetchGas(editingSku ? 'updateSku' : 'addSku', {
        data: skuForm,
        oldSku: editingSku?.sku
      });
      if (result.status === 'success') {
        if (editingSku) {
          set({ skus: result.data.skus, stock: result.data.stock });
          toast.success('SKU успешно обновлен');
        } else {
          set({ skus: result.data });
          toast.success('Новый SKU добавлен');
        }
        return true;
      } else {
        toast.error('Ошибка: ' + result.message);
        return false;
      }
    } catch (error) {
      console.error("SKU Error:", error);
      toast.error('Ошибка сети при сохранении SKU.');
      return false;
    } finally {
      set({ isAddingSku: false });
    }
  },

  handleDeleteSku: async (sku) => {
    set({ isSyncing: true });
    try {
      const result = await get().fetchGas('deleteSku', { sku });
      if (result.status === 'success') {
        set({ skus: result.data });
        toast.success('SKU удален');
        return true;
      } else {
        toast.error('Ошибка при удалении: ' + result.message);
        return false;
      }
    } catch (error) {
      console.error("Delete SKU Error:", error);
      toast.error('Ошибка сети при удалении SKU.');
      return false;
    } finally {
      set({ isSyncing: false });
    }
  },

  handleSaveKit: async (kitSku, components, kitType) => {
    set({ isProcessing: true });
    try {
      const result = await get().fetchGas('saveKit', {
        data: { kitSku, components, kitType }
      });
      if (result?.status === 'success') {
        set(state => {
          const rest = state.kits.filter(k => k.kitSku !== kitSku);
          return {
            kits: components.length > 0
              ? [...rest, { kitSku, components, type: kitType || 'legacy' }]
              : rest
          };
        });
        toast.success(
          components.length > 0 ? 'Комплект сохранён' : 'Комплект удалён'
        );
        return true;
      }
      toast.error(result?.message || 'Ошибка сохранения');
      return false;
    } catch {
      toast.error('Сбой сети');
      return false;
    } finally {
      set({ isProcessing: false });
    }
  },

  handleDeleteKit: async (kitSku) => {
    return get().handleSaveKit(kitSku, []);
  },

  handleAddService: async (name, cost) => {
    set({ isSyncing: true });
    try {
      const result = await get().fetchGas('addService', { data: { name, cost } });
      if (result.status === 'success') {
        set({ services: result.data });
        toast.success('Услуга добавлена');
        return true;
      } else {
        toast.error('Ошибка: ' + result.message);
        return false;
      }
    } catch (error) {
      toast.error('Ошибка сети при добавлении услуги.');
      return false;
    } finally {
      set({ isSyncing: false });
    }
  },

  handleUpdateService: async (id, name, cost, isActive) => {
    set({ isSyncing: true });
    try {
      const result = await get().fetchGas('updateService', { id, data: { name, cost, isActive } });
      if (result.status === 'success') {
        set({ services: result.data });
        toast.success('Услуга обновлена');
        return true;
      } else {
        toast.error('Ошибка: ' + result.message);
        return false;
      }
    } catch (error) {
      toast.error('Ошибка сети при обновлении услуги.');
      return false;
    } finally {
      set({ isSyncing: false });
    }
  },

  handleDeleteService: async (id) => {
    // Optimistically hide the service immediately so UI updates without waiting for server
    set(state => ({
      services: state.services.map(s => s.id === id ? { ...s, isActive: false } : s)
    }));
    set({ isSyncing: true });
    try {
      const service = get().services.find(s => s.id === id);
      if (!service) return false;
      const result = await get().fetchGas('deleteService', { id, data: { name: service.name, cost: service.cost } });
      if (result.status === 'success') {
        set({ services: result.data });
        toast.success('Услуга удалена');
        return true;
      } else {
        toast.error('Ошибка: ' + result.message);
        return false;
      }
    } catch (error) {
      toast.error('Ошибка сети при удалении услуги.');
      return false;
    } finally {
      set({ isSyncing: false });
    }
  },

  handleAddServiceRate: async (serviceId, cost, validFrom) => {
    set({ isSyncing: true });
    try {
      const result = await get().fetchGas('addServiceRate', {
        data: { serviceId, cost, validFrom }
      });
      if (result.status === 'success') {
        set({ serviceRates: result.data });
        toast.success('Тариф успешно добавлен');
        return true;
      } else {
        toast.error('Ошибка: ' + result.message);
        return false;
      }
    } catch (error) {
      toast.error('Ошибка сети при добавлении тарифа.');
      return false;
    } finally {
      set({ isSyncing: false });
    }
  },

  commitTransaction: async (items, type, destination, deliveryDate = '', opId = '', options) => {
    // Пункт 28, этап C: список поставок Ozon фиксируется в начале операции
    // и уходит на сервер вместе с расходом, а не отдельными запросами после него.
    // Item 56, stage 3. A batch write-off commits one expense per Ozon order, so the postings
    // and the money cannot come from the shared store field — each call states its own.
    const postingIds = options?.postingIds ?? get().pendingOzonPostingIds;
    const { notificationEmail } = useSettingsStore.getState();

    // Пункт 33, этап A: приход на виртуальный комплект запрещён.
    // У виртуального комплекта нет собственного остатка: доступность считается
    // как минимум остатка компонента, делённый на норму. Проведённый приход
    // не изменит доступность, но испортит капитализацию на артикуле,
    // который в расходе не участвует.
    if (type === 'Приход' || type === 'Корректировка') {
      for (const item of items) {
        if (!item.article) continue;
        const virtualKitOnIncome = get().kits.find(k => k.kitSku === item.article && k.type === 'virtual');
        if (virtualKitOnIncome) {
          const compList = virtualKitOnIncome.components
            .map(c => `${c.componentSku} x${Number(c.quantity) || 1}`)
            .join(', ');
          toast.error(`Нельзя оприходовать виртуальный комплект «${item.article}»: у него нет собственного остатка. Оприходуйте компоненты: ${compList}`);
          return false;
        }
      }
    }
    
    if (type === 'Расход') {
      const requiredQtys: Record<string, number> = {};
      
      for (const item of items) {
        if (!item.article) continue;
        requiredQtys[item.article] = (requiredQtys[item.article] || 0) + (Number(item.quantity) || 0);
      }

      for (const [article, reqQty] of Object.entries(requiredQtys)) {
        const availableQty = get().getEffectiveAvailability(article);
        
        if (reqQty > availableQty) {
          toast.error(`Недостаточно товара "${article}". Доступно: ${availableQty}, требуется: ${reqQty}`);
          return false;
        }
      }

      // Агрегированная проверка компонентов виртуальных комплектов
      const requiredComponents: Record<string, number> = {};
      for (const [article, reqQty] of Object.entries(requiredQtys)) {
        const virtualKit = get().kits.find(k => k.kitSku === article && k.type === 'virtual');
        if (virtualKit) {
          for (const comp of virtualKit.components) {
            const compSku = comp.componentSku;
            const norm = Number(comp.quantity) || 0;
            requiredComponents[compSku] = (requiredComponents[compSku] || 0) + (norm * reqQty);
          }
        }
      }

      for (const [compSku, reqCompQty] of Object.entries(requiredComponents)) {
        const stockItem = get().stock.find(s => s.article === compSku);
        const availableCompQty = stockItem ? Number(stockItem.quantity) : 0;
        if (reqCompQty > availableCompQty) {
          toast.error(`Недостаточно компонента "${compSku}": нужно ${reqCompQty}, есть ${availableCompQty}`);
          return false;
        }
      }
    }

    set({ isProcessing: true });
    try {
      const result = await get().fetchGas('commit', {
        opId,
        postingIds,
        data: items, 
        type, 
        destination,
        deliveryDate,
        notificationEmail,
        // Item 56, stage 3: stated as a number so the server does not read the batch total
        // out of the destination text and charge it to this order in full.
        ...(options?.additionalCosts === undefined ? {} : { additionalCosts: options.additionalCosts })
      });
      
      if (result.status === 'success') {
        const payloadData = result.data;
        const newStock = payloadData.stock || payloadData; // fallback if old backend
        
        set((state) => {
          const uniqueMap = new Map<string, Transaction>();
          state.transactions.forEach((tx) => uniqueMap.set(tx.id, tx));
          if (payloadData.newTransactions) {
            payloadData.newTransactions.forEach((tx: Transaction) => uniqueMap.set(tx.id, tx));
          }
          return {
            stock: normalizeStock(Array.isArray(newStock) ? newStock : []),
            transactions: Array.from(uniqueMap.values()),
            skus: payloadData.skus || state.skus
          };
        });
        
        if (!options?.silent) {
          if (payloadData.idempotentHit) {
            toast.success('Эта операция уже была записана ранее — повтор не создан');
          } else {
            toast.success('Операция успешно записана в Google Таблицу!');
          }
        }
        
        // Пункт 28, этап C: привязку поставок выполнил сервер внутри той же операции.
        // Здесь только разбираем результат и предупреждаем, если связь сохранилась не полностью.
        if (postingIds.length > 0) {
          const link = payloadData.postingsLink;
          const linkedCount = link && typeof link.linked === 'number' ? link.linked : 0;
          if (linkedCount < postingIds.length) {
            toast.error(
              'Расход записан, но привязка заявки Ozon сохранена не полностью (' +
              linkedCount + ' из ' + postingIds.length +
              '). Откройте вкладку «Поставки Озон» и привяжите заявку кнопкой «Привязать как дубль».',
              { duration: 15000 }
            );
          }
          set({ pendingOzonPostingIds: [] });
          // A batch refreshes the supplies once after the whole loop, not after every order.
          if (!options?.skipShipmentsRefresh) await get().fetchExternalShipments();
        }
        
        // No background fetches needed anymore since we returned all affected data!
        
        return true;
      } else {
        toast.error("Ошибка сервера: " + result.message);
        return false;
      }
    } catch (error) {
      console.error("Commit Error:", error);
      toast.error("Ошибка сети. Проверьте URL и настройки доступа GAS.");
      return false;
    } finally {
      set({ isProcessing: false });
    }
  },

  handleDeleteTransaction: async (id) => {
    const transactions = get().transactions;
    const expandedIds = expandIdsWithCascade([id], transactions);
    
    if (expandedIds.length > 1) {
      return get().handleDeleteMultipleTransactions(expandedIds);
    }

    set({ isProcessing: true });
    try {
      const result = await get().fetchGas('deleteTransaction', { id });
      if (result.status === 'success') {
        const txData = result.data?.transactions;
        const txRows = Array.isArray(txData) ? txData : (txData?.rows || []);
        
        set((state) => {
          const uniqueMap = new Map<string, Transaction>();
          state.transactions.filter(t => t.id !== id).forEach(t => uniqueMap.set(t.id, t));
          txRows.filter((t: Transaction) => t.id !== id).forEach((t: Transaction) => uniqueMap.set(t.id, t));
          return {
            stock: normalizeStock(result.data?.stock || state.stock),
            transactions: Array.from(uniqueMap.values())
          };
        });
        
        toast.success('Операция удалена');
        await get().returnLinkedOzonSupplies([id]);
        return true;
      } else {
        toast.error('Ошибка: ' + result.message);
        return false;
      }
    } catch (e) {
      console.error(e);
      toast.error('Ошибка сети при удалении операции');
      return false;
    } finally {
      set({ isProcessing: false });
    }
  },

  handleDeleteMultipleTransactions: async (ids) => {
    const transactions = get().transactions;
    const expandedIds = expandIdsWithCascade(ids, transactions);

    set({ isProcessing: true });
    try {
      const result = await get().fetchGas('deleteMultipleTransactions', { ids: expandedIds });
      if (result.status === 'success' || result.data?.partial) {
        const payloadData = result.status === 'success' ? result.data : result.data;
        const txData = payloadData.transactions;
        const txRows = Array.isArray(txData) ? txData : (txData.rows || []);
        
        set((state) => {
          const uniqueMap = new Map<string, Transaction>();
          state.transactions.filter(t => !expandedIds.includes(t.id)).forEach(t => uniqueMap.set(t.id, t));
          txRows.filter((t: Transaction) => !expandedIds.includes(t.id)).forEach((t: Transaction) => uniqueMap.set(t.id, t));
          return {
            stock: normalizeStock(payloadData.stock || state.stock),
            transactions: Array.from(uniqueMap.values())
          };
        });
        
        if (payloadData.partial && payloadData.message) {
           toast.warning(payloadData.message);
        } else {
           toast.success(`Удалено операций: ${expandedIds.length}`);
        }
        await get().returnLinkedOzonSupplies(expandedIds);
        return true;
      } else {
        toast.error('Ошибка: ' + result.message);
        return false;
      }
    } catch (e) {
      console.error(e);
      toast.error('Ошибка сети при удалении операций');
      return false;
    } finally {
      set({ isProcessing: false });
    }
  },

  handleUpdateTransaction: async (id, data) => {
    set({ isProcessing: true });
    try {
      const result = await get().fetchGas('updateTransaction', { id, data });
      if (result.status === 'success') {
        const payloadData = result.data;
        const newStock = normalizeStock(Array.isArray(payloadData.stock) ? payloadData.stock : (Array.isArray(payloadData) ? payloadData : []));
        
        set((state) => {
          let updatedTransactions: Transaction[];
          if (payloadData && Array.isArray(payloadData.newTransactions)) {
            updatedTransactions = payloadData.newTransactions;
          } else {
            const uniqueMap = new Map<string, Transaction>();
            // Remove old ID from the list
            state.transactions.filter(t => t.id !== id).forEach(t => uniqueMap.set(t.id, t));
            // Integrate the server's up-to-date active transaction list
            if (payloadData && payloadData.newTransactions) {
              payloadData.newTransactions.forEach((tx: Transaction) => uniqueMap.set(tx.id, tx));
            }
            updatedTransactions = Array.from(uniqueMap.values());
          }
          return {
            stock: newStock,
            transactions: updatedTransactions,
            skus: payloadData.skus || state.skus
          };
        });
        
        toast.success('Операция обновлена');
        
        return true;
      } else {
        toast.error('Ошибка: ' + result.message);
        return false;
      }
    } catch (e) {
      console.error(e);
      toast.error('Ошибка сети при обновлении операции');
      return false;
    } finally {
      set({ isProcessing: false });
    }
  },

  handleProcessInvoice: async (feedback = "") => {
    const { rawText, opType, setParsedItems, setShowConfirmModal, aiFeedback } = useUIStore.getState();
    const { geminiModel, geminiKey, customPrompt } = useSettingsStore.getState();
    const { stock, skus } = get();

    if (!rawText.trim()) return;
    
    set({ isProcessing: true });
    try {
      const skuMap = new Map();
      stock.forEach(s => skuMap.set(s.article, { sku: s.article, ozonBarcode: '', wbBarcode: '' }));
      skus.forEach(s => skuMap.set(s.sku, { sku: s.sku, ozonBarcode: s.ozonBarcode || '', wbBarcode: s.wbBarcode || '' }));
      const skuMapping = Array.from(skuMap.values());
      
      const feedbackStr = (typeof feedback === 'string' && feedback) ? feedback : aiFeedback;
      const result = await parseInvoiceWithGemini(get().sessionToken || '', rawText, skuMapping, opType, geminiModel, feedbackStr, customPrompt);
      const items = result.items || [];
      const detectedMarketplace = result.detectedMarketplace || 'unknown';
      
      if (!Array.isArray(items) || items.length === 0) {
        toast.error("ИИ не смог распознать товары в этом тексте. Попробуйте другой файл или уточните запрос.");
        return;
      }

      const validated = items.map((item: any) => {
        const stockItem = stock.find(s => s.article === item.article);
        let status: 'ok' | 'unknown' | 'error' = 'ok';
        let errorMsg = '';
        let article = item.article;

        if (opType === 'Приход') {
          if (article === 'UNKNOWN' || !stockItem) {
            status = 'ok';
            errorMsg = 'Новый товар';
          }
        } else {
          const isVirtualKit = get().kits.some(k => k.kitSku === article && k.type === 'virtual');
          if (article === 'UNKNOWN' || (!stockItem && !isVirtualKit)) {
            status = 'unknown';
            errorMsg = 'Артикул не найден';
          } else {
            item.price = get().getEffectiveAvgCost(article);
            if (get().getEffectiveAvailability(article) < item.quantity) {
              status = 'error';
              errorMsg = 'Недостаточно на складе';
            }
          }
        }

        return { ...item, article, status, errorMsg };
      });

      setParsedItems(validated);
      
      const { uploadDestination, setShowMismatchModal, setMismatchData } = useUIStore.getState();
      
      useUIStore.getState().addRecognitionHistory({
        id: Date.now().toString(),
        timestamp: new Date().toISOString(),
        rawText,
        items: validated,
        opType,
        uploadDestination
      });

      if (detectedMarketplace !== "unknown" && opType === 'Расход' && detectedMarketplace !== uploadDestination) {
        setMismatchData({ detected: detectedMarketplace, selected: uploadDestination });
        setShowMismatchModal(true);
      } else {
        setShowConfirmModal(true);
      }
    } catch (e: any) {
      console.error(e);
      const details = e.details;
      if (details) {
        if (details.stage === "no_api_key") {
          toast.error("API ключ Gemini не настроен (Настройки)");
        } else if (details.httpStatus === 404) {
          toast.error(`Модель ${details.model} не найдена — выберите другую модель в Настройках`);
        } else if (details.httpStatus === 429) {
          toast.error("Превышен лимит запросов Gemini, подождите минуту");
        } else if (details.stage === "json_parse") {
          toast.error("Модель вернула невалидный JSON");
          console.error(details.rawError);
        } else {
          toast.error('Ошибка при обработке Gemini: ' + (e.message || String(e)));
        }
      } else {
        toast.error('Ошибка при обработке Gemini: ' + (e.message || String(e)));
      }
    } finally {
      set({ isProcessing: false });
    }
  },

  checkSession: async () => {
    let token = get().sessionToken;
    if (!token) {
      token = sessionStorage.getItem('sessionToken') || localStorage.getItem('sessionToken');
      if (!token) return;
      set({ sessionToken: token });
    }
    // Item 26 (2026-08-20): раньше приложение ждало ответа verifySession (около 3 секунд) и только
    // потом начинало грузить данные — каждая следующая волна запросов упиралась в предыдущую.
    // Ждать незачем: токен уже лежит в браузере и в хранилище, и все читающие действия всё равно
    // проверяют сессию на стороне Apps Script. Поэтому чтения стартуют СРАЗУ, параллельно с
    // проверкой. Если сессия окажется недействительной, эти запросы просто вернут ошибку, их
    // обработчики её только логируют, а токен всё равно будет стёрт ниже по этой же функции.
    // Признак bootFetchStarted не даёт выстрелить теми же чтениями второй раз из эффекта в App.
    if (!get().bootFetchStarted) {
      set({ bootFetchStarted: true });
      void get().fetchStock();
      // Роль сохраняется между перезагрузками вместе с токеном, поэтому она известна ещё до
      // ответа verifySession. Для администратора сразу запускается и составное чтение Ozon —
      // это самый долгий запрос страницы, и раньше он ждал проверку сессии зря. Если роль
      // в сохранённых данных окажется неверной, экран всё равно закажет чтение сам.
      if (isAdminUser(get().currentUser)) {
        void get().fetchOzonInitialData();
      }
    }

    try {
      const result = await get().fetchGas('verifySession');
      if (result.status === 'success') {
        const normalizedUser = {
          ...result.data,
          role: result.data.role?.trim().toLowerCase()
        };
        set({ currentUser: normalizedUser });
        
        // Fetch global settings
        get().fetchGas('getGlobalSettings').then(res => {
          if (res.status === 'success') {
            useSettingsStore.getState().setGeminiKey(res.data.geminiKey || '');
            useSettingsStore.getState().setGeminiModel(res.data.geminiModel || 'gemini-1.5-flash');
            useSettingsStore.getState().setOzonClientId(res.data.ozonClientId || '');
            useSettingsStore.getState().setOzonApiKey(res.data.ozonApiKey || '');
            useSettingsStore.getState().setOzonCabinets(Array.isArray(res.data.ozonCabinets) ? res.data.ozonCabinets : []);
            useSettingsStore.getState().setOzonCabinetNames(Array.isArray(res.data.ozonCabinetNames) ? res.data.ozonCabinetNames : []);
            if (res.data.storageRatePerLiterDay !== undefined) {
              useSettingsStore.getState().setStorageRatePerLiterDay(Number(res.data.storageRatePerLiterDay) || 0);
            }
            if (res.data.boxesPerPalletGlobal !== undefined) {
              useSettingsStore.getState().setBoxesPerPalletGlobal(Number(res.data.boxesPerPalletGlobal) || 0);
            }
            if (res.data.serviceOrder) {
              try {
                const orderStr = typeof res.data.serviceOrder === 'string' ? res.data.serviceOrder : JSON.stringify(res.data.serviceOrder);
                useSettingsStore.getState().setServiceOrderIds(JSON.parse(orderStr));
              } catch (e) {}
            }
          }
        });
      } else {
        sessionStorage.removeItem('sessionToken');
        localStorage.removeItem('sessionToken');
        set({ sessionToken: null, currentUser: null });
      }
    } catch (e) {
      console.error('Session verification failed', e);
    }
  },

  handleLogin: async (username, password) => {
    set({ isProcessing: true });
    try {
      const result = await get().fetchGas('login', { username, password });
      if (result.status === 'success') {
        const userData = result.data.user || result.data; // Handle both formats just in case
        const normalizedUser = {
          ...userData,
          role: userData.role?.trim().toLowerCase()
        };
        
        if (result.data.sessionToken) {
          sessionStorage.setItem('sessionToken', result.data.sessionToken);
          localStorage.setItem('sessionToken', result.data.sessionToken);
        }
        
        set({ 
          currentUser: normalizedUser,
          sessionToken: result.data.sessionToken || null
        });
        
        // Fetch global settings
        get().fetchGas('getGlobalSettings').then(res => {
          if (res.status === 'success') {
            useSettingsStore.getState().setGeminiKey(res.data.geminiKey || '');
            useSettingsStore.getState().setGeminiModel(res.data.geminiModel || 'gemini-1.5-flash');
            useSettingsStore.getState().setOzonClientId(res.data.ozonClientId || '');
            useSettingsStore.getState().setOzonApiKey(res.data.ozonApiKey || '');
            useSettingsStore.getState().setOzonCabinets(Array.isArray(res.data.ozonCabinets) ? res.data.ozonCabinets : []);
            useSettingsStore.getState().setOzonCabinetNames(Array.isArray(res.data.ozonCabinetNames) ? res.data.ozonCabinetNames : []);
            if (res.data.storageRatePerLiterDay !== undefined) {
              useSettingsStore.getState().setStorageRatePerLiterDay(Number(res.data.storageRatePerLiterDay) || 0);
            }
            if (res.data.boxesPerPalletGlobal !== undefined) {
              useSettingsStore.getState().setBoxesPerPalletGlobal(Number(res.data.boxesPerPalletGlobal) || 0);
            }
            if (res.data.serviceOrder) {
              try {
                const orderStr = typeof res.data.serviceOrder === 'string' ? res.data.serviceOrder : JSON.stringify(res.data.serviceOrder);
                useSettingsStore.getState().setServiceOrderIds(JSON.parse(orderStr));
              } catch (e) {}
            }
          }
        });
        
        toast.success('Успешный вход');
        return true;
      } else {
        toast.error('Ошибка входа: ' + result.message);
        return false;
      }
    } catch (e) {
      console.error(e);
      toast.error('Ошибка сети при входе');
      return false;
    } finally {
      set({ isProcessing: false });
    }
  },

  handleLogout: () => {
    const token = get().sessionToken;
    if (token) {
      get().fetchGas('logout').catch(() => {});
    }
    sessionStorage.removeItem('sessionToken');
    localStorage.removeItem('sessionToken');
    set({ currentUser: null, sessionToken: null, stock: [], transactions: [], skus: [], usersList: [] });
    useUIStore.getState().setActiveTab('dashboard');
  },

  fetchUsersList: async () => {
    set({ isSyncing: true });
    try {
      const result = await get().fetchGas('getUsers');
      if (result.status === 'success') {
        const normalizedUsers = result.data.map((u: User) => ({
          ...u,
          role: u.role?.trim().toLowerCase()
        }));
        set({ usersList: normalizedUsers });
      }
    } catch (e) {
      console.error(e);
    } finally {
      set({ isSyncing: false });
    }
  },

  handleAddUser: async (username, password, role) => {
    set({ isProcessing: true });
    try {
      const result = await get().fetchGas('addUser', { data: { username, password, role } });
      if (result.status === 'success') {
        set({ usersList: result.data });
        toast.success('Пользователь добавлен');
        return true;
      } else {
        toast.error('Ошибка: ' + result.message);
        return false;
      }
    } catch (e) {
      console.error(e);
      toast.error('Ошибка сети при добавлении пользователя');
      return false;
    } finally {
      set({ isProcessing: false });
    }
  },

  handleDeleteUser: async (username) => {
    set({ isProcessing: true });
    try {
      const result = await get().fetchGas('deleteUser', { username });
      if (result.status === 'success') {
        set({ usersList: result.data });
        toast.success('Пользователь удален');
        return true;
      } else {
        toast.error('Ошибка: ' + result.message);
        return false;
      }
    } catch (e) {
      console.error(e);
      toast.error('Ошибка сети при удалении пользователя');
      return false;
    } finally {
      set({ isProcessing: false });
    }
  },

  fetchArchivedItems: async () => {
    set({ isSyncing: true });
    try {
      const result = await get().fetchGas('getArchivedItems');
      if (result.status === 'success') {
        set({ archivedItems: result.data });
      } else {
        toast.error(result.message || 'Ошибка загрузки архива');
      }
    } catch (e) {
      console.error(e);
      toast.error('Ошибка сервера');
    } finally {
      set({ isSyncing: false });
    }
  },

  handleRestoreArchivedItem: async (archiveId: string) => {
    set({ isProcessing: true });
    try {
      const result = await get().fetchGas('restoreArchivedItem', { archiveId });
      if (result.status === 'success') {
        toast.success('Элемент успешно восстановлен');
        set({ archivedItems: get().archivedItems.filter(i => i.archiveId !== archiveId) });
        
        const isAdmin = get().currentUser?.role?.toLowerCase() === 'admin' || 
          ['admin', 'админ', 'администратор'].includes(get().currentUser?.username?.toLowerCase() || '');
          
        if (result.data && result.data.stock) {
           set({ stock: normalizeStock(result.data.stock) });
           if (result.data.transactions) {
             const txs = Array.isArray(result.data.transactions) ? result.data.transactions : (result.data.transactions.rows || []);
             set({ transactions: txs });
           }
        } else {
           Promise.all([
             get().fetchStock(),
             get().fetchArchivedItems(),
             isAdmin ? get().fetchUsersList() : Promise.resolve()
           ]).catch(console.error);
        }
        return true;
      } else {
        toast.error(result.message || 'Ошибка восстановления');
        return false;
      }
    } catch (error) {
      console.error(error);
      toast.error('Ошибка сервера');
      return false;
    } finally {
      set({ isProcessing: false });
    }
  },

  handleRestoreMultipleArchivedItems: async (archiveIds) => {
    set({ isProcessing: true });
    try {
      const result = await get().fetchGas('restoreMultipleArchivedItems', { archiveIds });
      if (result.status === 'success' || result.data?.partial) {
        const payloadData = result.status === 'success' ? result.data : result.data;
        
        if (payloadData.partial && payloadData.message) {
          toast.warning(payloadData.message);
        } else {
          toast.success(`Успешно восстановлено: ${archiveIds.length}`);
        }
        set({ archivedItems: get().archivedItems.filter(i => !archiveIds.includes(i.archiveId)) });
        
        const isAdmin = get().currentUser?.role?.toLowerCase() === 'admin' || 
          ['admin', 'админ', 'администратор'].includes(get().currentUser?.username?.toLowerCase() || '');
          
        if (payloadData.stock) {
           set({ stock: normalizeStock(payloadData.stock) });
           if (payloadData.transactions) {
             const txs = Array.isArray(payloadData.transactions) ? payloadData.transactions : (payloadData.transactions.rows || []);
             set({ transactions: txs });
           }
        } else {
           Promise.all([
             get().fetchStock(),
             get().fetchArchivedItems(),
             isAdmin ? get().fetchUsersList() : Promise.resolve()
           ]).catch(console.error);
        }
        return true;
      } else {
        toast.error(result.message || 'Ошибка восстановления');
        return false;
      }
    } catch (e) {
      console.error(e);
      toast.error('Ошибка сервера');
      return false;
    } finally {
      set({ isProcessing: false });
    }
  },

  handleHardDeleteArchivedItems: async (archiveIds) => {
    set({ isProcessing: true });
    try {
      const result = await get().fetchGas('hardDeleteArchivedItems', { archiveIds });
      if (result.status === 'success') {
        toast.success(`Удалено из архива безвозвратно: ${archiveIds.length}`);
        set({ archivedItems: result.data });
        return true;
      } else {
        toast.error(result.message || 'Ошибка окончательного удаления');
        return false;
      }
    } catch (e) {
      console.error(e);
      toast.error('Ошибка сервера');
      return false;
    } finally {
      set({ isProcessing: false });
    }
  },

  checkOzonShipments: async () => {
    set({ isProcessing: true });
    try {
      const sessionToken = get().sessionToken;
      const role = get().currentUser?.role?.toLowerCase() || '';
      const isAdminRole = role === 'admin' || role === 'администратор';
      const sendDevMode = get().devMode && isAdminRole;

      const res = await fetch('/api/ozon/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken, ...(sendDevMode ? { devMode: true } : {}) })
      });
      
      const result = await res.json();
      if (result.status === 'success') {
        const gasResult = await get().fetchGas('getExternalShipments');
        if (gasResult.status === 'success' && Array.isArray(gasResult.data)) {
          set({ externalShipments: gasResult.data });
        }
        toast.success(`Синхронизация Ozon завершена. Найдено отгрузок: ${result.data?.found || 0}, добавлено новых: ${result.data?.added || 0}, обновлено: ${result.data?.updated || 0}`);
      } else {
        toast.error(result.message || 'Ошибка при синхронизации Ozon');
      }
    } catch (e: any) {
      console.error(e);
      toast.error('Ошибка сети при проверке Ozon: ' + e.message);
    } finally {
      set({ isProcessing: false });
    }
  },

  // Пункт 32. Пакетная пометка поставок. Одиночное действие markExternalShipment
  // перезагружает весь лист «Внешние отгрузки» после каждой записи, и на пачке
  // из нескольких поставок это давало вдвое больше обращений к Apps Script,
  // чем нужно. Здесь записи идут подряд, а перезагрузка выполняется один раз
  // в конце — и обязательно выполняется даже при ошибке на середине пачки,
  // иначе интерфейс останется с устаревшими данными.
  markExternalShipmentsBatch: async (postingIds, status, transGroupInfo) => {
    const ids = (postingIds || []).map(p => String(p).trim()).filter(p => p !== '');
    if (ids.length === 0) return false;
    set({ isProcessing: true });
    let ok = true;
    try {
      for (const postingId of ids) {
        const payload: any = { postingId, status };
        if (transGroupInfo !== undefined) {
          payload.transGroupInfo = transGroupInfo;
        }
        const res = await get().fetchGas('updateExternalShipmentStatus', { data: payload });
        if (res.status !== 'success') {
          toast.error(res.message || 'Ошибка обновления статуса');
          ok = false;
          break;
        }
      }
    } catch (e: any) {
      console.error(e);
      toast.error('Ошибка сети при обновлении статуса: ' + e.message);
      ok = false;
    }
    try {
      const gasResult = await get().fetchGas('getExternalShipments');
      if (gasResult.status === 'success' && Array.isArray(gasResult.data)) {
        set({ externalShipments: gasResult.data });
      }
    } catch (e: any) {
      console.error(e);
    } finally {
      set({ isProcessing: false });
    }
    return ok;
  },

  markExternalShipment: async (postingId, status, transGroupInfo) => {
    set({ isProcessing: true });
    try {
      const payload: any = { postingId, status };
      if (transGroupInfo !== undefined) {
        payload.transGroupInfo = transGroupInfo;
      }
      const res = await get().fetchGas('updateExternalShipmentStatus', { data: payload });
      if (res.status === 'success') {
        set(state => ({
          externalShipments: state.externalShipments.map(s => 
          s.postingId === postingId ? { ...s, status } : s
          )
        }));
        
        // Refetch to be fully in sync
        const gasResult = await get().fetchGas('getExternalShipments');
        if (gasResult.status === 'success' && Array.isArray(gasResult.data)) {
          set({ externalShipments: gasResult.data });
        }
        return true;
      } else {
        toast.error(res.message || 'Ошибка обновления статуса');
        return false;
      }
    } catch (e: any) {
      console.error(e);
      toast.error('Ошибка сети при обновлении статуса: ' + e.message);
      return false;
    } finally {
      set({ isProcessing: false });
    }
  },

  saveShipmentAcceptance: async (postingId, acceptedJSON) => {
    set({ isProcessing: true });
    try {
      const res = await get().fetchGas('saveExternalShipmentAcceptance', { data: { postingId, acceptedJSON } });
      if (res.status === 'success') {
        // Refetch to be fully in sync
        const gasResult = await get().fetchGas('getExternalShipments');
        if (gasResult.status === 'success' && Array.isArray(gasResult.data)) {
          set({ externalShipments: gasResult.data });
        }
        toast.success('Приёмка сохранена');
        return true;
      } else {
        toast.error(res.message || 'Ошибка сохранения приёмки');
        return false;
      }
    } catch (e: any) {
      console.error(e);
      toast.error('Ошибка сети при сохранении приёмки: ' + e.message);
      return false;
    } finally {
      set({ isProcessing: false });
    }
  },

  saveShipmentPeresort: async (postingId, peresortJSON) => {
    set({ isProcessing: true });
    try {
      const res = await get().fetchGas('saveShipmentPeresort', { data: { postingId, peresortJSON } });
      if (res.status === 'success') {
        // Refetch to be fully in sync
        const gasResult = await get().fetchGas('getExternalShipments');
        if (gasResult.status === 'success' && Array.isArray(gasResult.data)) {
          set({ externalShipments: gasResult.data });
        }
        toast.success('Пересорт сохранён');
        return true;
      } else {
        toast.error(res.message || 'Ошибка сохранения пересорта');
        return false;
      }
    } catch (e: any) {
      console.error(e);
      toast.error('Ошибка сети при сохранении пересорта: ' + e.message);
      return false;
    } finally {
      set({ isProcessing: false });
    }
  },

  commitShipmentPeresort: async (postingId) => {
    set({ isProcessing: true });
    try {
      const res = await get().fetchGas('commitShipmentPeresort', { data: { postingId } });
      if (res.status === 'success') {
        set(state => ({
          stock: normalizeStock(res.data.stock || []),
          transactions: res.data.transactions || state.transactions
        }));
        await get().fetchExternalShipments();
        toast.success('Пересорт проведён: остатки склада обновлены');
        return true;
      } else {
        toast.error('Ошибка сервера: ' + res.message);
        return false;
      }
    } catch (e: any) {
      console.error(e);
      toast.error('Ошибка проведения пересорта');
      return false;
    } finally {
      set({ isProcessing: false });
    }
  },

  saveShipmentShortageRecalc: async (postingId, recalcJSON, historyNotes) => {
    set({ isProcessing: true });
    try {
      const res = await get().fetchGas('saveShipmentShortageRecalc', { data: { postingId, recalcJSON, historyNotes } });
      if (res.status === 'success') {
        // Refetch to be fully in sync
        const gasResult = await get().fetchGas('getExternalShipments');
        if (gasResult.status === 'success' && Array.isArray(gasResult.data)) {
          set({ externalShipments: gasResult.data });
        }
        toast.success('Перерасчёт недостачи сохранён');
        return true;
      } else {
        toast.error(res.message || 'Ошибка сохранения перерасчёта');
        return false;
      }
    } catch (e: any) {
      console.error(e);
      toast.error('Ошибка сети при сохранении перерасчёта: ' + e.message);
      return false;
    } finally {
      set({ isProcessing: false });
    }
  },

  // Возврат Ozon-заявок в «новые», если их транзакции удалены из Истории
  returnLinkedOzonSupplies: async (deletedIds) => {
    const deletedSet = new Set(deletedIds.map((id) => String(id)));
    const linked = get().externalShipments.filter((s) => {
      if (s.status !== 'processed' || !s.transGroupInfo) return false;
      try {
        const ids = JSON.parse(s.transGroupInfo);
        return Array.isArray(ids) && ids.some((tid: any) => deletedSet.has(String(tid)));
      } catch {
        return false;
      }
    });

    for (const s of linked) {
      await get().markExternalShipment(s.postingId, 'new', '');
    }
    if (linked.length > 0) {
      toast.info(`Заявок Ozon возвращено в «новые»: ${linked.length}`);
    }
  },

  fetchExternalShipments: async () => {
    set({ isProcessing: true });
    try {
      const result = await get().fetchGas('getExternalShipments');
      if (result.status === 'success') {
        if (Array.isArray(result.data)) {
          set({ externalShipments: result.data });
        }
      } else {
        toast.error(result.message || 'Ошибка при загрузке поставок Ozon');
      }
    } catch (e: any) {
      console.error(e);
      toast.error('Ошибка сети при загрузке поставок Ozon: ' + e.message);
    } finally {
      set({ isProcessing: false });
    }
  },

  fetchOzonSyncStatus: async () => {
    // Без токена запрос заведомо вернёт 401 и засорит консоль ошибкой на экране входа.
    if (!get().sessionToken) return;
    try {
      const result = await get().fetchGas('getOzonSyncStatus');
      if (result.status === 'success') {
        set({ ozonSyncStatus: result.data });
      } else {
        console.error('getOzonSyncStatus failed:', result.message);
      }
    } catch (e) {
      console.error('getOzonSyncStatus error:', e);
    }
  },

  setOzonSyncEnabled: async (enabled) => {
    set({ isProcessing: true });
    try {
      const action = enabled ? 'setupOzonSyncTriggers' : 'removeOzonSyncTriggers';
      const result = await get().fetchGas(action);
      if (result.status === 'success') {
        set({ ozonSyncStatus: result.data });
        toast.success(enabled ? 'Автоопрос включён: 05:00 и 17:00 МСК' : 'Автоопрос отключён');
      } else {
        toast.error(result.message || 'Ошибка управления автоопросом');
      }
    } catch (e: any) {
      console.error(e);
      toast.error('Ошибка сети при настройке автоопроса: ' + e.message);
    } finally {
      set({ isProcessing: false });
    }
  },

  runOzonSyncNow: async () => {
    set({ isProcessing: true });
    try {
      const result = await get().fetchGas('runOzonSyncNow');
      if (result.status === 'success' && result.data) {
        const data = result.data;
        if (data.async === true) {
          toast.success(data.message || 'Синхронизация Ozon запущена в фоновом режиме');
          // Через 90 секунд подтянуть результат фонового прогона: статус и обновлённый список внешних отгрузок
          setTimeout(async () => {
            try {
              await get().fetchOzonSyncStatus();
              const gasResult = await get().fetchGas('getExternalShipments');
              if (gasResult.status === 'success' && Array.isArray(gasResult.data)) {
                set({ externalShipments: gasResult.data });
              }
            } catch (err) {
              console.error('Отложенное обновление статуса Ozon:', err);
            }
          }, 90000);
        } else if (data.ok === true) {
          toast.success(`Проверка выполнена. Найдено: ${data.found || 0}, добавлено: ${data.added || 0}, обновлено: ${data.updated || 0}`);
          const gasResult = await get().fetchGas('getExternalShipments');
          if (gasResult.status === 'success' && Array.isArray(gasResult.data)) {
            set({ externalShipments: gasResult.data });
          }
        } else {
          toast.error(data.message || 'Ошибка при автоопросе Ozon');
        }
      } else {
        toast.error(result.message || 'Не удалось выполнить проверку Ozon');
      }
    } catch (e: any) {
      console.error(e);
      toast.error('Ошибка сети при автоопросе Ozon: ' + e.message);
    } finally {
      set({ isProcessing: false });
      await get().fetchOzonSyncStatus();
    }
  },

  // Item 26 stage A1 (2026-08-20). Start-up used to fire five separate Ozon reads in one
  // wave; each round trip to Apps Script costs 2-4 s regardless of how little data it carries,
  // so the wave was as slow as its slowest member. One call now brings all five payloads.
  // Ozon stocks, sales and factory orders are stored here; settings and cluster references are
  // owned by the components, so they are handed back to the caller instead.
  fetchOzonInitialData: async () => {
    if (!get().sessionToken) return false;
    if (ozonInitialInFlight) return ozonInitialInFlight;
    const run = async (): Promise<boolean> => {
    // Настройки приходят как строки из листа «ключ — значение»: пустая ячейка не должна
    // превращаться в ноль, поэтому недостающее значение заменяется значением по умолчанию.
    const num = (v: any, def: number): number => {
      if (v === '' || v === null || v === undefined) return def;
      const n = Number(v);
      return Number.isFinite(n) ? n : def;
    };
    try {
      const result = await get().fetchGas('getOzonInitialData', { data: {} });
      if (result.status !== 'success' || !result.data) {
        console.error('getOzonInitialData failed:', result.message);
        set({ ozonRefsLoaded: true });
        return false;
      }
      const d = result.data;
      if (Array.isArray(d.stocks)) set({ ozonStocks: d.stocks });
      if (Array.isArray(d.sales)) set({ ozonSales: d.sales });
      if (Array.isArray(d.factoryOrders)) set({ factoryOrders: d.factoryOrders });

      if (d.settings) {
        const s = d.settings;
        set({
          ozonSettings: {
            // Счётчик недель, ноль бессмысленен — нижняя граница 1.
            speedWeeks: Math.max(1, num(s.speedWeeks, 4)),
            minStockDays: num(s.minStockDays, 7),
            targetStockDays: num(s.targetStockDays, 30),
            maxClusterDays: num(s.maxClusterDays, 100),
            factoryOrderDays: num(s.factoryOrderDays, 60),
            returnsToSalePct: num(s.returnsToSalePct, 80),
            excludedClusters: String(s.excludedClusters || ''),
            priorityClusters: String(s.priorityClusters || ''),
            deficitDays: num(s.deficitDays, 7),
            // Счётчик недель, ноль бессмысленен — нижняя граница 1.
            trendWeeks: Math.max(1, num(s.trendWeeks, 13)),
            // Счётчик недель, ноль бессмысленен — нижняя граница 1.
            bestWeeks: Math.max(1, num(s.bestWeeks, 4)),
            minSalesForCorrection: num(s.minSalesForCorrection, 50),
            maxSpeedGrowth: num(s.maxSpeedGrowth, 5),
            salesGrowthPct: num(s.salesGrowthPct, 0),
          },
          ozonSupplySettings: {
            // Счётчик коробок на кластер, ноль бессмысленен — нижняя граница 1.
            maxBoxesPerCluster: Math.max(1, num(s.maxBoxesPerCluster, 30)),
            dropOffWarehouseId: String(s.dropOffWarehouseId || ''),
            dropOffWarehouseName: String(s.dropOffWarehouseName || ''),
            dropOffWarehouseType: String(s.dropOffWarehouseType || ''),
          },
        });
      }

      const clusters = Array.isArray(d.clusters) ? d.clusters : [];
      set({
        ozonClustersRaw: clusters,
        ozonClusterRefs: clusters
          .map((item: any) => ({
            clusterId: String(item.clusterId || '').trim(),
            clusterName: String(item.clusterName || '').trim(),
          }))
          .filter((item: any) => Boolean(item.clusterId)),
        ozonRefsLoaded: true,
      });
      return true;
    } catch (e) {
      console.error('getOzonInitialData error:', e);
      set({ ozonRefsLoaded: true });
      return false;
    }
    };
    ozonInitialInFlight = run().finally(() => { ozonInitialInFlight = null; });
    return ozonInitialInFlight;
  },

  fetchOzonStocks: async () => {
    if (!get().sessionToken) return;
    try {
      const result = await get().fetchGas('getOzonStocks');
      if (result.status === 'success' && Array.isArray(result.data)) {
        set({ ozonStocks: result.data });
      } else {
        console.error('getOzonStocks failed:', result.message);
      }
    } catch (e) {
      console.error('getOzonStocks error:', e);
    }
  },

  fetchOzonSales: async () => {
    if (!get().sessionToken) return;
    try {
      // Пункт 29: просим окно недель, а не всю историю.
      // Пункт 22, этап I (19.08.2026): размер окна БОЛЬШЕ НЕ ЗАДАЁТСЯ ЗДЕСЬ.
      // Жёсткое число 12 появилось до того, как в пункте 42 завели окно тренда
      // в 13 недель, и молча обрезало его: счётчик недель включал текущую
      // незавершённую неделю, поэтому полных приходило 11, и тренд с коррекцией
      // скорости считались по укороченному ряду. Теперь окно вычисляет сам Code.gs
      // по «Настройкам Ozon», поэтому увеличение настройки работает сразу.
      const result = await get().fetchGas('getOzonSales', { data: {} });
      if (result.status === 'success' && Array.isArray(result.data)) {
        set({ ozonSales: result.data });
      } else {
        console.error('getOzonSales failed:', result.message);
      }
    } catch (e) {
      console.error('getOzonSales error:', e);
    }
  },

  /**
   * Журнал «Заявки Ozon» — подстраховка локального зачёта потребности:
   * до ближайшего опроса Ozon данных о новой заявке во «Внешних отгрузках» ещё нет.
   * Действие доступно только администратору; для остальных ролей молча остаётся пустым.
   */
  fetchOzonSupplyRequests: async () => {
    if (!get().sessionToken) return;
    try {
      const result = await get().fetchGas('getOzonSupplyRequests');
      if (result.status === 'success' && Array.isArray(result.data)) {
        set({ ozonSupplyRequests: result.data });
      } else {
        console.error('getOzonSupplyRequests failed:', result.message);
      }
    } catch (e) {
      console.error('getOzonSupplyRequests error:', e);
    }
  },

  fetchFactoryOrders: async () => {
    if (!get().sessionToken) return;
    try {
      const result = await get().fetchGas('getFactoryOrders');
      if (result.status === 'success' && Array.isArray(result.data)) {
        set({ factoryOrders: result.data });
      } else {
        console.error('getFactoryOrders failed:', result.message);
      }
    } catch (e) {
      console.error('getFactoryOrders error:', e);
    }
  },

  saveFactoryOrder: async (order) => {
    set({ isProcessing: true });
    try {
      const result = await get().fetchGas('saveFactoryOrder', { data: order });
      if (result.status === 'success' && Array.isArray(result.data)) {
        set({ factoryOrders: result.data });
        toast.success('Заказ на фабрике сохранён');
        return true;
      }
      toast.error(result.message || 'Не удалось сохранить заказ на фабрике');
      return false;
    } catch (e: any) {
      toast.error('Ошибка сохранения заказа на фабрике: ' + (e?.message || e));
      return false;
    } finally {
      set({ isProcessing: false });
    }
  },

  cancelFactoryOrder: async (id) => {
    set({ isProcessing: true });
    try {
      const result = await get().fetchGas('cancelFactoryOrder', { data: { id } });
      if (result.status === 'success' && Array.isArray(result.data)) {
        set({ factoryOrders: result.data });
        toast.success('Заказ на фабрике отменён');
        return true;
      }
      toast.error(result.message || 'Не удалось отменить заказ на фабрике');
      return false;
    } catch (e: any) {
      toast.error('Ошибка при отмене заказа: ' + (e?.message || e));
      return false;
    } finally {
      set({ isProcessing: false });
    }
  },

  fetchLastPurchasePrices: async () => {
    try {
      const result = await get().fetchGas('getLastPurchasePrices');
      if (result.status === 'success' && result.data && typeof result.data === 'object') {
        set({ lastPurchasePrices: result.data });
      }
    } catch (e) {
      console.error('Не удалось загрузить цены последних поступлений:', e);
    }
  },

  setFactoryOrderReceived: async (id) => {
    set({ isProcessing: true });
    try {
      const result = await get().fetchGas('setFactoryOrderReceived', { data: { id } });
      if (result.status === 'success' && Array.isArray(result.data)) {
        set({ factoryOrders: result.data });
        toast.success('Партия отмечена как полученная');
        return true;
      }
      toast.error(result.message || 'Не удалось отметить получение партии');
      return false;
    } catch (e: any) {
      toast.error('Ошибка при отметке получения: ' + (e?.message || e));
      return false;
    } finally {
      set({ isProcessing: false });
    }
  },

  runOzonStocksSync: async () => {
    set({ isProcessing: true });
    try {
      const result = await get().fetchGas('runOzonStocksSyncNow');
      if (result.status === 'success') {
        const savedRows = result.data?.savedRows || 0;
        toast.success(`Остатки Ozon обновлены: строк ${savedRows}`);
        const issues: { name: string; message: string }[] = [];
        if (Array.isArray(result.data?.cabinets)) {
          for (const cab of result.data.cabinets) {
            if (cab.ok === false) {
              issues.push({ name: String(cab.name || ''), message: String(cab.message || 'Ошибка') });
              toast.error(`Кабинет ${cab.name}: ${cab.message || 'Ошибка'}`);
            }
          }
        }
        set({ ozonStocksSyncIssues: issues });
        await get().fetchOzonStocks();
      } else {
        toast.error(result.message || 'Ошибка обновления остатков Ozon');
      }
    } catch (e: any) {
      console.error(e);
      toast.error('Ошибка сети при обновлении остатков Ozon: ' + (e.message || String(e)));
    } finally {
      set({ isProcessing: false });
    }
  }
    })
    ,
    {
      name: 'warehouse-storage',
      partialize: (state) => ({ currentUser: state.currentUser, sessionToken: state.sessionToken }),
    }
  )
);
