import React, { useState } from 'react';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { Book, Plus, Edit2, Trash2, Check, X, ShieldAlert, ArrowUp, ArrowDown, Clock } from 'lucide-react';
import { formatCurrency } from '../lib/utils';
import { toast } from 'sonner';
import { ConfirmDialog } from './ConfirmDialog';

export const DirectoryTab: React.FC = React.memo(() => {
  const services = useWarehouseStore((state) => state.services);
  const serviceRates = useWarehouseStore((state) => state.serviceRates);
  const currentUser = useWarehouseStore((state) => state.currentUser);
  const fetchGas = useWarehouseStore((state) => state.fetchGas);
  
  const handleAddService = useWarehouseStore((state) => state.handleAddService);
  const handleUpdateService = useWarehouseStore((state) => state.handleUpdateService);
  const handleDeleteService = useWarehouseStore((state) => state.handleDeleteService);
  const handleAddServiceRate = useWarehouseStore((state) => state.handleAddServiceRate);
  
  const serviceOrderIds = useSettingsStore(state => state.serviceOrderIds);
  const setServiceOrderIds = useSettingsStore(state => state.setServiceOrderIds);
  const storageRatePerLiterDay = useSettingsStore(state => state.storageRatePerLiterDay);
  const setStorageRatePerLiterDay = useSettingsStore(state => state.setStorageRatePerLiterDay);

  const isAdmin = currentUser?.role?.toLowerCase() === 'admin' || 
    ['admin', 'админ', 'администратор'].includes(currentUser?.username?.toLowerCase() || '');

  const [localRate, setLocalRate] = useState(String(storageRatePerLiterDay || 0));
  const [isSavingRate, setIsSavingRate] = useState(false);

  React.useEffect(() => {
    setLocalRate(String(storageRatePerLiterDay || 0));
  }, [storageRatePerLiterDay]);

  const handleSaveStorageRate = async () => {
    const rateVal = parseFloat(localRate);
    if (isNaN(rateVal) || rateVal < 0) {
      toast.error('Введите корректную ставку хранения');
      return;
    }
    setIsSavingRate(true);
    try {
      const res = await fetchGas('saveGlobalSettings', { data: { storageRatePerLiterDay: rateVal } });
      if (res.status === 'success') {
        setStorageRatePerLiterDay(rateVal);
        toast.success('Ставка хранения успешно сохранена');
      } else {
        toast.error(res.message || 'Ошибка при сохранении ставки');
      }
    } catch (e: any) {
      toast.error(e.message || 'Ошибка при сохранении ставки');
    } finally {
      setIsSavingRate(false);
    }
  };

  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', cost: '' });
  const [confirmDeleteService, setConfirmDeleteService] = useState<{id: string, name: string} | null>(null);

  const [expandedServiceId, setExpandedServiceId] = useState<string | null>(null);
  const [rateCost, setRateCost] = useState('');
  const [rateValidFrom, setRateValidFrom] = useState('');

  const toggleExpandService = (serviceId: string) => {
    if (expandedServiceId === serviceId) {
      setExpandedServiceId(null);
    } else {
      setExpandedServiceId(serviceId);
      setRateCost('');
      setRateValidFrom('');
    }
  };

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
    useWarehouseStore.getState().fetchGas('saveGlobalSettings', { data: { serviceOrder: JSON.stringify(newOrderIds) } });
  };

  return (
    <div 
      className="max-w-4xl mx-auto space-y-6 pb-24 tab-enter"
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

      {/* Блок Хранение */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900">Хранение товаров</h3>
            <p className="text-sm text-slate-500">Настройка тарифа для расчета стоимости хранения литража на складе.</p>
          </div>
        </div>

        <div className="flex items-end gap-4 max-w-md">
          <div className="flex-1 space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase">Стоимость хранения 1 л/сутки, ₽</label>
            <div className="relative">
              <input
                type="number"
                step="0.01"
                min="0"
                disabled={!isAdmin || isSavingRate}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-medium disabled:opacity-60"
                value={localRate}
                onChange={(e) => setLocalRate(e.target.value)}
              />
              <span className="absolute right-4 inset-y-0 flex items-center text-slate-400 text-sm font-medium">₽</span>
            </div>
          </div>
          {isAdmin && (
            <button
              onClick={handleSaveStorageRate}
              disabled={isSavingRate}
              className="px-6 py-3 bg-slate-900 text-white rounded-2xl text-sm font-bold hover:bg-slate-800 transition-all shadow-md shrink-0 flex items-center gap-2"
            >
              {isSavingRate ? 'Сохранение...' : 'Сохранить ставку'}
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden min-w-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[500px]">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <th className="px-6 py-4 text-left text-xs font-bold text-slate-400 uppercase tracking-wider">Название услуги</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-slate-400 uppercase tracking-wider">Стоимость</th>
                <th className="px-6 py-4 text-right text-xs font-bold text-slate-400 uppercase tracking-wider w-48">Действия</th>
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
                  <td colSpan={3} className="px-6 py-12 text-center text-slate-500">
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

                const rates = serviceRates
                  .filter(r => String(r.serviceId) === String(service.id))
                  .sort((a, b) => b.validFrom.localeCompare(a.validFrom));

                return (
                  <React.Fragment key={service.id}>
                    <tr className="hover:bg-slate-50 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="font-medium text-slate-900">{service.name}</div>
                      </td>
                      <td className="px-6 py-4 font-mono font-medium text-slate-700">
                        {formatCurrency(service.cost)} ₽
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-1 opacity-100 transition-opacity items-center">
                          <button
                            onClick={() => toggleExpandService(service.id)}
                            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1 shrink-0 ${
                              expandedServiceId === service.id
                                ? 'bg-indigo-600 text-white shadow-sm ring-2 ring-indigo-500/20'
                                : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'
                            }`}
                            title="Тарифы"
                          >
                            <Clock className="w-3.5 h-3.5" />
                            Тарифы ({rates.length})
                          </button>

                          {isAdmin && (
                            <>
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
                              <div className="w-1"></div> {/* Small Separator */}
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
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    
                    {expandedServiceId === service.id && (
                      <tr className="bg-slate-50/40 border-l-4 border-l-indigo-500">
                        <td colSpan={3} className="px-6 py-4">
                          <div className="p-5 bg-white rounded-2xl border border-slate-100 shadow-sm grid md:grid-cols-2 gap-6 text-left max-w-3xl mx-auto">
                            {/* Left: list of tariffs */}
                            <div className="space-y-3">
                              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                                <Clock className="w-3.5 h-3.5 text-slate-400" />
                                История тарифов
                              </h4>
                              {rates.length === 0 ? (
                                <p className="text-xs text-slate-400 italic py-2">
                                  Тарифы по датам не заданы. Действует базовая цена: {formatCurrency(service.cost)} ₽
                                </p>
                              ) : (
                                <div className="max-h-48 overflow-y-auto border border-slate-100 rounded-xl divide-y divide-slate-100 bg-slate-50/50">
                                  {rates.map((rate, rIdx) => (
                                    <div key={rIdx} className="flex justify-between items-center px-4 py-2.5 text-sm hover:bg-white transition-colors">
                                      <span className="font-mono font-medium text-slate-700">{formatCurrency(rate.cost)} ₽</span>
                                      <span className="text-xs text-slate-500 bg-white px-2 py-1 rounded-md border border-slate-100 font-medium">{rate.validFrom}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Right: Add new tariff form (for Admin only) */}
                            {isAdmin ? (
                              <div className="space-y-3">
                                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Добавить тариф</h4>
                                <form onSubmit={async (e) => {
                                  e.preventDefault();
                                  const costVal = parseFloat(rateCost);
                                  if (isNaN(costVal) || costVal < 0) {
                                    toast.error('Введите корректную стоимость тарифа');
                                    return;
                                  }
                                  if (!rateValidFrom) {
                                    toast.error('Выберите дату начала действия тарифа');
                                    return;
                                  }
                                  const success = await handleAddServiceRate(service.id, costVal, rateValidFrom);
                                  if (success) {
                                    setRateCost('');
                                    setRateValidFrom('');
                                  }
                                }} className="space-y-3">
                                  <div className="grid grid-cols-2 gap-2">
                                    <div className="relative">
                                      <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all pr-6 font-medium"
                                        placeholder="0.00"
                                        value={rateCost}
                                        onChange={(e) => setRateCost(e.target.value)}
                                      />
                                      <span className="absolute right-2.5 inset-y-0 flex items-center text-slate-400 text-xs font-medium">₽</span>
                                    </div>
                                    <input
                                      type="date"
                                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-slate-700"
                                      value={rateValidFrom}
                                      onChange={(e) => setRateValidFrom(e.target.value)}
                                    />
                                  </div>
                                  <button
                                    type="submit"
                                    className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition-colors shadow-sm"
                                  >
                                    <Plus className="w-3.5 h-3.5" />
                                    Добавить тариф
                                  </button>
                                </form>
                              </div>
                            ) : (
                              <div className="flex flex-col justify-center items-center text-center p-4 border border-dashed border-slate-100 rounded-2xl bg-slate-50/50">
                                <ShieldAlert className="w-8 h-8 text-slate-300 mb-2" />
                                <p className="text-xs text-slate-500 max-w-[240px]">
                                  Только администраторы могут добавлять новые тарифы с привязкой к дате.
                                </p>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
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
    </div>
  );
});
