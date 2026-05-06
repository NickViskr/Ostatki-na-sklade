import React, { useState } from 'react';
import { motion } from 'motion/react';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { Book, Plus, Edit2, Trash2, Check, X, ShieldAlert, ArrowUp, ArrowDown } from 'lucide-react';
import { formatCurrency } from '../lib/utils';
import { toast } from 'sonner';
import { ConfirmDialog } from './ConfirmDialog';

export const DirectoryTab: React.FC = () => {
  const services = useWarehouseStore((state) => state.services);
  const currentUser = useWarehouseStore((state) => state.currentUser);
  
  const handleAddService = useWarehouseStore((state) => state.handleAddService);
  const handleUpdateService = useWarehouseStore((state) => state.handleUpdateService);
  const handleDeleteService = useWarehouseStore((state) => state.handleDeleteService);
  
  const serviceOrderIds = useSettingsStore(state => state.serviceOrderIds);
  const setServiceOrderIds = useSettingsStore(state => state.setServiceOrderIds);

  const isAdmin = currentUser?.role?.toLowerCase() === 'admin' || 
    ['admin', 'админ', 'администратор'].includes(currentUser?.username?.toLowerCase() || '');

  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', cost: '' });
  const [confirmDeleteService, setConfirmDeleteService] = useState<{id: string, name: string} | null>(null);

  const resetForm = () => {
    setForm({ name: '', cost: '' });
    setIsAdding(false);
    setEditingId(null);
  };

  const handleSaveAdd = async () => {
    const cost = parseFloat(form.cost);
    if (!form.name.trim()) {
      toast.error('Введите название услуги');
      return;
    }
    if (isNaN(cost) || cost < 0) {
      toast.error('Введите корректную стоимость');
      return;
    }
    const success = await handleAddService(form.name.trim(), cost);
    if (success) {
      resetForm();
    }
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    const cost = parseFloat(form.cost);
    if (!form.name.trim()) {
      toast.error('Введите название услуги');
      return;
    }
    if (isNaN(cost) || cost < 0) {
      toast.error('Введите корректную стоимость');
      return;
    }
    const success = await handleUpdateService(editingId, form.name.trim(), cost, true);
    if (success) resetForm();
  };

  const activeServices = React.useMemo(() => {
    let active = services.filter(s => s.isActive);
    if (serviceOrderIds && serviceOrderIds.length > 0) {
      active.sort((a, b) => {
        const indexA = serviceOrderIds.indexOf(a.id);
        const indexB = serviceOrderIds.indexOf(b.id);
        if (indexA === -1 && indexB === -1) return 0;
        if (indexA === -1) return 1;
        if (indexB === -1) return -1;
        return indexA - indexB;
      });
    }
    return active;
  }, [services, serviceOrderIds]);

  const moveService = (index: number, direction: 'up' | 'down') => {
    const newActive = [...activeServices];
    if (direction === 'up' && index > 0) {
      [newActive[index - 1], newActive[index]] = [newActive[index], newActive[index - 1]];
    } else if (direction === 'down' && index < newActive.length - 1) {
      [newActive[index], newActive[index + 1]] = [newActive[index + 1], newActive[index]];
    } else {
      return;
    }
    
    const newOrderIds = newActive.map(s => s.id);
    setServiceOrderIds(newOrderIds);
    
    // Save to global settings
    const currentModel = useSettingsStore.getState().geminiModel;
    const modelStrToSave = `${currentModel}|order=${JSON.stringify(newOrderIds)}`;
    const geminiKey = useSettingsStore.getState().geminiKey;
    useWarehouseStore.getState().fetchGas('saveGlobalSettings', { data: { geminiKey, geminiModel: modelStrToSave } });
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="max-w-4xl mx-auto space-y-6 pb-24"
    >
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
            <Book className="w-8 h-8 text-indigo-500" />
            Справочник
          </h2>
          <p className="text-slate-500 mt-2">Справочник дополнительных услуг подрядчиков.</p>
        </div>
        {isAdmin && !isAdding && !editingId && (
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Добавить услугу
          </button>
        )}
      </div>

      {!isAdmin && (
        <div className="bg-amber-50 p-4 border border-amber-200 rounded-2xl flex items-start gap-4">
          <ShieldAlert className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
          <div className="text-amber-800 text-sm">
            Изменение справочника доступно только системным администраторам. Вы можете просматривать существующие услуги.
          </div>
        </div>
      )}

      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden min-w-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[500px]">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <th className="px-6 py-4 text-left text-xs font-bold text-slate-400 uppercase tracking-wider">Название услуги</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-slate-400 uppercase tracking-wider">Стоимость</th>
                {isAdmin && <th className="px-6 py-4 text-right text-xs font-bold text-slate-400 uppercase tracking-wider w-32">Действия</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isAdding && (
                <tr className="bg-indigo-50/30">
                  <td className="px-6 py-4">
                    <input 
                      type="text"
                      className="w-full px-3 py-2 bg-white border border-indigo-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium"
                      placeholder="Название..."
                      value={form.name}
                      autoFocus
                      onChange={(e) => setForm({...form, name: e.target.value})}
                    />
                  </td>
                  <td className="px-6 py-4">
                    <div className="relative">
                      <input 
                        type="number"
                        className="w-full px-3 py-2 bg-white border border-indigo-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all pr-8"
                        placeholder="0.00"
                        min="0"
                        step="0.01"
                        value={form.cost}
                        onChange={(e) => setForm({...form, cost: e.target.value})}
                      />
                      <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none text-slate-400 text-sm font-medium">₽</div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2">
                      <button onClick={handleSaveAdd} className="p-2 text-green-600 hover:bg-green-50 rounded-xl transition-colors" title="Сохранить">
                        <Check className="w-4 h-4" />
                      </button>
                      <button onClick={resetForm} className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl transition-colors" title="Отмена">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              )}

              {activeServices.length === 0 && !isAdding && (
                <tr>
                  <td colSpan={isAdmin ? 3 : 2} className="px-6 py-12 text-center text-slate-500">
                    <Book className="w-8 h-8 text-slate-300 mx-auto mb-3" />
                    <p className="font-medium text-slate-600">Справочник пуст</p>
                    {isAdmin && <p className="text-sm mt-1">Нажмите «Добавить услугу», чтобы начать.</p>}
                  </td>
                </tr>
              )}

              {activeServices.map(service => {
                const isEditing = editingId === service.id;
                
                if (isEditing) {
                  return (
                    <tr key={service.id} className="bg-amber-50/30">
                      <td className="px-6 py-4">
                        <input 
                          type="text"
                          className="w-full px-3 py-2 bg-white border border-amber-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all font-medium"
                          value={form.name}
                          autoFocus
                          onChange={(e) => setForm({...form, name: e.target.value})}
                        />
                      </td>
                      <td className="px-6 py-4">
                        <div className="relative">
                          <input 
                            type="number"
                            className="w-full px-3 py-2 bg-white border border-amber-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all pr-8"
                            min="0"
                            step="0.01"
                            value={form.cost}
                            onChange={(e) => setForm({...form, cost: e.target.value})}
                          />
                          <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none text-slate-400 text-sm font-medium">₽</div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-2">
                          <button onClick={handleSaveEdit} className="p-2 text-green-600 hover:bg-green-50 rounded-xl transition-colors" title="Сохранить">
                            <Check className="w-4 h-4" />
                          </button>
                          <button onClick={resetForm} className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl transition-colors" title="Отмена">
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                }

                return (
                  <tr key={service.id} className="hover:bg-slate-50 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="font-medium text-slate-900">{service.name}</div>
                    </td>
                    <td className="px-6 py-4 font-mono font-medium text-slate-700">
                      {formatCurrency(service.cost)} ₽
                    </td>
                    {isAdmin && (
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-1 opacity-100 transition-opacity">
                          <button 
                            onClick={() => moveService(activeServices.indexOf(service), 'up')} 
                            disabled={activeServices.indexOf(service) === 0}
                            className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-colors disabled:opacity-30 disabled:hover:text-slate-400 disabled:hover:bg-transparent"
                            title="Поднять"
                          >
                            <ArrowUp className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => moveService(activeServices.indexOf(service), 'down')} 
                            disabled={activeServices.indexOf(service) === activeServices.length - 1}
                            className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-colors disabled:opacity-30 disabled:hover:text-slate-400 disabled:hover:bg-transparent"
                            title="Опустить"
                          >
                            <ArrowDown className="w-4 h-4" />
                          </button>
                          <div className="w-4"></div> {/* Separator */}
                          <button 
                            onClick={() => {
                              setEditingId(service.id);
                              setForm({ name: service.name, cost: String(service.cost) });
                              setIsAdding(false);
                            }} 
                            className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-colors"
                            title="Редактировать"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => {
                              setConfirmDeleteService({ id: service.id, name: service.name });
                            }} 
                            className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                            title="Удалить"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      
      <ConfirmDialog
        show={!!confirmDeleteService}
        title="Удаление услуги"
        message={`Для услуги "${confirmDeleteService?.name}" будет установлен статус "неактивно". Продолжить?`}
        onConfirm={() => {
          if (confirmDeleteService) {
            handleDeleteService(confirmDeleteService.id);
            setConfirmDeleteService(null);
          }
        }}
        onCancel={() => setConfirmDeleteService(null)}
      />
    </motion.div>
  );
};
