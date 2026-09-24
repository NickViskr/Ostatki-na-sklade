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
import { ChinaBatch, ChinaPayment } from '../types';
import { useWarehouseStore } from './useWarehouseStore';

interface ChinaAnswer {
  status: string;
  message?: string;
  data?: { batches?: ChinaBatch[]; payments?: ChinaPayment[]; settings?: Record<string, number | string> };
}

interface ChinaState {
  batches: ChinaBatch[];
  payments: ChinaPayment[];
  settings: Record<string, number | string>;
  isLoading: boolean;
  isSaving: boolean;
  /** Empty until the first answer arrives, so an empty list is not shown as «нет партий». */
  loaded: boolean;
  /** The last refusal of the script, shown on the tab itself and not only in a toast. */
  error: string;
  fetchChinaBatches: () => Promise<void>;
  setupChinaSpreadsheet: () => Promise<boolean>;
  saveChinaBatch: (payload: Record<string, unknown>) => Promise<boolean>;
  deleteChinaBatch: (id: string) => Promise<boolean>;
  saveChinaCost: (payload: Record<string, unknown>) => Promise<boolean>;
  deleteChinaCost: (id: string) => Promise<boolean>;
  saveChinaPayment: (payload: Record<string, unknown>) => Promise<boolean>;
  deleteChinaPayment: (id: string) => Promise<boolean>;
}

const callChina = async (action: string, data?: Record<string, unknown>): Promise<ChinaAnswer> => {
  const fetchGas = useWarehouseStore.getState().fetchGas;
  return await fetchGas(action, data === undefined ? {} : { data }) as ChinaAnswer;
};

export const useChinaStore = create<ChinaState>()((set, get) => ({
  batches: [],
  payments: [],
  settings: {},
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
    return true;
  }
}));
