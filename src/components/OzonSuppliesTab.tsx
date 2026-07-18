import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { ExternalShipment } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Package, 
  RefreshCw, 
  Loader2, 
  ChevronDown, 
  ChevronUp, 
  Calendar
} from 'lucide-react';
import { STATUS_DICT, getStatusDetails, getStatusLabel, isAcceptanceStage } from '../lib/ozonStatus';
import { useUIStore } from '../store/useUIStore';
import { toast } from 'sonner';
import { buildOzonGroups, useProcessOzonGroup, OzonGroup } from '../lib/ozonGroups';
import { computeShortageRecalc, parseRecalcJSON } from '../lib/ozonShortage';
import { detectPeresort } from '../lib/ozonPeresort';
import { formatCurrency } from '../lib/utils';
import { ConfirmDialog } from './ConfirmDialog';


const formatStatusDate = (dateStr?: string) => {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return dateStr;
  }
};

const parseAcceptance = (acceptedJSON?: string): Map<string, number> => {
  const map = new Map<string, number>();
  if (!acceptedJSON) return map;
  try {
    const parsed = JSON.parse(acceptedJSON);
    if (Array.isArray(parsed)) {
      parsed.forEach((item: any) => {
        if (item && typeof item.offerId === 'string' && typeof item.accepted === 'number') {
          map.set(item.offerId, item.accepted);
        }
      });
    }
  } catch (e) {
    console.error('Error parsing acceptedJSON:', e);
  }
  return map;
};

const renderItemsTable = (itemsJSON?: string, acceptedJSON?: string, recalcJSON?: string) => {
  if (!itemsJSON) {
    return <div className="text-slate-400 p-2 text-sm font-medium">Состав не загружен</div>;
  }
  try {
    const items = JSON.parse(itemsJSON);
    if (!Array.isArray(items) || items.length === 0) {
      return <div className="text-slate-400 p-2 text-sm font-medium">Состав не загружен</div>;
    }
    const acceptanceMap = parseAcceptance(acceptedJSON);
    const hasAcceptance = acceptedJSON !== undefined && acceptedJSON !== null && acceptedJSON !== '';
    const recalcItems = parseRecalcJSON(recalcJSON);

    return (
      <div className="overflow-x-auto mt-2 border border-slate-100 rounded-xl">
        <table className="min-w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              <th className="px-4 py-2.5 font-bold text-slate-400 uppercase tracking-wider">Артикул</th>
              <th className="px-4 py-2.5 font-bold text-slate-400 uppercase tracking-wider">Штрихкод</th>
              <th className="px-4 py-2.5 font-bold text-slate-400 uppercase tracking-wider">Кол-во</th>
              {hasAcceptance && (
                <th className="px-4 py-2.5 font-bold text-slate-400 uppercase tracking-wider">Принято</th>
              )}
              {recalcItems !== null && (
                <>
                  <th className="px-4 py-2.5 font-bold text-slate-400 uppercase tracking-wider">Себест. базовая</th>
                  <th className="px-4 py-2.5 font-bold text-slate-400 uppercase tracking-wider">Себест. скорр.</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {items.map((it: any, index: number) => {
              const offerId = it.offerId || it.offer_id || '';
              const quantity = it.quantity || it.qty || 0;
              let acceptedVal = quantity;
              let colorClass = '';

              if (hasAcceptance) {
                acceptedVal = acceptanceMap.has(offerId) ? acceptanceMap.get(offerId)! : quantity;
                if (acceptedVal < quantity) {
                  colorClass = 'text-red-600';
                } else if (acceptedVal > quantity) {
                  colorClass = 'text-amber-600';
                }
              }

              return (
                <tr key={index} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                  <td className="px-4 py-2 font-semibold text-slate-700">{offerId || '-'}</td>
                  <td className="px-4 py-2 font-mono text-slate-500">{it.barcode || '-'}</td>
                  <td className="px-4 py-2 font-bold text-slate-900">{quantity}</td>
                  {hasAcceptance && (
                    <td className={`px-4 py-2 font-bold ${colorClass}`}>{acceptedVal}</td>
                  )}
                  {recalcItems !== null && (() => {
                    const itemRecalc = recalcItems.find(ri => String(ri.offerId).toLowerCase() === String(offerId).toLowerCase());
                    if (itemRecalc) {
                      const isCostHigher = itemRecalc.adjustedUnitCost > itemRecalc.baseUnitCost;
                      return (
                        <>
                          <td className="px-4 py-2 font-mono text-slate-900">{formatCurrency(itemRecalc.baseUnitCost)} ₽</td>
                          <td className={`px-4 py-2 font-mono ${isCostHigher ? 'text-red-600 font-bold' : 'text-slate-900'}`}>
                            {formatCurrency(itemRecalc.adjustedUnitCost)} ₽
                          </td>
                        </>
                      );
                    } else {
                      return (
                        <>
                          <td className="px-4 py-2 text-slate-400">—</td>
                          <td className="px-4 py-2 text-slate-400">—</td>
                        </>
                      );
                    }
                  })()}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  } catch (e) {
    return <div className="text-slate-400 p-2 text-sm font-medium">Состав не загружен</div>;
  }
};

interface AcceptanceModalProps {
  shipment: ExternalShipment;
  onClose: () => void;
  saveShipmentAcceptance: (postingId: string, acceptedJSON: string) => Promise<boolean>;
}

const AcceptanceModal: React.FC<AcceptanceModalProps> = ({ shipment, onClose, saveShipmentAcceptance }) => {
  const [items, setItems] = useState<any[]>([]);
  const [acceptedValues, setAcceptedValues] = useState<Record<string, number>>({});
  const [extraItems, setExtraItems] = useState<{ article: string; accepted: number }[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const externalShipments = useWarehouseStore((state) => state.externalShipments);
  const transactions = useWarehouseStore((state) => state.transactions);
  const skus = useWarehouseStore((state) => state.skus);
  const saveShipmentShortageRecalc = useWarehouseStore((state) => state.saveShipmentShortageRecalc);

  useEffect(() => {
    try {
      const parsedItems = JSON.parse(shipment.itemsJSON || '[]');
      setItems(parsedItems);

      const accMap = parseAcceptance(shipment.acceptedJSON);
      const initialVals: Record<string, number> = {};
      parsedItems.forEach((it: any) => {
        const offerId = it.offerId || it.offer_id || '';
        const qty = it.quantity || it.qty || 0;
        if (shipment.acceptedJSON && accMap.has(offerId)) {
          initialVals[offerId] = accMap.get(offerId)!;
        } else {
          initialVals[offerId] = qty;
        }
      });
      setAcceptedValues(initialVals);

      // Загрузка extraItems, если в acceptedJSON есть записи с offerId, отсутствующим в itemsJSON (без учёта регистра)
      const declaredOfferIdsLower = new Set(
        parsedItems.map((it: any) => String(it.offerId || it.offer_id || '').trim().toLowerCase())
      );
      const extra: { article: string; accepted: number }[] = [];
      if (shipment.acceptedJSON) {
        try {
          const parsedAccepted = JSON.parse(shipment.acceptedJSON);
          if (Array.isArray(parsedAccepted)) {
            parsedAccepted.forEach((it: any) => {
              if (it && typeof it.offerId === 'string' && typeof it.accepted === 'number') {
                const offIdTrim = it.offerId.trim();
                if (!declaredOfferIdsLower.has(offIdTrim.toLowerCase())) {
                  extra.push({ article: offIdTrim, accepted: it.accepted });
                }
              }
            });
          }
        } catch (e) {
          console.error('Error parsing acceptedJSON for extra items:', e);
        }
      }
      setExtraItems(extra);
    } catch (e) {
      console.error(e);
    }
  }, [shipment]);

  const recalcPreview = useMemo(() => {
    const acceptedList: { offerId: string; accepted: number }[] = [];
    for (const it of items) {
      const offerId = it.offerId || it.offer_id || '';
      const val = acceptedValues[offerId];
      if (val === undefined || val === null || isNaN(val) || val < 0 || !Number.isInteger(val)) {
        return null;
      }
      acceptedList.push({ offerId, accepted: val });
    }

    for (const extra of extraItems) {
      const { article, accepted } = extra;
      if (!article || !article.trim() || accepted < 1 || !Number.isInteger(accepted)) {
        return null;
      }
      acceptedList.push({ offerId: article, accepted });
    }

    return computeShortageRecalc(
      { ...shipment, acceptedJSON: JSON.stringify(acceptedList) },
      externalShipments,
      transactions,
      skus
    );
  }, [items, acceptedValues, extraItems, shipment, externalShipments, transactions, skus]);

  const getAvailableSkusForIndex = (idx: number) => {
    const declaredOfferIdsLower = new Set(
      items.map((it: any) => String(it.offerId || it.offer_id || '').trim().toLowerCase())
    );
    const extraArticlesLower = new Set(
      extraItems
        .filter((_, i) => i !== idx)
        .map((it) => it.article.trim().toLowerCase())
    );
    return skus.filter(s => {
      const sLower = s.sku.trim().toLowerCase();
      return !declaredOfferIdsLower.has(sLower) && !extraArticlesLower.has(sLower);
    });
  };

  const handleAddExtraItem = () => {
    const available = getAvailableSkusForIndex(-1);
    if (available.length === 0) {
      toast.error('Нет доступных артикулов для добавления');
      return;
    }
    setExtraItems(prev => [...prev, { article: available[0].sku, accepted: 1 }]);
  };

  const buildCancelNotes = () => {
    const parsed = parseRecalcJSON(shipment.recalcJSON);
    if (!parsed) return [];
    const filtered = parsed.filter(p => p.accepted < p.declared);
    return filtered.map(p => ({
      article: p.article,
      note: `Перерасчёт недостачи отменён: заявка № ${shipment.orderNumber || shipment.orderId || '-'}, поставка ${shipment.postingId}, ${p.article}: приёмка изменена`
    }));
  };

  const handleValueChange = (offerId: string, valueStr: string) => {
    const val = parseInt(valueStr, 10);
    setAcceptedValues(prev => ({
      ...prev,
      [offerId]: isNaN(val) ? 0 : val
    }));
  };

  const handleSave = async () => {
    const acceptedList: { offerId: string; accepted: number }[] = [];
    for (const it of items) {
      const offerId = it.offerId || it.offer_id || '';
      const val = acceptedValues[offerId];
      if (val === undefined || val === null || isNaN(val) || val < 0 || !Number.isInteger(val)) {
        toast.error(`Некорректное значение приёмки для ${offerId}. Должно быть целым числом >= 0.`);
        return;
      }
      acceptedList.push({ offerId, accepted: val });
    }

    // Валидация и добавление extraItems
    for (const extra of extraItems) {
      const { article, accepted } = extra;
      if (!article || !article.trim()) {
        toast.error(`Не выбран артикул для позиции не из заявки.`);
        return;
      }
      if (accepted === undefined || accepted === null || isNaN(accepted) || accepted < 1 || !Number.isInteger(accepted)) {
        toast.error(`Количество для ${article} должно быть целым числом >= 1.`);
        return;
      }
      acceptedList.push({ offerId: article, accepted });
    }

    setIsSaving(true);
    try {
      const success = await saveShipmentAcceptance(shipment.postingId, JSON.stringify(acceptedList));
      if (success) {
        if (recalcPreview?.status === 'ok') {
          await saveShipmentShortageRecalc(
            shipment.postingId,
            JSON.stringify(recalcPreview.items),
            recalcPreview.historyNotes
          );
        } else if (shipment.recalcJSON) {
          await saveShipmentShortageRecalc(
            shipment.postingId,
            '',
            buildCancelNotes()
          );
        }
        onClose();
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = async () => {
    setIsSaving(true);
    try {
      const success = await saveShipmentAcceptance(shipment.postingId, '');
      if (success) {
        if (shipment.recalcJSON) {
          await saveShipmentShortageRecalc(
            shipment.postingId,
            '',
            buildCancelNotes()
          );
        }
        onClose();
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div id="acceptance-modal-overlay" className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 transition-all">
      <div id="acceptance-modal-card" className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-6 border-b border-slate-100 shrink-0">
          <h3 className="text-xl font-black text-slate-900 tracking-tight">
            Приёмка поставки № {shipment.postingId}
          </h3>
          <p className="text-slate-500 text-sm font-medium mt-1">
            Склад хранения: <span className="font-semibold text-indigo-600">{shipment.storageWarehouse || '—'}</span>
          </p>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          <table className="min-w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="px-4 py-2.5 font-bold text-slate-400 uppercase tracking-wider">Артикул</th>
                <th className="px-4 py-2.5 font-bold text-slate-400 uppercase tracking-wider text-center">Заявлено</th>
                <th className="px-4 py-2.5 font-bold text-slate-400 uppercase tracking-wider">Принято</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it: any, index: number) => {
                const offerId = it.offerId || it.offer_id || '';
                const qty = it.quantity || it.qty || 0;
                const acceptedVal = acceptedValues[offerId] ?? qty;
                const isOver = acceptedVal > qty;

                return (
                  <tr key={index} className="border-b border-slate-50">
                    <td className="px-4 py-3 font-semibold text-slate-700 align-middle">
                      {offerId || '-'}
                    </td>
                    <td className="px-4 py-3 font-bold text-slate-900 text-center align-middle">
                      {qty}
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <div className="space-y-1">
                        <input
                          id={`input-accepted-${offerId}`}
                          type="number"
                          min="0"
                          step="1"
                          value={acceptedVal}
                          onChange={(e) => handleValueChange(offerId, e.target.value)}
                          disabled={isSaving}
                          className="w-24 px-3 py-1.5 border border-slate-200 rounded-lg text-slate-900 font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 disabled:opacity-50"
                        />
                        {isOver && (
                          <div className="text-[10px] text-amber-600 font-medium">
                            Больше заявленного — возможен пересорт
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Позиции не из заявки (пересорт) */}
          <div className="mt-6 pt-4 border-t border-slate-100 space-y-3">
            <h4 className="text-sm font-black text-slate-900 tracking-tight">
              Позиции не из заявки (пересорт)
            </h4>
            
            {extraItems.length === 0 ? (
              <p className="text-slate-400 text-xs italic">Нет добавленных позиций.</p>
            ) : (
              <div className="overflow-x-auto border border-slate-100 rounded-xl">
                <table className="min-w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100">
                      <th className="px-4 py-2.5 font-bold text-slate-400 uppercase tracking-wider">Артикул</th>
                      <th className="px-4 py-2.5 font-bold text-slate-400 uppercase tracking-wider text-center w-24">Заявлено</th>
                      <th className="px-4 py-2.5 font-bold text-slate-400 uppercase tracking-wider">Принято</th>
                    </tr>
                  </thead>
                  <tbody>
                    {extraItems.map((item, idx) => {
                      const optSkus = getAvailableSkusForIndex(idx);
                      return (
                        <tr key={idx} className="border-b border-slate-50">
                          <td className="px-4 py-2 align-middle">
                            <select
                              id={`select-extra-article-${idx}`}
                              value={item.article}
                              onChange={(e) => {
                                const newArt = e.target.value;
                                setExtraItems(prev => prev.map((ex, i) => i === idx ? { ...ex, article: newArt } : ex));
                              }}
                              disabled={isSaving}
                              className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-slate-900 font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 disabled:opacity-50"
                            >
                              {item.article && (
                                <option value={item.article}>{item.article}</option>
                              )}
                              {optSkus
                                .filter(s => s.sku.trim().toLowerCase() !== item.article.trim().toLowerCase())
                                .map(s => (
                                  <option key={s.sku} value={s.sku}>{s.sku}</option>
                                ))}
                            </select>
                          </td>
                          <td className="px-4 py-2 font-bold text-slate-400 text-center align-middle w-24">
                            0
                          </td>
                          <td className="px-4 py-2 align-middle">
                            <div className="flex items-center gap-2">
                              <input
                                id={`input-extra-accepted-${item.article}`}
                                type="number"
                                min="1"
                                step="1"
                                value={item.accepted}
                                onChange={(e) => {
                                  const val = parseInt(e.target.value, 10);
                                  setExtraItems(prev => prev.map((ex, i) => i === idx ? { ...ex, accepted: isNaN(val) ? 1 : val } : ex));
                                }}
                                disabled={isSaving}
                                className="w-24 px-3 py-1.5 border border-slate-200 rounded-lg text-slate-900 font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 disabled:opacity-50"
                              />
                              <button
                                id={`btn-remove-extra-${item.article}`}
                                type="button"
                                onClick={() => {
                                  setExtraItems(prev => prev.filter((_, i) => i !== idx));
                                }}
                                disabled={isSaving}
                                className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
                                title="Удалить строку"
                              >
                                <span className="font-bold text-base leading-none">✕</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <button
              id="btn-add-extra-item"
              type="button"
              onClick={handleAddExtraItem}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-4 py-2 border border-dashed border-indigo-300 text-indigo-600 hover:bg-indigo-50 rounded-xl font-bold text-xs transition-all disabled:opacity-50 cursor-pointer"
            >
              + Добавить позицию не из заявки
            </button>
          </div>

          {recalcPreview !== null && (
            <div id="shortage-recalc-preview" className="mt-4 pt-4 border-t border-slate-100 space-y-3">
              {recalcPreview.status === 'ok' && (
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    Перераспределение стоимости недостачи
                  </h4>
                  <div className="overflow-x-auto border border-slate-100 rounded-xl">
                    <table className="min-w-full text-left border-collapse text-[11px]">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-100">
                          <th className="px-3 py-2 font-bold text-slate-400 uppercase">Артикул</th>
                          <th className="px-3 py-2 font-bold text-slate-400 uppercase text-center">Заявлено → Принято</th>
                          <th className="px-3 py-2 font-bold text-slate-400 uppercase text-right">Себест. базовая</th>
                          <th className="px-3 py-2 font-bold text-slate-400 uppercase text-right">Себест. новая</th>
                          <th className="px-3 py-2 font-bold text-slate-400 uppercase text-right">Доначислено</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recalcPreview.items.map((item, index) => {
                          const isRedistributed = item.redistributedCost > 0;
                          return (
                            <tr
                              key={index}
                              className={`border-b border-slate-50 last:border-0 hover:bg-slate-50/50 transition-colors ${
                                isRedistributed ? 'text-red-600 font-semibold bg-red-50/10' : 'text-slate-700'
                              }`}
                            >
                              <td className="px-3 py-1.5 font-bold">{item.article}</td>
                              <td className="px-3 py-1.5 text-center font-mono">{item.declared} → {item.accepted}</td>
                              <td className="px-3 py-1.5 text-right font-mono">{formatCurrency(item.baseUnitCost)} ₽</td>
                              <td className="px-3 py-1.5 text-right font-mono">{formatCurrency(item.adjustedUnitCost)} ₽</td>
                              <td className="px-3 py-1.5 text-right font-mono">{formatCurrency(item.redistributedCost)} ₽</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 pt-1">
                    <div className="text-xs font-bold text-slate-900">
                      Итого перераспределено:{' '}
                      <span className="text-red-600">
                        {formatCurrency(recalcPreview.items.reduce((sum, i) => sum + i.redistributedCost, 0))} ₽
                      </span>
                    </div>
                    <div className="text-slate-400 text-[10px] italic">
                      Остатки склада не изменятся. При сохранении будет записан перерасчёт и след в Историю.
                    </div>
                  </div>
                </div>
              )}

              {recalcPreview.status === 'peresort' && (
                <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-3 text-xs font-medium">
                  Приняты позиции не из заявки — похоже на пересорт. Перерасчёт недостачи не будет проведён; приёмка сохранится, подтверждение пересорта — отдельным шагом.
                </div>
              )}

              {recalcPreview.status === 'surplus' && (
                <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-3 text-xs font-medium">
                  Есть излишек — похоже на пересорт (пункты 15–16 плана). Перерасчёт недостачи не будет проведён; приёмка сохранится как есть.
                </div>
              )}

              {recalcPreview.status === 'error' && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-xs font-medium">
                  {recalcPreview.errorMsg} Приёмка сохранится, но перерасчёт проведён не будет.
                </div>
              )}

              {recalcPreview.status === 'none' && shipment.recalcJSON && (
                <div className="bg-slate-50 border border-slate-200 text-slate-600 rounded-xl p-3 text-xs font-medium">
                  Недостачи нет — ранее сохранённый перерасчёт будет отменён.
                </div>
              )}
            </div>
          )}
        </div>


        {/* Footer */}
        <div className="p-6 border-t border-slate-100 bg-slate-50/50 flex flex-wrap gap-2 justify-between items-center shrink-0">
          <button
            id="btn-acceptance-reset"
            onClick={handleReset}
            disabled={isSaving}
            className="px-4 py-2.5 border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 font-bold text-sm rounded-xl transition-all cursor-pointer"
          >
            Сбросить (= заявлено)
          </button>
          <div className="flex gap-2">
            <button
              id="btn-acceptance-cancel"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2.5 border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 font-bold text-sm rounded-xl transition-all cursor-pointer"
            >
              Отмена
            </button>
            <button
              id="btn-acceptance-save"
              onClick={handleSave}
              disabled={isSaving}
              className="px-5 py-2.5 bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 font-bold text-sm rounded-xl transition-all shadow-md shadow-indigo-100 cursor-pointer"
            >
              {isSaving ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

function parsePeresortMeta(peresortJSON?: string): { confirmed: boolean; committed: boolean; committedAt: string; committedBy: string } {
  if (!peresortJSON || peresortJSON.trim() === '') {
    return { confirmed: false, committed: false, committedAt: '', committedBy: '' };
  }
  try {
    const parsed = JSON.parse(peresortJSON);
    if (!parsed || !Array.isArray(parsed.pairs) || parsed.pairs.length === 0) {
      return { confirmed: false, committed: false, committedAt: '', committedBy: '' };
    }
    return {
      confirmed: true,
      committed: !!parsed.committedAt,
      committedAt: parsed.committedAt || '',
      committedBy: parsed.committedBy || ''
    };
  } catch {
    return { confirmed: false, committed: false, committedAt: '', committedBy: '' };
  }
}

interface PeresortModalProps {
  shipment: ExternalShipment;
  onClose: () => void;
}

interface PeresortPair {
  fromOfferId: string;
  fromArticle: string;
  toOfferId: string;
  toArticle: string;
  qty: number;
}

const PeresortModal: React.FC<PeresortModalProps> = ({ shipment, onClose }) => {
  const skus = useWarehouseStore((state) => state.skus);
  const currentUser = useWarehouseStore((state) => state.currentUser);
  const saveShipmentPeresort = useWarehouseStore((state) => state.saveShipmentPeresort);
  const commitShipmentPeresort = useWarehouseStore((state) => state.commitShipmentPeresort);
  const isProcessing = useWarehouseStore((state) => state.isProcessing);

  const [pairs, setPairs] = useState<PeresortPair[]>([]);
  const [selectedFromOfferId, setSelectedFromOfferId] = useState<string>('');
  const [selectedToOfferId, setSelectedToOfferId] = useState<string>('');
  const [inputQty, setInputQty] = useState<number>(1);

  const [showConfirmSave, setShowConfirmSave] = useState(false);
  const [showConfirmReset, setShowConfirmReset] = useState(false);
  const [showConfirmCommit, setShowConfirmCommit] = useState(false);

  const meta = useMemo(() => {
    return parsePeresortMeta(shipment.peresortJSON);
  }, [shipment.peresortJSON]);

  const isAdmin = (currentUser?.role || '').toLowerCase() === 'admin' || (currentUser?.role || '').toLowerCase() === 'администратор';

  // a) Вычисли detection
  const detection = useMemo(() => {
    return detectPeresort(shipment, skus);
  }, [shipment, skus]);

  // b) При открытии загрузи пары из shipment.peresortJSON
  useEffect(() => {
    if (shipment.peresortJSON) {
      try {
        const parsed = JSON.parse(shipment.peresortJSON);
        if (parsed && Array.isArray(parsed.pairs)) {
          setPairs(parsed.pairs);
          return;
        }
      } catch (e) {
        console.error('Error parsing peresortJSON in modal:', e);
      }
    }
    setPairs([]);
  }, [shipment]);

  // Расчёт остатка позиции
  const remainingMissing = useMemo(() => {
    return detection.missing.map(pos => {
      const allocated = pairs
        .filter(p => p.fromOfferId === pos.offerId)
        .reduce((sum, p) => sum + p.qty, 0);
      return {
        ...pos,
        remainingQty: pos.qty - allocated
      };
    });
  }, [detection.missing, pairs]);

  const remainingExtras = useMemo(() => {
    return detection.extras.map(pos => {
      const allocated = pairs
        .filter(p => p.toOfferId === pos.offerId)
        .reduce((sum, p) => sum + p.qty, 0);
      return {
        ...pos,
        remainingQty: pos.qty - allocated
      };
    });
  }, [detection.extras, pairs]);

  // Списки с ненулевым остатком для конструктора
  const availableFrom = useMemo(() => {
    return remainingMissing.filter(item => item.remainingQty > 0);
  }, [remainingMissing]);

  const availableTo = useMemo(() => {
    return remainingExtras.filter(item => item.remainingQty > 0);
  }, [remainingExtras]);

  // Синхронизация селектов
  useEffect(() => {
    if (availableFrom.length > 0) {
      const exists = availableFrom.some(x => x.offerId === selectedFromOfferId);
      if (!exists) {
        setSelectedFromOfferId(availableFrom[0].offerId);
      }
    } else {
      setSelectedFromOfferId('');
    }
  }, [availableFrom, selectedFromOfferId]);

  useEffect(() => {
    if (availableTo.length > 0) {
      const exists = availableTo.some(x => x.offerId === selectedToOfferId);
      if (!exists) {
        setSelectedToOfferId(availableTo[0].offerId);
      }
    } else {
      setSelectedToOfferId('');
    }
  }, [availableTo, selectedToOfferId]);

  const maxQtyForSelected = useMemo(() => {
    const fromItem = remainingMissing.find(x => x.offerId === selectedFromOfferId);
    const toItem = remainingExtras.find(x => x.offerId === selectedToOfferId);
    if (!fromItem || !toItem) return 0;
    return Math.min(fromItem.remainingQty, toItem.remainingQty);
  }, [remainingMissing, remainingExtras, selectedFromOfferId, selectedToOfferId]);

  useEffect(() => {
    setInputQty(maxQtyForSelected);
  }, [maxQtyForSelected]);

  const handleAddPair = () => {
    const fromItem = remainingMissing.find(x => x.offerId === selectedFromOfferId);
    const toItem = remainingExtras.find(x => x.offerId === selectedToOfferId);
    if (!fromItem || !toItem) {
      toast.error('Выберите товары для сопоставления');
      return;
    }
    const maxAllowed = Math.min(fromItem.remainingQty, toItem.remainingQty);
    if (inputQty < 1 || inputQty > maxAllowed || !Number.isInteger(inputQty)) {
      toast.error(`Количество должно быть целым числом от 1 до ${maxAllowed}`);
      return;
    }

    const newPair: PeresortPair = {
      fromOfferId: fromItem.offerId,
      fromArticle: fromItem.article,
      toOfferId: toItem.offerId,
      toArticle: toItem.article,
      qty: inputQty
    };

    setPairs(prev => [...prev, newPair]);
  };

  const handleRemovePair = (index: number) => {
    setPairs(prev => prev.filter((_, i) => i !== index));
  };

  const initialInfo = useMemo(() => {
    if (!shipment.peresortJSON) return null;
    try {
      const parsed = JSON.parse(shipment.peresortJSON);
      if (parsed) {
        return {
          confirmedAt: parsed.confirmedAt || '',
          confirmedBy: parsed.confirmedBy || '',
          pairs: parsed.pairs || []
        };
      }
    } catch (e) {
      console.error('Error parsing initial peresortJSON:', e);
    }
    return null;
  }, [shipment.peresortJSON]);

  const formatConfirmedDate = (dateStr: string) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleString('ru-RU');
    } catch {
      return dateStr;
    }
  };

  const unassociatedMissing = useMemo(() => {
    return remainingMissing.filter(item => item.remainingQty > 0);
  }, [remainingMissing]);

  const unassociatedExtras = useMemo(() => {
    return remainingExtras.filter(item => item.remainingQty > 0);
  }, [remainingExtras]);

  const handleConfirmSave = async () => {
    const peresortJSON = JSON.stringify({
      pairs,
      confirmedAt: new Date().toISOString(),
      confirmedBy: currentUser?.username || ''
    });
    const success = await saveShipmentPeresort(shipment.postingId, peresortJSON);
    if (success) {
      onClose();
    }
  };

  const handleConfirmReset = async () => {
    const success = await saveShipmentPeresort(shipment.postingId, '');
    if (success) {
      onClose();
    }
  };

  return (
    <div id="peresort-modal-overlay" className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 transition-all">
      <div id="peresort-modal-card" className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-6 border-b border-slate-100 shrink-0 flex justify-between items-center">
          <div>
            <h3 className="text-xl font-black text-slate-900 tracking-tight">
              Пересорт поставки № {shipment.postingId}
            </h3>
            <p className="text-slate-500 text-sm font-medium mt-1">
              Склад хранения: <span className="font-semibold text-indigo-600">{shipment.storageWarehouse || '—'}</span>
            </p>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-full transition-all text-slate-400 cursor-pointer"
            title="Закрыть"
          >
            <span className="font-bold text-lg leading-none">✕</span>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {/* h) Зелёная плашка подтверждения */}
          {meta.committed ? (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl p-4 flex items-center gap-4 text-xs">
              <div className="font-semibold">
                Пересорт проведён {formatConfirmedDate(meta.committedAt)} · {meta.committedBy}
              </div>
            </div>
          ) : initialInfo ? (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl p-4 flex justify-between items-center gap-4 text-xs">
              <div className="font-semibold">
                Пересорт подтверждён {formatConfirmedDate(initialInfo.confirmedAt)} ({initialInfo.confirmedBy})
              </div>
              <button
                id="btn-reset-peresort"
                type="button"
                onClick={() => setShowConfirmReset(true)}
                disabled={isProcessing}
                className="px-3 py-1.5 bg-white border border-emerald-300 hover:bg-emerald-100 text-emerald-800 font-bold rounded-lg transition-all cursor-pointer disabled:opacity-50"
              >
                Сбросить пересорт
              </button>
            </div>
          ) : null}

          {/* c) Две колонки-списка */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Не хватает */}
            <div className="border border-slate-150 rounded-2xl p-4 bg-slate-50/50">
              <h4 className="text-xs font-bold text-red-600 uppercase tracking-wider mb-2">
                Не хватает (заявлено, но не принято)
              </h4>
              {detection.missing.length === 0 ? (
                <p className="text-slate-400 text-xs italic">Нет расхождений</p>
              ) : (
                <ul className="space-y-1.5">
                  {remainingMissing.map((m) => (
                    <li key={m.offerId} className="flex justify-between items-center text-xs text-slate-700">
                      <span className="font-semibold truncate">{m.article}</span>
                      <span className="font-bold text-slate-900 bg-red-50 text-red-700 px-2 py-0.5 rounded-md shrink-0">
                        Осталось {m.remainingQty} из {m.qty} шт
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Лишнее */}
            <div className="border border-slate-150 rounded-2xl p-4 bg-slate-50/50">
              <h4 className="text-xs font-bold text-amber-600 uppercase tracking-wider mb-2">
                Лишнее (принято не из заявки)
              </h4>
              {detection.extras.length === 0 ? (
                <p className="text-slate-400 text-xs italic">Нет расхождений</p>
              ) : (
                <ul className="space-y-1.5">
                  {remainingExtras.map((e) => (
                    <li key={e.offerId} className="flex justify-between items-center text-xs text-slate-700">
                      <span className="font-semibold truncate">{e.article}</span>
                      <span className="font-bold text-slate-900 bg-amber-50 text-amber-700 px-2 py-0.5 rounded-md shrink-0">
                        Осталось {e.remainingQty} из {e.qty} шт
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* d) Конструктор пар */}
          {!meta.committed && (
            availableFrom.length > 0 && availableTo.length > 0 ? (
              <div className="border border-indigo-100 rounded-2xl p-4 bg-indigo-50/30 space-y-3">
                <h4 className="text-xs font-bold text-indigo-700 uppercase tracking-wider">
                  Сопоставление пересорта
                </h4>
                <div className="flex flex-col sm:flex-row gap-2 items-end">
                  <div className="flex-1 space-y-1 w-full">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Не хватило:</label>
                    <select
                      id="select-peresort-from"
                      value={selectedFromOfferId}
                      onChange={(e) => setSelectedFromOfferId(e.target.value)}
                      className="w-full px-2 py-2 border border-slate-200 rounded-lg text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white"
                    >
                      {availableFrom.map(m => (
                        <option key={m.offerId} value={m.offerId}>
                          {m.article} — осталось {m.remainingQty} шт
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex-1 space-y-1 w-full">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Приехало вместо:</label>
                    <select
                      id="select-peresort-to"
                      value={selectedToOfferId}
                      onChange={(e) => setSelectedToOfferId(e.target.value)}
                      className="w-full px-2 py-2 border border-slate-200 rounded-lg text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white"
                    >
                      {availableTo.map(e => (
                        <option key={e.offerId} value={e.offerId}>
                          {e.article} — осталось {e.remainingQty} шт
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="w-24 space-y-1 shrink-0">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Кол-во:</label>
                    <input
                      type="number"
                      min="1"
                      max={maxQtyForSelected}
                      value={inputQty}
                      onChange={(e) => setInputQty(parseInt(e.target.value, 10) || 0)}
                      disabled={maxQtyForSelected === 0}
                      className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-slate-900 font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white text-center"
                    />
                  </div>

                  <button
                    id="btn-add-peresort-pair"
                    type="button"
                    onClick={handleAddPair}
                    className="px-4 py-2 bg-indigo-600 text-white hover:bg-indigo-700 font-bold text-xs rounded-lg transition-all h-9 shrink-0 cursor-pointer"
                  >
                    + Добавить пару
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-3 bg-slate-50 border border-slate-200 text-slate-500 text-xs italic rounded-2xl text-center">
                Нет доступных позиций для сопоставления пересорта (необходимы одновременно и недостающие, и лишние товары).
              </div>
            )
          )}

          {/* e) Список добавленных пар */}
          {pairs.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Сопоставленные пары:
              </h4>
              <div className="space-y-1.5">
                {pairs.map((p, idx) => (
                  <div key={idx} className="flex justify-between items-center bg-indigo-50/50 border border-indigo-100 p-2 px-3 rounded-xl text-xs">
                    <span className="font-semibold text-slate-700">
                      Вместо <span className="font-black text-red-600">{p.fromArticle}</span> уехал <span className="font-black text-amber-600">{p.toArticle}</span> — <span className="font-black text-slate-900">{p.qty} шт</span>
                    </span>
                    {!meta.committed && (
                      <button
                        id={`btn-remove-peresort-pair-${idx}`}
                        type="button"
                        onClick={() => handleRemovePair(idx)}
                        className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                        title="Удалить сопоставление"
                      >
                        <span className="font-bold text-xs">✕</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* f) Информационный блок */}
          <div className="space-y-1.5 p-4 bg-slate-50 rounded-2xl border border-slate-100 text-xs text-slate-500 font-medium">
            {unassociatedMissing.length > 0 && (
              <div>
                Останется обычной недостачей:{' '}
                <span className="font-semibold text-slate-600">
                  {unassociatedMissing.map(m => `${m.article} — ${m.remainingQty} шт`).join(', ')}
                </span>
              </div>
            )}
            {unassociatedExtras.length > 0 && (
              <div>
                Останется излишком:{' '}
                <span className="font-semibold text-slate-600">
                  {unassociatedExtras.map(e => `${e.article} — ${e.remainingQty} шт`).join(', ')}
                </span>
              </div>
            )}
            <div>
              Обработка остатков и движение складских остатков — при проведении пересорта (следующий пункт плана)
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-slate-100 bg-slate-50/50 flex gap-2 justify-end shrink-0">
          {meta.confirmed && !meta.committed && isAdmin && (
            <button
              id="btn-commit-peresort"
              type="button"
              onClick={() => setShowConfirmCommit(true)}
              disabled={isProcessing}
              className="px-5 py-2.5 bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 font-bold text-sm rounded-xl transition-all shadow-md shadow-indigo-100 cursor-pointer"
            >
              Провести пересорт
            </button>
          )}
          <button
            onClick={onClose}
            className="px-4 py-2.5 border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 font-bold text-sm rounded-xl transition-all cursor-pointer"
          >
            {meta.committed ? 'Закрыть' : 'Отмена'}
          </button>
          {!meta.committed && (
            <button
              id="btn-confirm-peresort"
              onClick={() => setShowConfirmSave(true)}
              disabled={pairs.length === 0 || isProcessing}
              className="px-5 py-2.5 bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 font-bold text-sm rounded-xl transition-all shadow-md shadow-indigo-100 cursor-pointer"
            >
              Подтвердить пересорт
            </button>
          )}
        </div>
      </div>

      {/* Confirm Save Dialog */}
      <ConfirmDialog
        show={showConfirmSave}
        title="Подтвердить пересорт?"
        onConfirm={handleConfirmSave}
        onCancel={() => setShowConfirmSave(false)}
        confirmLabel="Подтвердить"
        cancelLabel="Отмена"
        message={
          <div className="space-y-3">
            <div className="text-sm font-semibold text-slate-700">Будут подтверждены следующие пары пересорта:</div>
            <ul className="list-disc pl-5 text-sm text-slate-600 space-y-1">
              {pairs.map((p, i) => (
                <li key={i}>Вместо {p.fromArticle} уехал {p.toArticle} — {p.qty} шт</li>
              ))}
            </ul>
            <p className="text-sm font-bold text-slate-800 mt-2">
              Остатки склада сейчас НЕ изменятся. Движение остатков произойдёт при проведении пересорта.
            </p>
          </div>
        }
      />

      {/* Confirm Reset Dialog */}
      <ConfirmDialog
        show={showConfirmReset}
        title="Сбросить подтверждённый пересорт?"
        onConfirm={handleConfirmReset}
        onCancel={() => setShowConfirmReset(false)}
        confirmLabel="Сбросить"
        cancelLabel="Отмена"
        message="Подтверждённый пересорт будет полностью удален. Остатки склада сейчас не изменятся. Продолжить?"
      />

      {/* Confirm Commit Dialog */}
      <ConfirmDialog
        show={showConfirmCommit}
        title="Провести пересорт?"
        onConfirm={async () => {
          const success = await commitShipmentPeresort(shipment.postingId);
          if (success) {
            onClose();
          }
        }}
        onCancel={() => setShowConfirmCommit(false)}
        confirmLabel="Провести"
        cancelLabel="Отмена"
        message={
          <div className="space-y-3 text-sm text-slate-600">
            <p>
              Операция изменит остатки склада в обе стороны: ошибочно уехавший товар будет списан, не уехавший — возвращён на склад по своей себестоимости.
            </p>
            <p className="font-semibold text-slate-700">
              Пары: {pairs.map(p => `вместо ${p.fromArticle} ×${p.qty} уехал ${p.toArticle} ×${p.qty}`).join(', ')}
            </p>
          </div>
        }
      />
    </div>
  );
};


export const OzonSuppliesTab: React.FC = React.memo(() => {
  const fetchExternalShipments = useWarehouseStore((state) => state.fetchExternalShipments);
  const externalShipments = useWarehouseStore((state) => state.externalShipments);
  const checkOzonShipments = useWarehouseStore((state) => state.checkOzonShipments);
  const isProcessing = useWarehouseStore((state) => state.isProcessing);
  const transactions = useWarehouseStore((state) => state.transactions);

  const skus = useWarehouseStore((state) => state.skus);
  const stock = useWarehouseStore((state) => state.stock);
  const markExternalShipment = useWarehouseStore((state) => state.markExternalShipment);
  const saveShipmentAcceptance = useWarehouseStore((state) => state.saveShipmentAcceptance);
  const setPendingOzonPostingIds = useWarehouseStore((state) => state.setPendingOzonPostingIds);
  const setOpType = useUIStore((state) => state.setOpType);
  const setUploadDestination = useUIStore((state) => state.setUploadDestination);
  const askConfirmation = useUIStore((state) => state.askConfirmation);

  const [isLoading, setIsLoading] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [expandedPostings, setExpandedPostings] = useState<Set<string>>(new Set());
  const [cabinetFilter, setCabinetFilter] = useState<string>('all');
  const [showProcessed, setShowProcessed] = useState(false);
  const [selectedAcceptanceShipment, setSelectedAcceptanceShipment] = useState<ExternalShipment | null>(null);
  const [selectedPeresortShipment, setSelectedPeresortShipment] = useState<ExternalShipment | null>(null);

  useEffect(() => {
    setIsLoading(true);
    fetchExternalShipments().finally(() => {
      setIsLoading(false);
    });
  }, [fetchExternalShipments]);

  const toggleGroup = (groupId: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const togglePosting = (postingId: string) => {
    setExpandedPostings(prev => {
      const next = new Set(prev);
      if (next.has(postingId)) {
        next.delete(postingId);
      } else {
        next.add(postingId);
      }
      return next;
    });
  };

  const handleProcessOzonGroup = useProcessOzonGroup();

  const handleIgnoreOzonGroup = useCallback((group: OzonGroup) => {
    const newPostings: ExternalShipment[] = (group.items as ExternalShipment[]).filter(p => p.status === 'new');
    if (newPostings.length === 0) {
      toast.error('В заявке нет новых поставок');
      return;
    }
    askConfirmation(
      "Игнорировать заявку Ozon?",
      `Все новые поставки заявки № ${group.label} (${newPostings.length} шт.) будут помечены как проигнорированные.`,
      async () => {
        for (const p of newPostings) {
          await markExternalShipment(p.postingId, 'ignored');
        }
        toast.success(`Заявка № ${group.label} проигнорирована`);
      }
    );
  }, [askConfirmation, markExternalShipment]);

  const handleLinkAsDuplicate = useCallback((group: OzonGroup) => {
    const newPostings: ExternalShipment[] = (group.items as ExternalShipment[]).filter(p => p.status === 'new');
    if (newPostings.length === 0) {
      toast.error('В заявке нет новых поставок');
      return;
    }
    const bestCandidate = group.matchResult?.candidates?.[0];
    if (!bestCandidate) {
      toast.error('Совпадение не найдено');
      return;
    }

    askConfirmation(
      "Привязать заявку к ручной отгрузке?",
      `Заявка № ${group.label} будет помечена обработанной и привязана к ручной отгрузке от ${bestCandidate.date}. Новый расход НЕ создаётся. Если позже удалить эту отгрузку из Истории, заявка автоматически вернётся в новые.`,
      async () => {
        const linkInfo = JSON.stringify(bestCandidate.txIds);
        for (const p of newPostings) {
          await markExternalShipment(p.postingId, 'processed', linkInfo);
        }
        toast.success(`Заявка № ${group.label} привязана к ручной отгрузке`);
      }
    );
  }, [askConfirmation, markExternalShipment]);

  const handleReturnGroupToNew = useCallback((group: OzonGroup) => {
    const donePostings: ExternalShipment[] = (group.items as ExternalShipment[]).filter(
      p => p.status === 'processed' || p.status === 'ignored'
    );
    if (donePostings.length === 0) return;
    askConfirmation(
      "Вернуть заявку в новые?",
      `Все поставки заявки № ${group.label} (${donePostings.length} шт.) снова станут новыми — их можно будет оформить или игнорировать заново. Убедитесь, что связанная отгрузка удалена из Истории, иначе при повторном оформлении получится дубль расхода.`,
      async () => {
        for (const p of donePostings) {
          await markExternalShipment(p.postingId, 'new');
        }
        toast.success(`Заявка № ${group.label} возвращена в новые`);
      }
    );
  }, [askConfirmation, markExternalShipment]);

  const groupedShipments = useMemo(() => {
    return buildOzonGroups(externalShipments, skus, transactions);
  }, [externalShipments, transactions, skus]);

  const sortedGroups = useMemo(() => {
    const getLatestStatusDate = (group: ExternalShipment[]) => {
      let latestTime = 0;
      let hasValidDate = false;
      
      group.forEach((s) => {
        if (s.ozonStatusDate) {
          const time = new Date(s.ozonStatusDate).getTime();
          if (!isNaN(time)) {
            if (time > latestTime) {
              latestTime = time;
              hasValidDate = true;
            }
          }
        }
      });
      
      return { time: latestTime, hasValidDate };
    };

    return [...groupedShipments].sort((gA, gB) => {
      const a = getLatestStatusDate(gA.items);
      const b = getLatestStatusDate(gB.items);
      
      if (a.hasValidDate && b.hasValidDate) {
        return b.time - a.time;
      }
      if (a.hasValidDate) return -1;
      if (b.hasValidDate) return 1;
      return 0;
    });
  }, [groupedShipments]);

  const availableCabinets = useMemo(() => {
    const set = new Set<string>();
    groupedShipments.forEach(g => { if (g.cabinet) set.add(g.cabinet); });
    return Array.from(set).sort();
  }, [groupedShipments]);

  const filteredGroups = useMemo(() => {
    if (cabinetFilter === 'all') return sortedGroups;
    return sortedGroups.filter(g => g.cabinet === cabinetFilter);
  }, [sortedGroups, cabinetFilter]);

  // Обработанные = заявки без единой новой поставки (оформлены или проигнорированы)
  const processedGroupsCount = useMemo(
    () => filteredGroups.filter(g => !g.items.some((i) => i.status === 'new')).length,
    [filteredGroups]
  );

  // По умолчанию видны только актуальные заявки (есть хотя бы одна новая поставка)
  const displayedGroups = useMemo(() => {
    if (showProcessed) return filteredGroups;
    return filteredGroups.filter(g => g.items.some((i) => i.status === 'new'));
  }, [filteredGroups, showProcessed]);

  const getStatusSummary = (group: ExternalShipment[]) => {
    const statusCounts: Record<string, number> = {};
    group.forEach(s => {
      const statusLabel = getStatusLabel(s.ozonStatus);
      statusCounts[statusLabel] = (statusCounts[statusLabel] || 0) + 1;
    });
    
    return Object.entries(statusCounts)
      .map(([status, count]) => `${count} × ${status}`)
      .join(', ');
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 tab-enter">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="space-y-2">
          <h2 className="text-3xl font-black text-slate-900 tracking-tight">Поставки Озон</h2>
          <p className="text-slate-500 font-medium">Список заявок на поставку Ozon</p>
        </div>
        <button
          onClick={() => checkOzonShipments()}
          disabled={isProcessing}
          className="flex items-center gap-2 px-5 py-3 bg-indigo-600 text-white rounded-2xl hover:bg-indigo-700 disabled:opacity-50 transition-all font-bold shadow-lg shadow-indigo-200"
        >
          {isProcessing ? (
            <Loader2 size={18} className="animate-spin" />
          ) : (
            <RefreshCw size={18} />
          )}
          Синхронизировать с Ozon
        </button>
      </div>

      {/* Фильтр по магазинам (виден при двух и более кабинетах) */}
      {!isLoading && availableCabinets.length >= 2 && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setCabinetFilter('all')}
            className={`px-4 py-2 rounded-xl text-sm font-bold transition-all border ${
              cabinetFilter === 'all'
                ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-200'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            Все магазины
          </button>
          {availableCabinets.map((name) => (
            <button
              key={name}
              onClick={() => setCabinetFilter(name)}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-all border ${
                cabinetFilter === name
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-200'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {/* Показ обработанных заявок */}
      {!isLoading && processedGroupsCount > 0 && (
        <label className="flex items-center gap-2 text-sm font-bold text-slate-500 cursor-pointer select-none w-fit">
          <input
            type="checkbox"
            checked={showProcessed}
            onChange={(e) => setShowProcessed(e.target.checked)}
            className="w-4 h-4 rounded accent-indigo-600"
          />
          Показать обработанные заявки ({processedGroupsCount})
        </label>
      )}

      {/* Loading state */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-500">
          <Loader2 size={40} className="animate-spin text-indigo-600 mb-4" />
          <p className="font-semibold">Загрузка заявок Ozon...</p>
        </div>
      ) : displayedGroups.length === 0 ? (
        /* Empty State */
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-12 text-center text-slate-500">
          <Package size={48} className="mx-auto mb-4 opacity-20 text-indigo-600" />
          <p className="text-lg font-medium">Нет заявок на поставку Ozon</p>
          <p className="text-sm mt-1 max-w-md mx-auto">
            Нажмите кнопку «Синхронизировать с Ozon», чтобы запросить актуальные поставки из Ozon API.
          </p>
        </div>
      ) : (
        /* Groups List */
        <div className="space-y-4">
          {displayedGroups.map((group) => {
            const isGroupExpanded = expandedGroups.has(group.id);
            return (
              <div key={group.id} className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden transition-all duration-300">
                <div 
                  onClick={() => toggleGroup(group.id)}
                  className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 cursor-pointer hover:bg-slate-50/50 transition-colors"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-bold text-slate-900 text-lg">Заявка № {group.label}</h3>
                      {group.cabinet && (
                        <span className="text-xs font-semibold px-2.5 py-1 bg-sky-50 text-sky-700 rounded-full">
                          {group.cabinet}
                        </span>
                      )}
                      <span className="text-xs font-semibold px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-full">
                        Поставок в группе: {group.postingCount}
                      </span>
                      {group.items.some(i => i.status === 'new') && (
                        group.needsExpense ? (
                          <span className="text-xs font-semibold px-2.5 py-1 bg-red-50 text-red-700 rounded-full border border-red-100">
                            Отгружена — оформите списание
                          </span>
                        ) : (
                          <span className="text-xs font-semibold px-2.5 py-1 bg-slate-100 text-slate-600 rounded-full">
                            Ожидает отгрузки на Ozon
                          </span>
                        )
                      )}
                      {group.matchResult?.verdict === 'duplicate' && (
                        <span className="text-xs font-semibold px-2.5 py-1 bg-red-50 text-red-700 rounded-full border border-red-100">
                          Возможный дубль ручной отгрузки
                        </span>
                      )}
                      {group.matchResult?.verdict === 'suspect' && (
                        <span className="text-xs font-semibold px-2.5 py-1 bg-amber-50 text-amber-700 rounded-full border border-amber-100">
                          Похожа на ручную — проверьте
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-slate-500 font-medium flex items-center gap-1.5">
                      <Calendar size={14} className="text-slate-400" />
                      Дата отгрузки: {group.shipmentDate}
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between sm:justify-end gap-6 border-t sm:border-t-0 pt-3 sm:pt-0 border-slate-100">
                    <div className="text-left sm:text-right">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Сводка статусов</div>
                      <div className="text-sm font-semibold text-slate-700 mt-0.5">
                        {getStatusSummary(group.items)}
                      </div>
                    </div>
                    {group.items.some((i) => i.status === 'new') && (
                      <div className="flex gap-2">
                        {group.matchResult?.verdict !== 'none' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleLinkAsDuplicate(group); }}
                            className="bg-white border border-red-400 text-red-600 px-4 py-2 rounded-xl font-bold text-sm hover:bg-red-50 transition-all cursor-pointer whitespace-nowrap"
                          >
                            Привязать как дубль
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleProcessOzonGroup(group); }}
                          disabled={!group.needsExpense}
                          title={!group.needsExpense ? 'Оформление доступно после приёмки товара на точке отгрузки Ozon' : undefined}
                          className="bg-sky-500 text-white px-4 py-2 rounded-xl font-bold text-sm hover:bg-sky-600 transition-all shadow-md shadow-sky-100 cursor-pointer disabled:bg-slate-300 disabled:shadow-none disabled:cursor-not-allowed"
                        >
                          Оформить
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleIgnoreOzonGroup(group); }}
                          className="bg-slate-200 text-slate-700 px-4 py-2 rounded-xl font-bold text-sm hover:bg-slate-300 transition-all cursor-pointer"
                        >
                          Игнорировать
                        </button>
                      </div>
                    )}
                    {!group.items.some((i) => i.status === 'new') &&
                      group.items.some((i) => i.status === 'processed' || i.status === 'ignored') && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleReturnGroupToNew(group); }}
                        className="bg-white border border-amber-400 text-amber-600 px-4 py-2 rounded-xl font-bold text-sm hover:bg-amber-50 transition-all cursor-pointer"
                      >
                        Вернуть в новые
                      </button>
                    )}
                    <div className="text-slate-400 bg-slate-50 hover:bg-slate-100 p-2 rounded-xl transition-colors">
                      {isGroupExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                    </div>
                  </div>
                </div>

                <AnimatePresence initial={false}>
                  {isGroupExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="border-t border-slate-100 bg-slate-50/30 overflow-hidden"
                    >
                      <div className="p-5 space-y-4">
                        {group.matchResult && group.matchResult.verdict !== 'none' && group.matchResult.candidates?.[0] && (() => {
                          const bestCandidate = group.matchResult.candidates[0];
                          const isDuplicate = group.matchResult.verdict === 'duplicate';
                          const cardBorderBg = isDuplicate 
                            ? 'border-red-200 bg-red-50/30 text-red-800' 
                            : 'border-amber-200 bg-amber-50/30 text-amber-800';
                          
                          const daysText = bestCandidate.dateDiffDays !== null 
                            ? `${bestCandidate.dateDiffDays} ${
                                bestCandidate.dateDiffDays === 1 ? 'день' :
                                [2,3,4].includes(bestCandidate.dateDiffDays) ? 'дня' : 'дней'
                              }`
                            : 'не определена';

                          const itemsListText = bestCandidate.items
                            .map(it => `${it.article} ×${it.quantity}`)
                            .join(', ');

                          return (
                            <div className={`p-4 border rounded-2xl space-y-1.5 ${cardBorderBg}`}>
                              <div className="font-bold text-sm">
                                {isDuplicate 
                                  ? `Возможный дубль: ручная отгрузка от ${bestCandidate.date}` 
                                  : `Похожая ручная отгрузка от ${bestCandidate.date}`}
                              </div>
                              <div className="text-xs text-slate-500 font-medium">
                                Поставка: {bestCandidate.deliveryDate || '—'} · Объект: {bestCandidate.destination} · Разница дат: {daysText}
                              </div>
                              <div className="text-xs text-slate-600 font-medium">
                                <span className="text-slate-400">Состав ручной отгрузки (совпадает с заявкой):</span> {itemsListText}
                              </div>
                            </div>
                          );
                        })()}

                        <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Поставки в рамках заявки</div>
                        
                        {group.items.map((s) => {
                          const statusDetails = getStatusDetails(s.ozonStatus);
                          const isPostingExpanded = expandedPostings.has(s.postingId);
                          return (
                            <div key={s.postingId} className="border border-slate-200 rounded-2xl bg-white overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                              <div
                                onClick={(e) => {
                                  e.stopPropagation();
                                  togglePosting(s.postingId);
                                }}
                                className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 cursor-pointer hover:bg-slate-50/40 transition-colors"
                              >
                                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 flex-1">
                                  <div>
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">№ Поставки</div>
                                    <div className="text-sm font-bold text-slate-800 mt-0.5">{s.postingId}</div>
                                  </div>
                                  <div>
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Склад хранения</div>
                                    <div className="text-sm font-bold text-indigo-700 mt-0.5 truncate" title={s.storageWarehouse}>
                                      {s.storageWarehouse || '—'}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Пункт отгрузки</div>
                                    <div className="text-sm font-semibold text-slate-600 mt-0.5 truncate" title={s.dropOffWarehouse}>
                                      {s.dropOffWarehouse || '—'}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Таймслот</div>
                                    <div className="text-sm font-semibold text-slate-600 mt-0.5 truncate" title={s.timeslot}>
                                      {s.timeslot || '—'}
                                    </div>
                                  </div>
                                </div>
                                
                                <div className="flex items-center gap-4 shrink-0 justify-between lg:justify-end border-t lg:border-t-0 pt-3 lg:pt-0 border-slate-50">
                                  <div className="text-left lg:text-right">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Статус Ozon</div>
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${statusDetails.badgeClass}`}>
                                        {statusDetails.label}
                                      </span>
                                      {isAcceptanceStage(s.ozonStatus) && (() => {
                                        const isAcceptedEmpty = !s.acceptedJSON;
                                        if (isAcceptedEmpty) {
                                          return (
                                            <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-100 text-slate-600">
                                              Приёмка: = заявлено
                                            </span>
                                          );
                                        } else {
                                          let items: any[] = [];
                                          try {
                                            items = JSON.parse(s.itemsJSON || '[]');
                                          } catch (e) {}
                                          
                                          const accMap = parseAcceptance(s.acceptedJSON);
                                          const peresort = detectPeresort(s, skus);
                                          let shortage = 0;
                                          let surplus = 0;

                                          items.forEach((it: any) => {
                                            const offerId = it.offerId || it.offer_id || '';
                                            const quantity = it.quantity || it.qty || 0;
                                            const acceptedVal = accMap.has(offerId) ? accMap.get(offerId)! : quantity;
                                            if (acceptedVal < quantity) {
                                              shortage += (quantity - acceptedVal);
                                            } else if (acceptedVal > quantity) {
                                              surplus += (acceptedVal - quantity);
                                            }
                                          });

                                          const meta = parsePeresortMeta(s.peresortJSON);
                                          const badges: React.ReactNode[] = [];
                                          if (shortage === 0 && surplus === 0 && peresort.extras.length === 0 && (!meta.confirmed || meta.committed)) {
                                            badges.push(
                                              <span key="ok" className="px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-100 text-emerald-700">
                                                Принято полностью
                                              </span>
                                            );
                                          }
                                          if (shortage > 0) {
                                            badges.push(
                                              <span key="shortage" className="px-2.5 py-1 rounded-lg text-xs font-bold bg-red-100 text-red-700">
                                                Недостача {shortage} шт
                                              </span>
                                            );
                                          }
                                          if (surplus > 0) {
                                            badges.push(
                                              <span key="surplus" className="px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-100 text-amber-700">
                                                Излишек {surplus} шт
                                              </span>
                                            );
                                          }
                                          if (meta.committed) {
                                            badges.push(
                                              <span key="peresort-committed" className="px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-100 text-emerald-700">
                                                Пересорт проведён
                                              </span>
                                            );
                                          } else if (meta.confirmed) {
                                            badges.push(
                                              <span key="peresort-confirmed" className="px-2.5 py-1 rounded-lg text-xs font-bold bg-indigo-100 text-indigo-700">
                                                Пересорт подтверждён — ожидает проведения
                                              </span>
                                            );
                                          } else if (peresort.extras.length > 0) {
                                            const extrasQty = peresort.extras.reduce((sum, item) => sum + item.qty, 0);
                                            badges.push(
                                              <span key="peresort" className="px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-100 text-amber-700">
                                                Возможен пересорт (не из заявки: {extrasQty} шт)
                                              </span>
                                            );
                                          }
                                          return <>{badges}</>;
                                        }
                                      })()}
                                      {s.recalcJSON && (
                                        <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-indigo-100 text-indigo-700">
                                          Перерасчёт ✓
                                        </span>
                                      )}
                                      {s.ozonStatusDate && (
                                        <span className="text-xs text-slate-400 font-bold whitespace-nowrap">
                                          {formatStatusDate(s.ozonStatusDate)}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="text-slate-400 bg-slate-50 p-1.5 rounded-lg">
                                    {isPostingExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                  </div>
                                </div>
                              </div>
                              
                              <AnimatePresence initial={false}>
                                {isPostingExpanded && (
                                  <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={{ duration: 0.15 }}
                                    className="border-t border-slate-100 bg-slate-50/50 overflow-hidden"
                                  >
                                    <div className="p-4 bg-slate-50/30">
                                      <div className="flex items-center justify-between mb-2">
                                        <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Состав поставки</div>
                                        {isAcceptanceStage(s.ozonStatus) && s.itemsJSON && (() => {
                                          const label = s.acceptedJSON ? 'Изменить приёмку' : 'Ввести приёмку';
                                          const peresort = detectPeresort(s, skus);
                                          const showPeresortBtn = peresort.isCandidate || (s.peresortJSON && s.peresortJSON.trim() !== '');
                                          return (
                                            <div className="flex gap-2">
                                              <button
                                                id={`btn-acceptance-${s.postingId}`}
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setSelectedAcceptanceShipment(s);
                                                }}
                                                className="bg-indigo-50 text-indigo-700 hover:bg-indigo-100 px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer"
                                              >
                                                {label}
                                              </button>
                                              {showPeresortBtn && (
                                                <button
                                                  id={`btn-open-peresort-${s.postingId}`}
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    setSelectedPeresortShipment(s);
                                                  }}
                                                  className="bg-amber-50 text-amber-700 hover:bg-amber-100 px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer"
                                                >
                                                  {s.peresortJSON && s.peresortJSON.trim() !== '' ? 'Пересорт ✓' : 'Пересорт'}
                                                </button>
                                              )}
                                            </div>
                                          );
                                        })()}
                                      </div>
                                      {renderItemsTable(s.itemsJSON, s.acceptedJSON, s.recalcJSON)}
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}
      {selectedAcceptanceShipment && (
        <AcceptanceModal
          shipment={selectedAcceptanceShipment}
          onClose={() => setSelectedAcceptanceShipment(null)}
          saveShipmentAcceptance={saveShipmentAcceptance}
        />
      )}
      {selectedPeresortShipment && (
        <PeresortModal
          shipment={selectedPeresortShipment}
          onClose={() => setSelectedPeresortShipment(null)}
        />
      )}
    </div>
  );
});

OzonSuppliesTab.displayName = 'OzonSuppliesTab';
