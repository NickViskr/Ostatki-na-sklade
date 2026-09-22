import React, { useMemo, useState } from 'react';
import { 
  X, 
  Save, 
  Loader2 
} from 'lucide-react';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { useUIStore } from '../store/useUIStore';

import { toast } from 'sonner';
import { daysSinceReceipt, formatCurrency, RECEIPT_EDIT_WINDOW_DAYS } from '../lib/utils';
import { resolveServiceCostAt } from '../lib/serviceRates';
import {
  buildDestination,
  extrasTotal,
  ExtrasServiceEntry,
  parseShipmentExtras,
  rowMoneyAfterExtras
} from '../lib/shipmentExtras';

export const EditTransModal: React.FC = () => {
  const isProcessing = useWarehouseStore((state) => state.isProcessing);
  const handleUpdateTransaction = useWarehouseStore((state) => state.handleUpdateTransaction);
  
  const editingTrans = useUIStore((state) => state.editingTrans);
  const setEditingTrans = useUIStore((state) => state.setEditingTrans);
  const setShowEditTransModal = useUIStore((state) => state.setShowEditTransModal);

  // ---- Item 80. Additional costs of the shipment this row belongs to ----------------------
  // Packaging, «Прочее» and the services are paid once for the whole shipment and spread over
  // its rows by pieces, so they are edited for the shipment as a whole — the object name stays
  // the only free text here, and the tail of «Объект» is composed from the fields below.
  const transactions = useWarehouseStore((state) => state.transactions);
  const services = useWarehouseStore((state) => state.services);
  const serviceRates = useWarehouseStore((state) => state.serviceRates);
  const updateShipmentExtras = useWarehouseStore((state) => state.updateShipmentExtras);

  const isExpense = editingTrans?.type === 'Расход';
  const original = useMemo(
    () => parseShipmentExtras(editingTrans?.destination || ''),
    [editingTrans?.destination]
  );
  const isBatchOrder = original.keptGroups.some((group) =>
    group.some((tag) => tag.toLowerCase().startsWith('общая поставка'))
  );

  // The rows of the same shipment: the same moment, the same type and the same object. They are
  // taken from what «История» has loaded, so the preview below is what this screen can see; the
  // server finds every row of the operation itself and its answer replaces the list afterwards.
  const shipmentRows = useMemo(() => {
    if (!editingTrans) return [];
    return (transactions || []).filter(
      (t) =>
        t.date === editingTrans.date &&
        t.type === editingTrans.type &&
        t.destination === editingTrans.destination
    );
  }, [transactions, editingTrans]);

  const [extrasOpen, setExtrasOpen] = useState(false);
  const [packaging, setPackaging] = useState<string>(String(original.packaging || 0));
  const [other, setOther] = useState<string>(String(original.other || 0));
  const [serviceQty, setServiceQty] = useState<Record<string, number>>({});
  const [extrasKey, setExtrasKey] = useState<string>('');

  // The shipment of the row currently open: the fields are filled from it once per row.
  const rowKey = String(editingTrans?.id || '');
  if (rowKey !== extrasKey) {
    setExtrasKey(rowKey);
    setPackaging(String(original.packaging || 0));
    setOther(String(original.other || 0));
    const filled: Record<string, number> = {};
    for (const entry of original.services) filled[entry.name] = entry.quantity;
    setServiceQty(filled);
    setExtrasOpen(false);
  }

  /** Услуги справочника плюс те, что записаны в поставке, но из справочника уже убраны. */
  const serviceLines = useMemo(() => {
    const day = editingTrans?.deliveryDate || String(editingTrans?.date || '').slice(0, 10);
    const lines = (services || [])
      .filter((s) => s.isActive || original.services.some((e) => e.name === s.name))
      .map((s) => ({
        name: s.name,
        unitCost: resolveServiceCostAt(serviceRates, services, s.id, day),
        known: true
      }));
    for (const entry of original.services) {
      if (!lines.some((l) => l.name === entry.name)) {
        lines.push({ name: entry.name, unitCost: entry.unitCost, known: false });
      }
    }
    // Цена берётся из самой поставки: тариф мог смениться уже после неё.
    return lines.map((l) => {
      const stored = original.services.find((e) => e.name === l.name);
      return stored ? { ...l, unitCost: stored.unitCost } : l;
    });
  }, [services, serviceRates, original, editingTrans?.deliveryDate, editingTrans?.date]);

  const editedExtras = useMemo(() => ({
    ...original,
    packaging: Number(packaging) || 0,
    other: Number(other) || 0,
    services: serviceLines
      .map<ExtrasServiceEntry>((l) => ({ name: l.name, quantity: serviceQty[l.name] || 0, unitCost: l.unitCost }))
      .filter((e) => e.quantity > 0)
  }), [original, packaging, other, serviceLines, serviceQty]);

  const oldExtrasTotal = extrasTotal(original);
  const newExtrasTotal = extrasTotal(editedExtras);
  const extrasChanged = newExtrasTotal !== oldExtrasTotal
    || buildDestination(editedExtras, original) !== buildDestination(original, original);
  const preview = useMemo(
    () => rowMoneyAfterExtras(shipmentRows, oldExtrasTotal, newExtrasTotal),
    [shipmentRows, oldExtrasTotal, newExtrasTotal]
  );

  const handleSaveExtras = async () => {
    const ok = await updateShipmentExtras({
      id: editingTrans!.id,
      packaging: Number(packaging) || 0,
      other: Number(other) || 0,
      services: editedExtras.services
    });
    if (ok) setShowEditTransModal(false);
  };

  if (!editingTrans) return null;

  // Подэтап 3. Окно правки прихода. Решает сервер, экран лишь не обманывает: без этого
  // кнопка обещала бы сохранение, а ответом прилетал бы отказ.
  const receiptAgeDays = editingTrans.type === 'Приход' ? daysSinceReceipt(editingTrans.date) : 0;
  const isReceiptLocked = receiptAgeDays > RECEIPT_EDIT_WINDOW_DAYS;

  const handleSave = async () => {
    if (isReceiptLocked) {
      toast.error(`Приход старше ${RECEIPT_EDIT_WINDOW_DAYS} дней править нельзя: этому приходу ${receiptAgeDays} дн.`);
      return;
    }
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
          {isReceiptLocked && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-6 py-4 text-sm text-amber-800">
              <span className="font-bold">Править этот приход уже нельзя.</span> Ему {receiptAgeDays} дн.,
              а себестоимость поступившего товара меняется не позднее {RECEIPT_EDIT_WINDOW_DAYS} дней
              с даты поступления на склад.
            </div>
          )}

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

          {isExpense && (
            <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-bold text-slate-500 uppercase">Доп. расходы поставки</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Сейчас {formatCurrency(oldExtrasTotal)} ₽ на всю поставку
                    {shipmentRows.length > 1 ? `, разнесено по ${shipmentRows.length} строкам` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  id="btn-edit-extras"
                  onClick={() => setExtrasOpen(!extrasOpen)}
                  className="px-4 py-2 rounded-xl text-sm font-bold text-indigo-600 border border-indigo-200 bg-white hover:bg-indigo-50 transition-all whitespace-nowrap"
                >
                  {extrasOpen ? 'Свернуть' : 'Изменить'}
                </button>
              </div>

              {extrasOpen && isBatchOrder && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                  Эта заявка списана в составе общей поставки: её доля расходов посчитана от всей
                  партии, и править услуги по одной заявке нельзя.
                </div>
              )}

              {extrasOpen && !isBatchOrder && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-400 uppercase">Упаковка, ₽</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={packaging}
                        onChange={(e) => setPackaging(e.target.value)}
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-400 uppercase">Прочее, ₽</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={other}
                        onChange={(e) => setOther(e.target.value)}
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50/70 text-[10px] uppercase tracking-widest text-slate-400">
                          <th className="px-4 py-2 text-left font-bold">Услуга</th>
                          <th className="px-3 py-2 w-24 text-right font-bold">Кол-во</th>
                          <th className="px-3 py-2 w-24 text-right font-bold">Цена</th>
                          <th className="px-4 py-2 w-28 text-right font-bold">Итого</th>
                        </tr>
                      </thead>
                      <tbody>
                        {serviceLines.map((line) => {
                          const qty = serviceQty[line.name] || 0;
                          return (
                            <tr key={line.name} className="border-b border-slate-50 last:border-b-0">
                              <td className="px-4 py-2 text-slate-700">
                                {line.name}
                                {!line.known && (
                                  <span className="ml-2 text-[10px] text-amber-600">нет в справочнике</span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right">
                                <input
                                  type="number"
                                  min="0"
                                  value={qty === 0 ? '' : qty}
                                  placeholder="0"
                                  onChange={(e) => setServiceQty({
                                    ...serviceQty,
                                    [line.name]: Math.max(0, parseInt(e.target.value, 10) || 0)
                                  })}
                                  className="w-20 px-2 py-1.5 rounded-lg border border-slate-200 text-right outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                              </td>
                              <td className="px-3 py-2 text-right text-slate-500">{formatCurrency(line.unitCost)}</td>
                              <td className="px-4 py-2 text-right font-semibold text-slate-700">
                                {formatCurrency(qty * line.unitCost)}
                              </td>
                            </tr>
                          );
                        })}
                        {serviceLines.length === 0 && (
                          <tr>
                            <td colSpan={4} className="px-4 py-3 text-xs text-slate-400">
                              В справочнике нет услуг — добавьте их на вкладке «Справочник».
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="rounded-xl bg-white border border-slate-200 px-4 py-3 text-xs text-slate-600 space-y-1">
                    <div className="font-bold text-slate-700">
                      Итого расходов: {formatCurrency(oldExtrasTotal)} ₽ → {formatCurrency(newExtrasTotal)} ₽
                    </div>
                    {preview.map((row) => {
                      const source = shipmentRows.find((t) => t.id === row.id);
                      if (!source) return null;
                      return (
                        <div key={row.id} className="flex justify-between gap-3">
                          <span className="text-slate-500">{source.article}</span>
                          <span>
                            {formatCurrency(source.total)} ₽ → <span className="font-semibold">{formatCurrency(row.total)} ₽</span>
                          </span>
                        </div>
                      );
                    })}
                    <div className="text-slate-400">
                      Количество товара, себестоимость списания и остатки склада не меняются.
                    </div>
                  </div>

                  <button
                    type="button"
                    id="btn-save-extras"
                    onClick={handleSaveExtras}
                    disabled={isProcessing || !extrasChanged}
                    className="w-full py-3 rounded-xl bg-indigo-600 text-white font-bold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                  >
                    {isProcessing ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                    Сохранить доп. расходы поставки
                  </button>
                </div>
              )}
            </div>
          )}

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
            disabled={isProcessing || isReceiptLocked}
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
