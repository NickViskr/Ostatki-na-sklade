import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { StockItem, Transaction, SKUItem, ParsedItem, User, ArchivedItem, ServiceItem, KitItem, KitComponent, ServiceRate, ExternalShipment } from '../types';
import { useSettingsStore } from './useSettingsStore';
import { useUIStore } from './useUIStore';
import { parseInvoiceWithGemini } from '../lib/gemini';
import { toast } from 'sonner';

const normalizeStock = (items: StockItem[]): StockItem[] =>
  items.map(item =>
    Number(item.quantity) <= 0
      ? { ...item, quantity: 0, avgCost: 0, capitalization: 0, turnover: 0, sales120: 0 }
      : item
  );

const expandIdsWithCascade = (ids: string[], transactions: Transaction[]): string[] => {
  const idsSet = new Set(ids);
  
  // 1. Cascade to component transactions of any deleted main items
  const mainIds = new Set<string>();
  transactions.forEach(t => {
    if (idsSet.has(t.id) && !t.isComponent) {
      if (t.groupId) mainIds.add(t.groupId);
      mainIds.add(t.id);
    }
  });

  transactions.forEach(t => {
    if (t.isComponent && t.groupId && (mainIds.has(t.groupId) || idsSet.has(t.groupId))) {
      idsSet.add(t.id);
    }
  });

  // 2. Cascade to entire shipment group if all main items are deleted
  const shipmentGroups: Record<string, Transaction[]> = {};
  transactions.forEach(t => {
    if (t.type === 'Расход') {
      const dStr = t.date ? t.date.split(',')[0].trim() : '';
      const delStr = t.deliveryDate ? t.deliveryDate.split(',')[0].trim() : '';
      const key = `${dStr}_${delStr}_${t.destination || ''}`;
      if (!shipmentGroups[key]) shipmentGroups[key] = [];
      shipmentGroups[key].push(t);
    }
  });

  Object.values(shipmentGroups).forEach(groupItems => {
    const mainItemsInGroup = groupItems.filter(item => !item.isComponent && item.total > 0);
    if (mainItemsInGroup.length > 0 && mainItemsInGroup.every(item => idsSet.has(item.id))) {
      groupItems.forEach(item => { idsSet.add(item.id); });
    } else {
      const deletedComponentArticles = new Set(
        Array.from(idsSet).flatMap(id => {
          const tx = transactions.find(t => t.id === id);
          return tx?.isComponent ? [tx.article] : [];
        })
      );
      groupItems.forEach(item => {
        if (!item.isComponent && item.total === 0 && deletedComponentArticles.has(item.article)) {
          idsSet.add(item.id);
        }
      });
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
  commitTransaction: (items: ParsedItem[], type: string, destination: string, deliveryDate?: string) => Promise<boolean>;
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
  markExternalShipment: (postingId: string, status: 'processed' | 'ignored') => Promise<boolean>;
  pendingOzonPostingId: string | null;
  setPendingOzonPostingId: (id: string | null) => void;
  getEffectiveAvailability: (article: string) => number;
}

export const useWarehouseStore = create<WarehouseState>()(
  persist(
    (set, get) => ({
  stock: [],
  transactions: [],
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
  pendingOzonPostingId: null,

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

  setPendingOzonPostingId: (pendingOzonPostingId) => set({ pendingOzonPostingId }),
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

  fetchGas: async (action, extraPayload = {}) => {
    const sessionToken = get().sessionToken;
    
    try {
      const response = await fetch('/api/gas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, sessionToken, ...extraPayload })
      });
      
      if (!response.ok) {
        set({ gasError: true });
        return { status: 'error', message: `Ошибка HTTP ${response.status}` };
      }

      const text = await response.text();
      try {
        const json = JSON.parse(text);
        set({ gasError: false });
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

  commitTransaction: async (items, type, destination, deliveryDate = '') => {
    const { notificationEmail } = useSettingsStore.getState();
    
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
        data: items, 
        type, 
        destination,
        deliveryDate,
        notificationEmail 
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
        
        toast.success('Операция успешно записана в Google Таблицу!');
        
        const pendingOzonPostingId = get().pendingOzonPostingId;
        if (pendingOzonPostingId) {
          get().markExternalShipment(pendingOzonPostingId, 'processed');
          set({ pendingOzonPostingId: null });
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
          const uniqueMap = new Map<string, Transaction>();
          // Remove old ID from the list
          state.transactions.filter(t => t.id !== id).forEach(t => uniqueMap.set(t.id, t));
          // Integrate the server's up-to-date active transaction list
          if (payloadData.newTransactions) {
            payloadData.newTransactions.forEach((tx: Transaction) => uniqueMap.set(tx.id, tx));
          }
          return {
            stock: newStock,
            transactions: Array.from(uniqueMap.values()),
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
            item.price = stockItem ? stockItem.avgCost : 0;
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
            if (res.data.storageRatePerLiterDay !== undefined) {
              useSettingsStore.getState().setStorageRatePerLiterDay(Number(res.data.storageRatePerLiterDay) || 0);
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
            if (res.data.storageRatePerLiterDay !== undefined) {
              useSettingsStore.getState().setStorageRatePerLiterDay(Number(res.data.storageRatePerLiterDay) || 0);
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
      const res = await fetch('/api/ozon/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken })
      });
      
      const result = await res.json();
      if (result.status === 'success') {
        const gasResult = await get().fetchGas('getExternalShipments');
        if (gasResult.status === 'success' && Array.isArray(gasResult.data)) {
          set({ externalShipments: gasResult.data });
        }
        toast.success(`Синхронизация Ozon завершена. Найдено отгрузок: ${result.data?.found || 0}, добавлено новых: ${result.data?.added || 0}`);
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

  markExternalShipment: async (postingId, status) => {
    set({ isProcessing: true });
    try {
      const res = await get().fetchGas('updateExternalShipmentStatus', { data: { postingId, status } });
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
  }
    })
    ,
    {
      name: 'warehouse-storage',
      partialize: (state) => ({ currentUser: state.currentUser, sessionToken: state.sessionToken }),
    }
  )
);
