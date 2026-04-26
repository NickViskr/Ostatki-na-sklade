import React from 'react';
import { 
  X, 
  Save, 
  Loader2 
} from 'lucide-react';
import { motion } from 'motion/react';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { useUIStore } from '../store/useUIStore';

export const SkuModal: React.FC = () => {
  const isAddingSku = useWarehouseStore((state) => state.isAddingSku);
  const handleSaveSku = useWarehouseStore((state) => state.handleSaveSku);
  
  const skuForm = useUIStore((state) => state.skuForm);
  const setSkuForm = useUIStore((state) => state.setSkuForm);
  const editingSku = useUIStore((state) => state.editingSku);
  const setShowSkuModal = useUIStore((state) => state.setShowSkuModal);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const success = await handleSaveSku(skuForm, editingSku);
    if (success) {
      setShowSkuModal(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
    >
      <motion.div 
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-lg overflow-hidden"
      >
        <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <h3 className="text-2xl font-bold">{editingSku ? 'Редактировать SKU' : 'Добавить новый SKU'}</h3>
          <button 
            onClick={() => setShowSkuModal(false)}
            className="p-3 hover:bg-white rounded-2xl transition-all shadow-sm border border-transparent hover:border-slate-200"
          >
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-8 space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-500 uppercase">Артикул (SKU)</label>
            <input 
              type="text"
              required
              value={skuForm.sku}
              onChange={(e) => setSkuForm({...skuForm, sku: e.target.value})}
              className="w-full px-6 py-4 rounded-2xl border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Напр: A001"
            />
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-500 uppercase">Шт в коробке</label>
              <input 
                type="number"
                min="1"
                value={skuForm.pcsPerBox}
                onChange={(e) => setSkuForm({...skuForm, pcsPerBox: Math.max(1, e.target.value === '' ? 1 : parseInt(e.target.value))})}
                className="w-full px-6 py-4 rounded-2xl border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-500 uppercase">Мин. остаток</label>
              <input 
                type="number"
                min="0"
                value={skuForm.minStock}
                onChange={(e) => setSkuForm({...skuForm, minStock: Math.max(0, e.target.value === '' ? 0 : parseInt(e.target.value))})}
                className="w-full px-6 py-4 rounded-2xl border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div className="p-8 bg-slate-50 -mx-8 -mb-8 border-t border-slate-100 flex gap-4">
            <button 
              type="button"
              onClick={() => setShowSkuModal(false)}
              className="flex-1 py-4 rounded-2xl font-bold text-slate-500 hover:bg-white transition-all border border-transparent hover:border-slate-200"
            >
              Отмена
            </button>
            <button 
              type="submit"
              disabled={isAddingSku}
              className="flex-1 bg-slate-900 text-white py-4 rounded-2xl font-bold hover:bg-slate-800 disabled:opacity-50 transition-all shadow-xl flex items-center justify-center gap-2"
            >
              {isAddingSku ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
              {editingSku ? 'Сохранить' : 'Добавить'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
};
