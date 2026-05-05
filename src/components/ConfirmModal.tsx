import React, { useState, useMemo } from 'react';
import { 
  CheckCircle2, 
  X, 
  AlertCircle, 
  MessageSquare, 
  Loader2,
  Calculator
} from 'lucide-react';
import { motion } from 'motion/react';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { useUIStore } from '../store/useUIStore';
import { formatCurrency } from '../lib/utils';

export const ConfirmModal: React.FC = () => {
  const isProcessing = useWarehouseStore((state) => state.isProcessing);
  const commitTransaction = useWarehouseStore((state) => state.commitTransaction);
  const handleProcessInvoice = useWarehouseStore((state) => state.handleProcessInvoice);
  
  const parsedItems = useUIStore((state) => state.parsedItems);
  const setParsedItems = useUIStore((state) => state.setParsedItems);
  const updateParsedItem = useUIStore((state) => state.updateParsedItem);
  const opType = useUIStore((state) => state.opType);
  const uploadDestination = useUIStore((state) => state.uploadDestination);
  const aiFeedback = useUIStore((state) => state.aiFeedback);
  const setAiFeedback = useUIStore((state) => state.setAiFeedback);
  const setShowConfirmModal = useUIStore((state) => state.setShowConfirmModal);

  // Additional costs state for 'Расход'
  const [packagingCost, setPackagingCost] = useState<number | ''>('');
  const [packagingDist, setPackagingDist] = useState<'batch' | 'unit'>('batch');
  
  const [transportCost, setTransportCost] = useState<number | ''>('');
  const [transportDist, setTransportDist] = useState<'batch' | 'unit'>('batch');
  
  const [otherCost, setOtherCost] = useState<number | ''>('');
  const [otherDist, setOtherDist] = useState<'batch' | 'unit'>('batch');

  const [deliveryDate, setDeliveryDate] = useState<string>('');

  const services = useWarehouseStore((state) => state.services);
  const activeServices = useMemo(() => services.filter(s => s.isActive), [services]);
  const [selectedServices, setSelectedServices] = useState<Record<string, boolean>>({});

  const finalItems = useMemo(() => {
    if (!parsedItems) return [];
    
    // Подсчитываем общую стоимость выбранных услуг
    const selectedActiveServices = activeServices.filter(s => selectedServices[s.id]);
    const totalServicesCost = selectedActiveServices.reduce((sum, s) => sum + s.cost, 0);
    
    const totalBaseValue = parsedItems.reduce((sum, item) => sum + (item.quantity * item.price), 0);
    
    // Вспомогательная функция для расчета доли услуги на единицу товара
    const getServicesExtraPerUnit = (item: typeof parsedItems[0]) => {
      if (totalServicesCost === 0 || totalBaseValue === 0) return 0;
      const itemBaseValue = item.quantity * item.price;
      const shareRatio = itemBaseValue / totalBaseValue;
      const extraCostForLine = totalServicesCost * shareRatio;
      return item.quantity > 0 ? extraCostForLine / item.quantity : 0;
    };

    if (opType === 'Приход') {
      if (totalServicesCost === 0) return parsedItems;
      
      return parsedItems.map(item => {
        return {
          ...item,
          price: item.price + getServicesExtraPerUnit(item)
        };
      });
    }

    if (opType !== 'Расход') return parsedItems;

    const pack = Number(packagingCost) || 0;
    const trans = Number(transportCost) || 0;
    const other = Number(otherCost) || 0;

    if (pack === 0 && trans === 0 && other === 0 && totalServicesCost === 0) return parsedItems;

    const totalQuantity = parsedItems.reduce((acc, item) => acc + item.quantity, 0);

    return parsedItems.map(item => {
      const packPerUnit = packagingDist === 'unit' ? pack : (totalQuantity > 0 ? pack / totalQuantity : 0);
      const transPerUnit = transportDist === 'unit' ? trans : (totalQuantity > 0 ? trans / totalQuantity : 0);
      const otherPerUnit = otherDist === 'unit' ? other : (totalQuantity > 0 ? other / totalQuantity : 0);
      
      const extraPerUnit = packPerUnit + transPerUnit + otherPerUnit + getServicesExtraPerUnit(item);
      
      return {
        ...item,
        price: item.price + extraPerUnit
      };
    });
  }, [parsedItems, opType, packagingCost, packagingDist, transportCost, transportDist, otherCost, otherDist, activeServices, selectedServices]);

  if (!parsedItems) return null;

  const isConfirmDisabled = isProcessing || finalItems.length === 0 || finalItems.some(item => item.status === 'error');

  const handleConfirm = async () => {
    let finalDestination = uploadDestination;
    const selectedActiveServices = activeServices.filter(s => selectedServices[s.id]);
    if (selectedActiveServices.length > 0) {
      const servicesText = selectedActiveServices.map(s => `${s.name} (${s.cost}₽)`).join(', ');
      finalDestination = finalDestination ? `${finalDestination} [Услуги: ${servicesText}]` : `[Услуги: ${servicesText}]`;
    }
    
    const success = await commitTransaction(finalItems, opType, finalDestination, deliveryDate);
    if (success) {
      setShowConfirmModal(false);
      setParsedItems(null);
      useUIStore.getState().setRawText('');
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
        className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col"
      >
        <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <div>
            <h3 className="text-2xl font-bold">Подтверждение операции</h3>
            <p className="text-slate-500">Проверьте распознанные данные перед записью</p>
          </div>
          <button 
            onClick={() => setShowConfirmModal(false)}
            className="p-3 hover:bg-white rounded-2xl transition-all shadow-sm border border-transparent hover:border-slate-200"
          >
            <X size={24} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-8 space-y-8">
          {(opType === 'Приход' || opType === 'Расход') && activeServices.length > 0 && (
            <div className="bg-indigo-50/50 p-6 rounded-3xl border border-indigo-100 space-y-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2 text-indigo-600 font-bold">
                  <Calculator size={20} />
                  Дополнительные услуги подрядчиков
                </div>
                <div className="text-xs font-bold text-indigo-500 uppercase tracking-widest bg-indigo-100 px-3 py-1 rounded-full">Увеличивают себестоимость</div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {activeServices.map(service => (
                  <label key={service.id} className="flex items-center gap-4 p-4 bg-white rounded-2xl border border-indigo-50 shadow-sm cursor-pointer hover:border-indigo-200 transition-colors group">
                    <input 
                      type="checkbox"
                      checked={!!selectedServices[service.id]}
                      onChange={(e) => setSelectedServices(prev => ({ ...prev, [service.id]: e.target.checked }))}
                      className="w-5 h-5 text-indigo-600 rounded-lg border-slate-300 focus:ring-indigo-500"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-slate-800 truncate group-hover:text-indigo-700 transition-colors">{service.name}</div>
                      <div className="text-sm font-medium text-indigo-600">{formatCurrency(service.cost)} ₽</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {opType === 'Расход' && (
            <div className="bg-indigo-50/50 p-6 rounded-3xl border border-indigo-100 space-y-4">
              <div className="flex items-center gap-2 text-indigo-600 font-bold mb-4">
                <Calculator size={20} />
                Дополнительные расходы на отгрузку
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2 bg-white p-4 rounded-2xl border border-indigo-50 shadow-sm">
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Стоимость упаковки</label>
                    <select 
                      value={packagingDist}
                      onChange={(e) => setPackagingDist(e.target.value as 'batch' | 'unit')}
                      className="text-[10px] font-bold text-indigo-600 bg-indigo-50 rounded-lg px-2 py-1 outline-none cursor-pointer hover:bg-indigo-100 transition-colors"
                    >
                      <option value="batch">На партию</option>
                      <option value="unit">На единицу</option>
                    </select>
                  </div>
                  <input 
                    type="number"
                    value={packagingCost}
                    onChange={(e) => setPackagingCost(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="0 ₽"
                    className="w-full px-4 py-3 rounded-xl border border-indigo-100 bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                  />
                </div>
                <div className="space-y-2 bg-white p-4 rounded-2xl border border-indigo-50 shadow-sm">
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Транспортные расходы</label>
                    <select 
                      value={transportDist}
                      onChange={(e) => setTransportDist(e.target.value as 'batch' | 'unit')}
                      className="text-[10px] font-bold text-indigo-600 bg-indigo-50 rounded-lg px-2 py-1 outline-none cursor-pointer hover:bg-indigo-100 transition-colors"
                    >
                      <option value="batch">На партию</option>
                      <option value="unit">На единицу</option>
                    </select>
                  </div>
                  <input 
                    type="number"
                    value={transportCost}
                    onChange={(e) => setTransportCost(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="0 ₽"
                    className="w-full px-4 py-3 rounded-xl border border-indigo-100 bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                  />
                </div>
                <div className="space-y-2 bg-white p-4 rounded-2xl border border-indigo-50 shadow-sm">
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Прочее</label>
                    <select 
                      value={otherDist}
                      onChange={(e) => setOtherDist(e.target.value as 'batch' | 'unit')}
                      className="text-[10px] font-bold text-indigo-600 bg-indigo-50 rounded-lg px-2 py-1 outline-none cursor-pointer hover:bg-indigo-100 transition-colors"
                    >
                      <option value="batch">На партию</option>
                      <option value="unit">На единицу</option>
                    </select>
                  </div>
                  <input 
                    type="number"
                    value={otherCost}
                    onChange={(e) => setOtherCost(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="0 ₽"
                    className="w-full px-4 py-3 rounded-xl border border-indigo-100 bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                  />
                </div>
              </div>
              <div className="text-xs text-indigo-400 mt-2 px-2">
                Эти суммы будут прибавлены к себестоимости каждого отгружаемого товара согласно выбранному методу распределения.
              </div>

              <div className="mt-4 pt-4 border-t border-indigo-100">
                <div className="space-y-2 bg-white p-4 rounded-2xl border border-indigo-50 shadow-sm w-full md:w-1/3">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-2">Дата поставки на маркетплейс</label>
                  <input 
                    type="date"
                    value={deliveryDate}
                    onChange={(e) => setDeliveryDate(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-indigo-100 bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 border-b border-slate-200">
                  <th className="px-6 py-4 font-bold text-slate-400 uppercase text-[10px] tracking-widest">Статус</th>
                  <th className="px-6 py-4 font-bold text-slate-400 uppercase text-[10px] tracking-widest">Артикул</th>
                  <th className="px-6 py-4 font-bold text-slate-400 uppercase text-[10px] tracking-widest text-right">Кол-во</th>
                  <th className="px-6 py-4 font-bold text-slate-400 uppercase text-[10px] tracking-widest text-right">{opType === 'Расход' ? 'Себест.' : 'Цена'}</th>
                  <th className="px-6 py-4 font-bold text-slate-400 uppercase text-[10px] tracking-widest text-right">Итого</th>
                </tr>
              </thead>
              <tbody>
                {finalItems.map((item, idx) => (
                  <tr key={idx} className="border-b border-slate-100 group hover:bg-slate-50/30 transition-colors">
                    <td className="px-6 py-4">
                      {item.status === 'ok' ? (
                        <div className="flex items-center gap-2 text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg w-fit">
                          <CheckCircle2 size={14} />
                          <span className="text-[10px] font-bold uppercase">{item.errorMsg || 'OK'}</span>
                        </div>
                      ) : (
                        <div className={`flex items-center gap-2 px-2 py-1 rounded-lg w-fit ${item.status === 'error' ? 'text-red-600 bg-red-50' : 'text-amber-600 bg-amber-50'}`}>
                          <AlertCircle size={14} />
                          <span className="text-[10px] font-bold uppercase">{item.errorMsg}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 font-mono text-sm font-bold text-indigo-600">
                      <input 
                        type="text"
                        value={item.article}
                        onChange={(e) => updateParsedItem(idx, { article: e.target.value })}
                        className="w-full bg-transparent border-b border-transparent hover:border-indigo-200 focus:border-indigo-500 outline-none transition-colors"
                      />
                    </td>
                    <td className="px-6 py-4 text-right font-bold">
                      <input 
                        type="number"
                        min="1"
                        value={item.quantity === 0 ? '' : item.quantity}
                        onChange={(e) => {
                          const val = Number(e.target.value) || 0;
                          updateParsedItem(idx, { quantity: val < 0 ? 0 : val });
                        }}
                        className="w-24 text-right bg-transparent border-b border-transparent hover:border-indigo-200 focus:border-indigo-500 outline-none transition-colors"
                      />
                    </td>
                    <td className="px-6 py-4 text-right font-medium whitespace-nowrap">
                      {opType === 'Приход' ? (
                        <div className="flex flex-col items-end gap-1">
                          <div className="flex items-center justify-end gap-1">
                            <input 
                              type="number"
                              min="0"
                              step="0.01"
                              value={parsedItems[idx].price === 0 ? '' : parsedItems[idx].price}
                              onChange={(e) => {
                                const val = Number(e.target.value) || 0;
                                updateParsedItem(idx, { price: val < 0 ? 0 : val });
                              }}
                              className="w-28 text-right bg-transparent border-b border-transparent hover:border-indigo-200 focus:border-indigo-500 outline-none transition-colors"
                            />
                            <span>₽</span>
                          </div>
                          {item.price > parsedItems[idx].price && (
                            <div className="text-[10px] text-indigo-500 font-bold" title="Цена с учетом услуг подрядчиков">
                              Итог: {formatCurrency(item.price)} ₽
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-col items-end gap-1">
                          <span>{formatCurrency(parsedItems[idx].price)} ₽</span>
                          {item.price > parsedItems[idx].price && (
                            <div className="text-[10px] text-indigo-500 font-bold" title="Цена с учетом дополнительных расходов (услуги, упаковка)">
                              Итог: {formatCurrency(item.price)} ₽
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right font-bold text-slate-900 whitespace-nowrap">{formatCurrency(item.quantity * item.price)} ₽</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* AI Feedback Section */}
          <div className="bg-indigo-50/50 p-6 rounded-3xl border border-indigo-100 space-y-4">
            <div className="flex items-center gap-2 text-indigo-600 font-bold">
              <MessageSquare size={20} />
              Уточнение для ИИ (если есть ошибки)
            </div>
            <div className="flex gap-4">
              <input 
                type="text"
                value={aiFeedback}
                onChange={(e) => setAiFeedback(e.target.value)}
                placeholder="Например: 'Артикул A001 на самом деле Смартфон X1', 'Пропусти вторую позицию'..."
                className="flex-1 px-6 py-4 rounded-2xl border border-indigo-100 bg-white outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
              />
              <button 
                onClick={() => handleProcessInvoice(aiFeedback)}
                disabled={isProcessing || !aiFeedback.trim()}
                className="bg-indigo-600 text-white px-8 rounded-2xl font-bold hover:bg-indigo-700 disabled:opacity-50 transition-all shadow-lg shadow-indigo-100 flex items-center gap-2"
              >
                {isProcessing ? <Loader2 className="animate-spin" size={20} /> : <Zap size={20} />}
                Пересчитать
              </button>
            </div>
          </div>
        </div>

        <div className="p-8 bg-slate-50 border-t border-slate-100 flex justify-between items-center">
          <div className="flex gap-8">
            <div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Всего позиций</div>
              <div className="text-2xl font-bold text-slate-900">{parsedItems.length}</div>
            </div>
            <div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Общая сумма</div>
              <div className="text-2xl font-bold text-indigo-600">
                {formatCurrency(finalItems.reduce((acc, item) => acc + (item.quantity * item.price), 0))} ₽
              </div>
            </div>
          </div>
          
          <div className="flex gap-4">
            <button 
              onClick={() => setShowConfirmModal(false)}
              className="px-8 py-4 rounded-2xl font-bold text-slate-500 hover:bg-white transition-all"
            >
              Отмена
            </button>
            <button 
              onClick={handleConfirm}
              disabled={isConfirmDisabled}
              className="bg-slate-900 text-white px-12 py-4 rounded-2xl font-bold hover:bg-slate-800 disabled:opacity-50 transition-all shadow-xl flex items-center gap-2"
            >
              {isProcessing ? <Loader2 className="animate-spin" size={20} /> : <CheckCircle2 size={20} />}
              Подтвердить и записать
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};

const Zap = ({ size, className }: { size?: number, className?: string }) => (
  <svg 
    width={size || 24} 
    height={size || 24} 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);
