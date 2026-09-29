import React, { useMemo, useState } from 'react';
import { X, Save, Loader2 } from 'lucide-react';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { useUIStore } from '../store/useUIStore';
import { formatCurrency } from '../lib/utils';
import { resolveServiceCostAt } from '../lib/serviceRates';
import { wholeShipmentNewExtras, wholeShipmentView } from '../lib/wholeShipment';
import {
  buildDestination,
  ExtrasMode,
  ExtrasServiceEntry,
  parseShipmentExtras
} from '../lib/shipmentExtras';

/**
 * Item 90. «Вся отгрузка»: the extras (packaging, «Прочее», services) and the comment of the WHOLE
 * shipment a History row belongs to. The new total is spread over the orders by pieces on the
 * server; the shares shown here are the browser twin of that arithmetic (src/lib/wholeShipment.ts).
 */
export const WholeShipmentModal: React.FC = () => {
  const isProcessing = useWarehouseStore((state) => state.isProcessing);
  const transactions = useWarehouseStore((state) => state.transactions);
  const services = useWarehouseStore((state) => state.services);
  const serviceRates = useWarehouseStore((state) => state.serviceRates);
  const updateShipmentExtras = useWarehouseStore((state) => state.updateShipmentExtras);

  const anchor = useUIStore((state) => state.wholeShipmentAnchor);
  const setShowWholeShipmentModal = useUIStore((state) => state.setShowWholeShipmentModal);

  type AmountField = { mode: ExtrasMode; value: string };
  const amountFieldOf = (total: number, unit: number): AmountField =>
    unit > 0 ? { mode: 'unit', value: String(unit) } : { mode: 'batch', value: String(total || 0) };

  const original = useMemo(() => parseShipmentExtras(anchor?.destination || ''), [anchor?.destination]);
  const [packaging, setPackaging] = useState<AmountField>(() => amountFieldOf(original.packaging, original.packagingUnit));
  const [other, setOther] = useState<AmountField>(() => amountFieldOf(original.other, original.otherUnit));
  const [serviceQty, setServiceQty] = useState<Record<string, number>>(
    () => Object.fromEntries(original.services.map((e) => [e.name, e.quantity]))
  );
  const [comment, setComment] = useState<string>(anchor?.comment ?? '');

  /** Services of the reference book plus those written in the shipment but since removed from it. */
  const serviceLines = useMemo(() => {
    const day = anchor?.deliveryDate || String(anchor?.date || '').slice(0, 10);
    const lines = (services || [])
      .filter((s) => s.isActive || original.services.some((e) => e.name === s.name))
      .map((s) => ({ name: s.name, unitCost: resolveServiceCostAt(serviceRates, services, s.id, day), known: true }));
    for (const entry of original.services) {
      if (!lines.some((l) => l.name === entry.name)) {
        lines.push({ name: entry.name, unitCost: entry.unitCost, known: false });
      }
    }
    // The price is the shipment's own: the tariff may have changed after it.
    return lines.map((l) => {
      const stored = original.services.find((e) => e.name === l.name);
      return stored ? { ...l, unitCost: stored.unitCost } : l;
    });
  }, [services, serviceRates, original, anchor?.deliveryDate, anchor?.date]);

  // The new extras and their total come from ONE pure function (twin of the server's head of
  // updateShipmentExtras): pieces of the WHOLE shipment first, an amount «на единицу» multiplies by them.
  const newExtras = useMemo(() => {
    if (!anchor) return null;
    return wholeShipmentNewExtras(transactions || [], anchor, {
      packaging: { mode: packaging.mode, value: Number(packaging.value) || 0 },
      other: { mode: other.mode, value: Number(other.value) || 0 },
      services: serviceLines.map<ExtrasServiceEntry>((l) => ({ name: l.name, quantity: serviceQty[l.name] || 0, unitCost: l.unitCost }))
    });
  }, [transactions, anchor, packaging, other, serviceLines, serviceQty]);
  const pieces = newExtras?.pieces ?? 0;
  const packagingTotal = newExtras?.extras.packaging ?? 0;
  const otherTotal = newExtras?.extras.other ?? 0;
  const editedExtras = newExtras?.extras ?? original;
  const newExtrasTotal = newExtras?.total ?? 0;

  const view = useMemo(
    () => (anchor ? wholeShipmentView(transactions || [], anchor, newExtrasTotal) : null),
    [transactions, anchor, newExtrasTotal]
  );

  if (!anchor || !view) return null;

  const oldExtrasTotal = view.kind === 'ok' ? view.oldTotal : 0;
  const extrasChanged = newExtrasTotal !== oldExtrasTotal
    || buildDestination(editedExtras, original, pieces) !== buildDestination(original, original, pieces);
  const commentChanged = comment.trim() !== String(anchor.comment ?? '').trim();

  const handleSave = async () => {
    const ok = await updateShipmentExtras({
      id: anchor.id,
      packagingMode: packaging.mode,
      packagingValue: Number(packaging.value) || 0,
      otherMode: other.mode,
      otherValue: Number(other.value) || 0,
      services: editedExtras.services,
      comment
    });
    if (ok) setShowWholeShipmentModal(false);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 fade-in">
      <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-2xl overflow-hidden modal-enter flex flex-col max-h-[90vh]">
        <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 shrink-0">
          <h3 className="text-2xl font-bold">Вся отгрузка</h3>
          <button
            onClick={() => setShowWholeShipmentModal(false)}
            className="p-3 hover:bg-white rounded-2xl transition-all shadow-sm border border-transparent hover:border-slate-200"
          >
            <X size={24} />
          </button>
        </div>

        <div className="p-8 space-y-6 overflow-y-auto grow">
          {view.kind === 'refused' && (
            <div data-testid="whole-shipment-refusal" className="rounded-2xl border border-amber-200 bg-amber-50 px-6 py-4 text-sm text-amber-800">
              {view.reason}
            </div>
          )}

          {view.kind === 'ok' && (
            <>
              <div className="space-y-2">
                <div className="text-sm font-bold text-slate-500 uppercase">
                  Заявки отгрузки, всего {view.totalPieces} шт.
                </div>
                {view.orders.map((o) => (
                  <div key={o.opId || o.label} className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-sm">
                    <div className="flex justify-between gap-3 font-semibold text-slate-700">
                      <span>{o.label}</span>
                      <span>{o.pieces} шт.</span>
                    </div>
                    {o.articles.map((a) => (
                      <div key={a.article} className="flex justify-between gap-3 text-xs text-slate-500">
                        <span>{a.article}</span>
                        <span>{a.quantity} шт.</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>

              <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                <div className="text-sm font-bold text-slate-500 uppercase">Доп. расходы отгрузки</div>
                <div className="grid grid-cols-2 gap-3">
                  {([
                    { key: 'packaging', label: 'Упаковка', state: packaging, set: setPackaging, total: packagingTotal },
                    { key: 'other', label: 'Прочее', state: other, set: setOther, total: otherTotal }
                  ] as const).map((field) => (
                    <div key={field.key} className="space-y-1">
                      <div className="flex justify-between items-center gap-2">
                        <label className="text-xs font-bold text-slate-400 uppercase">{field.label}, ₽</label>
                        <select
                          value={field.state.mode}
                          onChange={(e) => field.set({ ...field.state, mode: e.target.value as ExtrasMode })}
                          className="text-[10px] font-bold text-indigo-600 bg-indigo-50 rounded-lg px-2 py-1 outline-none cursor-pointer hover:bg-indigo-100 transition-colors"
                        >
                          <option value="unit">На единицу</option>
                          <option value="batch">На партию</option>
                        </select>
                      </div>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={field.state.value}
                        onChange={(e) => field.set({ ...field.state, value: e.target.value })}
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <div className="text-[10px] text-slate-400">
                        {field.state.mode === 'unit'
                          ? `${pieces} шт. → ${formatCurrency(field.total)} ₽ на отгрузку`
                          : 'сумма на всю отгрузку'}
                      </div>
                    </div>
                  ))}
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
                              {!line.known && <span className="ml-2 text-[10px] text-amber-600">нет в справочнике</span>}
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
                    Итого расходов: {formatCurrency(view.oldTotal)} ₽ → {formatCurrency(view.newTotal)} ₽
                  </div>
                  {view.orders.map((o) => (
                    <div key={o.opId || o.label} className="flex justify-between gap-3">
                      <span className="text-slate-500">{o.label}</span>
                      <span>
                        {formatCurrency(o.oldShare)} ₽ → <span className="font-semibold">{formatCurrency(o.newShare)} ₽</span>
                      </span>
                    </div>
                  ))}
                  <div className="text-slate-400">
                    Количество товара, себестоимость списания и остатки склада не меняются.
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-500 uppercase">Комментарий</label>
                <input
                  type="text"
                  data-testid="input-whole-shipment-comment"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Необязательно — заметка для себя, ставится на все заявки отгрузки"
                  className="w-full px-6 py-4 rounded-2xl border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </>
          )}
        </div>

        <div className="p-8 bg-slate-50 border-t border-slate-100 flex gap-4 shrink-0">
          <button
            onClick={() => setShowWholeShipmentModal(false)}
            className="flex-1 py-4 rounded-2xl font-bold text-slate-500 hover:bg-white transition-all border border-transparent hover:border-slate-200"
          >
            {view.kind === 'refused' ? 'Закрыть' : 'Отмена'}
          </button>
          {view.kind === 'ok' && (
            <button
              onClick={handleSave}
              disabled={isProcessing || !(extrasChanged || commentChanged)}
              className="flex-1 bg-slate-900 text-white py-4 rounded-2xl font-bold hover:bg-slate-800 disabled:opacity-50 transition-all shadow-xl flex items-center justify-center gap-2"
            >
              {isProcessing ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
              Сохранить
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
