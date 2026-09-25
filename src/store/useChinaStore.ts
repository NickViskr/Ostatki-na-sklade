/**
 * Item 81b: the state of the module «Заказы в Китае».
 *
 * A store of its own, because the module is autonomous: it keeps its data in its own
 * spreadsheet and shares nothing with the warehouse yet. Every write answers with the whole
 * state the script holds, so the screen never has to guess what a write did — and never
 * computes money of its own.
 */

import { create } from 'zustand';
import { toast } from 'sonner';
import { ChinaBatch, ChinaMoney, ChinaPayment } from '../types';
import { useWarehouseStore } from './useWarehouseStore';

interface ChinaAnswer {
  status: string;
  message?: string;
  data?: {
    batches?: ChinaBatch[];
    payments?: ChinaPayment[];
    settings?: Record<string, number | string>;
    warnings?: string[];
  } & Partial<ChinaMoney>;
}

interface ChinaState {
  batches: ChinaBatch[];
  payments: ChinaPayment[];
  settings: Record<string, number | string>;
  /** Item 81g: the picture `getChinaMoney` answers with — payments, receipts and orders of the
   * financial report, kept apart from `batches` because the payments card reads it, not them. */
  money: ChinaMoney | null;
  isLoading: boolean;
  isSaving: boolean;
  /** Empty until the first answer arrives, so an empty list is not shown as «нет партий». */
  loaded: boolean;
  /** The last refusal of the script, shown on the tab itself and not only in a toast. */
  error: string;
  fetchChinaBatches: () => Promise<void>;
  fetchChinaMoney: () => Promise<void>;
  setupChinaSpreadsheet: () => Promise<boolean>;
  saveChinaBatch: (payload: Record<string, unknown>) => Promise<boolean>;
  deleteChinaBatch: (id: string) => Promise<boolean>;
  saveChinaCost: (payload: Record<string, unknown>) => Promise<boolean>;
  deleteChinaCost: (id: string) => Promise<boolean>;
  saveChinaPayment: (payload: Record<string, unknown>) => Promise<boolean>;
  deleteChinaPayment: (id: string) => Promise<boolean>;
  /** Item 81g: the financial report, parsed in the browser and grouped by `chinaReportPayload`. */
  saveChinaReport: (payload: Record<string, unknown>) => Promise<string[] | null>;
  matchChinaPayment: (paymentId: string, receiptId: string) => Promise<boolean>;
  unmatchChinaPayment: (paymentId: string) => Promise<boolean>;
  /** Item 89: an owner's manual mark that a receipt still «ждёт оплату» is actually old — no rate
   * is missing, it just predates tracking, exactly like a receipt the report itself calls
   * 'история'. `history: false` undoes the mark. */
  setChinaReceiptHistory: (receiptId: string, history: boolean) => Promise<boolean>;
  setChinaRubCostsDone: (batchId: string, done: boolean) => Promise<boolean>;
}

const callChina = async (action: string, data?: Record<string, unknown>): Promise<ChinaAnswer> => {
  const fetchGas = useWarehouseStore.getState().fetchGas;
  return await fetchGas(action, data === undefined ? {} : { data }) as ChinaAnswer;
};

export const useChinaStore = create<ChinaState>()((set, get) => ({
  batches: [],
  payments: [],
  settings: {},
  money: null,
  isLoading: false,
  isSaving: false,
  loaded: false,
  error: '',

  fetchChinaBatches: async () => {
    if (!useWarehouseStore.getState().sessionToken) return;
    set({ isLoading: true });
    const result = await callChina('getChinaBatches');
    if (result.status === 'success' && result.data) {
      set({
        batches: result.data.batches || [],
        payments: result.data.payments || [],
        settings: result.data.settings || {},
        loaded: true,
        error: '',
        isLoading: false
      });
      return;
    }
    set({ isLoading: false, loaded: true, error: result.message || 'Не удалось прочитать заказы в Китае' });
  },

  // Item 81g: the payments card reads this, not `batches` — the two are refreshed together
  // after every write, so a payment matched against a receipt is reflected in both at once.
  fetchChinaMoney: async () => {
    if (!useWarehouseStore.getState().sessionToken) return;
    const result = await callChina('getChinaMoney');
    if (result.status === 'success' && result.data) {
      set({ money: result.data as ChinaMoney });
      return;
    }
    toast.error(result.message || 'Не удалось прочитать оплаты китайцам');
  },

  setupChinaSpreadsheet: async () => {
    set({ isSaving: true });
    const result = await callChina('setupChinaSpreadsheet');
    set({ isSaving: false });
    if (result.status !== 'success') {
      set({ error: result.message || 'Не удалось настроить таблицу' });
      toast.error(result.message || 'Не удалось настроить таблицу');
      return false;
    }
    toast.success('Таблица «Заказы в Китае» настроена');
    await get().fetchChinaBatches();
    return true;
  },

  saveChinaBatch: async (payload) => {
    set({ isSaving: true });
    const result = await callChina('saveChinaBatch', payload);
    set({ isSaving: false });
    if (result.status !== 'success' || !result.data) {
      toast.error(result.message || 'Не удалось сохранить партию');
      return false;
    }
    set({ batches: result.data.batches || [], payments: result.data.payments || get().payments,
      settings: result.data.settings || get().settings, loaded: true, error: '' });
    toast.success('Партия сохранена, себестоимость пересчитана');
    await get().fetchChinaMoney();
    return true;
  },

  saveChinaPayment: async (payload) => {
    set({ isSaving: true });
    const result = await callChina('saveChinaPayment', payload);
    set({ isSaving: false });
    if (result.status !== 'success' || !result.data) {
      toast.error(result.message || 'Не удалось сохранить оплату');
      return false;
    }
    set({ batches: result.data.batches || [], payments: result.data.payments || [], loaded: true, error: '' });
    toast.success('Оплата учтена, курс партий пересчитан');
    await get().fetchChinaMoney();
    return true;
  },

  deleteChinaPayment: async (id) => {
    set({ isSaving: true });
    const result = await callChina('deleteChinaPayment', { id });
    set({ isSaving: false });
    if (result.status !== 'success' || !result.data) {
      toast.error(result.message || 'Не удалось удалить оплату');
      return false;
    }
    set({ batches: result.data.batches || [], payments: result.data.payments || [], loaded: true, error: '' });
    toast.success('Оплата удалена, курс партий пересчитан');
    await get().fetchChinaMoney();
    return true;
  },

  deleteChinaBatch: async (id) => {
    set({ isSaving: true });
    const result = await callChina('deleteChinaBatch', { id });
    set({ isSaving: false });
    if (result.status !== 'success' || !result.data) {
      toast.error(result.message || 'Не удалось удалить партию');
      return false;
    }
    set({ batches: result.data.batches || [], loaded: true, error: '' });
    toast.success('Партия удалена');
    await get().fetchChinaMoney();
    return true;
  },

  saveChinaCost: async (payload) => {
    set({ isSaving: true });
    const result = await callChina('saveChinaBatchCost', payload);
    set({ isSaving: false });
    if (result.status !== 'success' || !result.data) {
      toast.error(result.message || 'Не удалось сохранить расход');
      return false;
    }
    set({ batches: result.data.batches || [], loaded: true, error: '' });
    toast.success('Расход учтён в себестоимости партии');
    await get().fetchChinaMoney();
    return true;
  },

  deleteChinaCost: async (id) => {
    set({ isSaving: true });
    const result = await callChina('deleteChinaBatchCost', { id });
    set({ isSaving: false });
    if (result.status !== 'success' || !result.data) {
      toast.error(result.message || 'Не удалось удалить расход');
      return false;
    }
    set({ batches: result.data.batches || [], loaded: true, error: '' });
    toast.success('Расход удалён, себестоимость пересчитана');
    await get().fetchChinaMoney();
    return true;
  },

  // Item 81g: a report file alone is a valid import — nothing about money is computed in the
  // browser, `chinaReportPayload` only groups what the parser already read. The server's own
  // warnings (about payments it could not place, say) are handed back for a toast.
  saveChinaReport: async (payload) => {
    set({ isSaving: true });
    const result = await callChina('saveChinaReport', payload);
    set({ isSaving: false });
    if (result.status !== 'success' || !result.data) {
      toast.error(result.message || 'Не удалось сохранить отчёт');
      return null;
    }
    set({ batches: result.data.batches || get().batches, loaded: true, error: '' });
    toast.success('Отчёт загружен, партии пересчитаны');
    await get().fetchChinaMoney();
    return result.data.warnings || [];
  },

  matchChinaPayment: async (paymentId, receiptId) => {
    set({ isSaving: true });
    const result = await callChina('matchChinaPayment', { paymentId, receiptId });
    set({ isSaving: false });
    if (result.status !== 'success') {
      toast.error(result.message || 'Не удалось сопоставить оплату');
      return false;
    }
    toast.success('Оплата сопоставлена с поступлением из отчёта');
    await get().fetchChinaMoney();
    await get().fetchChinaBatches();
    return true;
  },

  unmatchChinaPayment: async (paymentId) => {
    set({ isSaving: true });
    const result = await callChina('unmatchChinaPayment', { paymentId });
    set({ isSaving: false });
    if (result.status !== 'success') {
      toast.error(result.message || 'Не удалось отменить сопоставление');
      return false;
    }
    toast.success('Сопоставление отменено');
    await get().fetchChinaMoney();
    await get().fetchChinaBatches();
    return true;
  },

  setChinaReceiptHistory: async (receiptId, history) => {
    set({ isSaving: true });
    const result = await callChina('setChinaReceiptHistory', { receiptId, history });
    set({ isSaving: false });
    if (result.status !== 'success') {
      toast.error(result.message || 'Не удалось отметить поступление');
      return false;
    }
    toast.success(history ? 'Поступление отмечено историей' : 'Поступление возвращено из истории');
    await get().fetchChinaMoney();
    await get().fetchChinaBatches();
    return true;
  },

  setChinaRubCostsDone: async (batchId, done) => {
    set({ isSaving: true });
    const result = await callChina('setChinaRubCostsDone', { batchId, done });
    set({ isSaving: false });
    if (result.status !== 'success' || !result.data) {
      toast.error(result.message || 'Не удалось отметить расходы в РФ');
      return false;
    }
    set({ batches: result.data.batches || get().batches, loaded: true, error: '' });
    return true;
  }
}));
