import React from 'react';
import { 
  X, 
  Save, 
  Loader2 
} from 'lucide-react';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { useUIStore } from '../store/useUIStore';

import { toast } from 'sonner';

export const EditTransModal: React.FC = () => {
  const isProcessing = useWarehouseStore((state) => state.isProcessing);
  const handleUpdateTransaction = useWarehouseStore((state) => state.handleUpdateTransaction);
  
  const editingTrans = useUIStore((state) => state.editingTrans);
  const setEditingTrans = useUIStore((state) => state.setEditingTrans);
  const setShowEditTransModal = useUIStore((state) => state.setShowEditTransModal);

  if (!editingTrans) return null;

  const handleSave = async () => {
    if (Number(editingTrans.quantity) < 0) {
      toast.error('Количество не может быть отрицательным');
      return;
    }
    if (editingTrans.type === 'Приход' && Number(editingTrans.price) < 0) {
      toast.error('Цена не может быть отрицательной');
      return;
    }
    if (editingTrans.type === 'Расход' && Number(editingTrans.writeOffCost) < 0) {
      toast.error('Себестоимость не может быть отрицательной');
      return;
    }

    const success = await handleUpdateTransaction(editingTrans.id, editingTrans);
    if (success) {
      setShowEditTransModal(false);
    }
  };

  return (
    <div 
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 fade-in"
    >
      <div 
        className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-lg overflow-hidden modal-enter"
      >
        <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <h3 className="text-2xl font-bold">Редактировать операцию</h3>
          <button 
            onClick={() => setShowEditTransModal(false)}
            className="p-3 hover:bg-white rounded-2xl transition-all shadow-sm border border-transparent hover:border-slate-200"
          >
            <X size={24} />
          </button>
        </div>

        <div className="p-8 space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-500 uppercase">Количество</label>
            <input 
              type="number"
              min="0"
              value={editingTrans.quantity}
              onChange={(e) => setEditingTrans({...editingTrans, quantity: e.target.value === '' ? '' : parseInt(e.target.value)})}
              className="w-full px-6 py-4 rounded-2xl border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-500 uppercase">Цена / Себестоимость</label>
            <input 
              type="number"
              min="0"
              step="0.01"
              value={editingTrans.type === 'Приход' ? editingTrans.price : editingTrans.writeOffCost}
              disabled={editingTrans.type === 'Расход'}
              onChange={(e) => {
                const val = e.target.value === '' ? '' : parseFloat(e.target.value);
                if (editingTrans.type === 'Приход') {
                  setEditingTrans({...editingTrans, price: val, total: val === '' ? 0 : val * (Number(editingTrans.quantity) || 0)});
                } else {
                  setEditingTrans({...editingTrans, writeOffCost: val, total: val === '' ? 0 : val * (Number(editingTrans.quantity) || 0)});
                }
              }}
              className={`w-full px-6 py-4 rounded-2xl border border-slate-200 outline-none focus:ring-2 focus:ring-indigo-500 ${
                editingTrans.type === 'Расход' 
                  ? 'bg-slate-100 text-slate-400 cursor-not-allowed' 
                  : 'bg-slate-50'
              }`}
            />
            {editingTrans.type === 'Расход' && (
              <p className="text-xs text-slate-400">
                Себестоимость расхода рассчитывается автоматически по средней себестоимости склада
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-500 uppercase">Объект</label>
            <textarea 
              value={editingTrans.destination}
              onChange={(e) => setEditingTrans({...editingTrans, destination: e.target.value})}
              className="w-full h-32 p-4 rounded-2xl border border-slate-200 bg-slate-50 outline-none resize-none"
            />
          </div>

          {editingTrans.type === 'Расход' && (
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-500 uppercase">Дата поставки на маркетплейс</label>
              <input 
                type="date"
                value={editingTrans.deliveryDate || ''}
                onChange={(e) => setEditingTrans({...editingTrans, deliveryDate: e.target.value})}
                className="w-full px-6 py-4 rounded-2xl border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          )}
        </div>

        <div className="p-8 bg-slate-50 border-t border-slate-100 flex gap-4">
          <button 
            onClick={() => setShowEditTransModal(false)}
            className="flex-1 py-4 rounded-2xl font-bold text-slate-500 hover:bg-white transition-all border border-transparent hover:border-slate-200"
          >
            Отмена
          </button>
          <button 
            onClick={handleSave}
            disabled={isProcessing}
            className="flex-1 bg-slate-900 text-white py-4 rounded-2xl font-bold hover:bg-slate-800 disabled:opacity-50 transition-all shadow-xl flex items-center justify-center gap-2"
          >
            {isProcessing ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
            Сохранить изменения
          </button>
        </div>
      </div>
    </div>
  );
};
