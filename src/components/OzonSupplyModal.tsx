import React, { useState, useMemo } from 'react';
import { X, AlertTriangle, Send } from 'lucide-react';
import { toast } from 'sonner';
import { useWarehouseStore } from '../store/useWarehouseStore';

export interface SupplyPlanRow {
  article: string;
  name: string;
  clusterId: string;
  clusterName: string;
  boxes: number;
  qty: number;
  limitedByMyStock: boolean;
}

interface OzonSupplyModalProps {
  isOpen: boolean;
  onClose: () => void;
  rows: SupplyPlanRow[];
  cabinet: string;
  dropOffWarehouseId: string;
  dropOffWarehouseName: string;
  dropOffWarehouseType: string;
  onCreated: () => void;
}

type Phase = 'form' | 'verdict' | 'sending';

export const OzonSupplyModal: React.FC<OzonSupplyModalProps> = ({
  isOpen, onClose, rows, cabinet, dropOffWarehouseId, dropOffWarehouseName, dropOffWarehouseType, onCreated
}) => {
  const skus = useWarehouseStore((state) => state.skus);
  const sessionToken = useWarehouseStore((state) => state.sessionToken);
  const devMode = useWarehouseStore((state) => state.devMode);
  const currentUser = useWarehouseStore((state) => state.currentUser);
  const fetchGas = useWarehouseStore((state) => state.fetchGas);

  const [phase, setPhase] = useState<Phase>('form');
  const [qtyEdit, setQtyEdit] = useState<Record<string, number>>({});
  const [draftId, setDraftId] = useState('');
  const [verdict, setVerdict] = useState<any>(null);

  const rowKey = (r: SupplyPlanRow) => `${r.article}|||${r.clusterId}`;
  const getQty = (r: SupplyPlanRow) => {
    const v = qtyEdit[rowKey(r)];
    return v === undefined ? r.qty : v;
  };

  // Ozon-SKU хранится в SKU Базе, колонка «ШК Ozon»
  const skuMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of skus) {
      const ozon = String(s.ozonBarcode || '').trim();
      if (ozon) map[s.sku] = ozon;
    }
    return map;
  }, [skus]);

  const missingSku = useMemo(
    () => Array.from(new Set(rows.filter((r) => !/^\d+$/.test(skuMap[r.article] || '')).map((r) => r.article))),
    [rows, skuMap]
  );

  const totals = useMemo(() => {
    let qty = 0;
    for (const r of rows) qty += getQty(r);
    return { qty, rows: rows.length };
  }, [rows, qtyEdit]);

  if (!isOpen) return null;

  const buildPayloadClusters = () => {
    const byCluster: Record<string, { clusterId: string; items: { sku: number; quantity: number }[] }> = {};
    for (const r of rows) {
      const q = getQty(r);
      if (q <= 0) continue;
      const ozonSku = skuMap[r.article];
      if (!/^\d+$/.test(ozonSku || '')) continue;
      if (!byCluster[r.clusterId]) byCluster[r.clusterId] = { clusterId: r.clusterId, items: [] };
      byCluster[r.clusterId].items.push({ sku: Number(ozonSku), quantity: q });
    }
    return Object.values(byCluster);
  };

  const buildAvailabilityCheck = () => {
    const byArticle: Record<string, number> = {};
    for (const r of rows) {
      const q = getQty(r);
      if (q <= 0) continue;
      byArticle[r.article] = (byArticle[r.article] || 0) + q;
    }
    return Object.entries(byArticle).map(([article, quantity]) => ({ article, quantity }));
  };

  const proxyBody = (extra: any) => {
    const role = currentUser?.role?.toLowerCase() || '';
    const isAdminRole = role === 'admin' || role === 'администратор';
    const sendDevMode = devMode && isAdminRole;
    return JSON.stringify({ sessionToken, ...(sendDevMode ? { devMode: true } : {}), ...extra });
  };

  const sendOrder = async (useDraftId: string, clusterIds: string[]) => {
    const res = await fetch('/api/ozon/supply/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: proxyBody({
        cabinet,
        draftId: useDraftId,
        clusterIds,
        availabilityCheck: buildAvailabilityCheck()
      })
    });
    const result = await res.json();

    if (result.status !== 'success') {
      if (result.stage === 'not_enough_stock') {
        const list = (result.data?.shortage || [])
          .map((s: any) => `${s.article}: нужно ${s.requested}, есть ${s.available}`)
          .join('; ');
        toast.error('Не хватает товара на Моём складе. ' + list);
      } else {
        toast.error(result.message || 'Ozon не принял заявку');
      }
      setPhase('verdict');
      return;
    }

    const orderId = String(result.data?.orderId || '');

    try {
      await fetchGas('saveOzonSupplyRequest', {
        data: {
          cabinet,
          draftId: useDraftId,
          orderId,
          dropOffName: dropOffWarehouseName,
          clusters: clusterIds.join(','),
          itemsJSON: JSON.stringify(rows.map((r) => ({ article: r.article, clusterId: r.clusterId, qty: getQty(r) }))),
          status: 'Создана'
        }
      });
    } catch (e) {
      console.error('Не удалось записать заявку в журнал:', e);
    }

    toast.success('Заявка создана в Ozon. Номер: ' + orderId);
    onCreated();
    onClose();
  };

  const handleSubmit = async () => {
    if (!dropOffWarehouseId || !dropOffWarehouseType) {
      toast.error('Не выбрана точка отгрузки — укажите её в настройках Ozon');
      return;
    }
    if (missingSku.length > 0) {
      toast.error('Не заполнен ШК Ozon в SKU Базе: ' + missingSku.join(', '));
      return;
    }
    const clusters = buildPayloadClusters();
    if (clusters.length === 0) {
      toast.error('Состав заявки пуст');
      return;
    }

    setPhase('sending');
    try {
      const res = await fetch('/api/ozon/supply/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: proxyBody({ cabinet, dropOffWarehouseId, dropOffWarehouseType, clusters })
      });
      const result = await res.json();

      if (result.status !== 'success') {
        toast.error(result.message || 'Ozon не рассчитал черновик');
        setPhase('form');
        return;
      }

      const data = result.data;
      setDraftId(String(data.draftId || ''));
      setVerdict(data);

      const hasRejected = Array.isArray(data.rejectedItems) && data.rejectedItems.length > 0;
      const hasBadCluster = (data.clusters || []).some((c: any) => c.state !== 'FULL_AVAILABLE');
      const hasRestricted = (data.clusters || []).some((c: any) => (c.rejected || []).length > 0);

      const clusterIds = (data.clusters || []).map((c: any) => String(c.clusterId));

      if (hasRejected || hasBadCluster || hasRestricted) {
        setPhase('verdict');
        return;
      }

      await sendOrder(String(data.draftId || ''), clusterIds);
    } catch (e: any) {
      toast.error('Ошибка сети: ' + (e?.message || ''));
      setPhase('form');
    }
  };

  const handleConfirmAnyway = async () => {
    setPhase('sending');
    try {
      const clusterIds = (verdict?.clusters || []).map((c: any) => String(c.clusterId));
      await sendOrder(draftId, clusterIds);
    } catch (e: any) {
      toast.error('Ошибка сети: ' + (e?.message || ''));
      setPhase('verdict');
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 fade-in">
      <div className="bg-white rounded-3xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh] modal-enter">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <div>
            <h3 className="text-xl font-bold text-slate-900">Оформить поставку в Ozon</h3>
            <div className="text-xs text-slate-500 mt-0.5">
              Точка отгрузки: {dropOffWarehouseName || 'не выбрана'}
              {cabinet ? ` · кабинет ${cabinet}` : ''}
            </div>
          </div>
          <button onClick={onClose} type="button" className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-500">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-3">
          {phase === 'sending' && (
            <div className="py-12 text-center text-slate-500 font-medium">
              Работаем с Ozon, это может занять до минуты…
            </div>
          )}

          {phase === 'form' && (
            <>
              {missingSku.length > 0 && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs font-semibold text-red-800">
                  Не заполнен ШК Ozon в SKU Базе: {missingSku.join(', ')}. Без него заявку отправить нельзя.
                </div>
              )}
              <div className="text-xs text-slate-500">
                Проверьте количества. Изменения не влияют на остатки — они уйдут в Ozon как заявленное количество.
              </div>
              <div className="flex flex-col gap-2">
                {rows.map((r) => (
                  <div key={rowKey(r)} className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 bg-slate-50/50">
                    <div className="min-w-0 flex-1">
                      <div className="font-mono font-bold text-sm text-slate-800 truncate">{r.article}</div>
                      <div className="text-[11px] text-slate-500 truncate">{r.clusterName}</div>
                      {r.limitedByMyStock && (
                        <div className="text-[11px] text-amber-600 font-semibold">урезано остатком Моего склада</div>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400 shrink-0">{r.boxes} кор</div>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={getQty(r)}
                      onChange={(e) =>
                        setQtyEdit({ ...qtyEdit, [rowKey(r)]: e.target.value === '' ? 0 : parseInt(e.target.value, 10) })
                      }
                      className="w-24 px-3 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm font-semibold text-slate-800 bg-white"
                    />
                    <span className="text-[11px] text-slate-400 shrink-0">шт</span>
                  </div>
                ))}
              </div>
              <div className="text-xs font-bold text-slate-700">
                Итого: {totals.rows} строк, {totals.qty} шт
              </div>
            </>
          )}

          {phase === 'verdict' && verdict && (
            <>
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 flex gap-2">
                <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                <div className="text-xs font-semibold text-amber-900">
                  Ozon принял заявку не полностью. Проверьте, что войдёт в поставку. Заявка ещё НЕ создана.
                </div>
              </div>

              {(verdict.clusters || []).map((c: any) => (
                <div key={c.clusterId} className="p-3 rounded-xl border border-slate-200">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-bold text-sm text-slate-800">{c.clusterName || c.clusterId}</div>
                    <div className={`text-[11px] font-bold ${c.state === 'FULL_AVAILABLE' ? 'text-emerald-600' : 'text-red-600'}`}>
                      {c.state}{c.invalidReason && c.invalidReason !== 'UNSPECIFIED' ? ` · ${c.invalidReason}` : ''}
                    </div>
                  </div>
                  {(c.accepted || []).length > 0 && (
                    <div className="mt-2">
                      <div className="text-[11px] font-bold uppercase text-slate-400">Войдёт в поставку</div>
                      {c.accepted.map((it: any, i: number) => (
                        <div key={`a${i}`} className="text-[11px] text-slate-600 flex justify-between gap-2">
                          <span className="truncate">{it.offerId || it.sku}</span>
                          <span className="font-semibold shrink-0">{it.quantity} шт</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {(c.rejected || []).length > 0 && (
                    <div className="mt-2">
                      <div className="text-[11px] font-bold uppercase text-red-500">Не войдёт</div>
                      {c.rejected.map((it: any, i: number) => (
                        <div key={`r${i}`} className="text-[11px] text-red-600 flex justify-between gap-2">
                          <span className="truncate">{it.offerId || it.sku}</span>
                          <span className="font-semibold shrink-0">{it.quantity} шт</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {(verdict.rejectedItems || []).length > 0 && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200">
                  <div className="text-[11px] font-bold uppercase text-red-600 mb-1">Причины отказа Ozon</div>
                  {verdict.rejectedItems.map((r: any, i: number) => (
                    <div key={i} className="text-[11px] text-red-700">
                      кластер {r.clusterId}, SKU {r.sku}: {(r.reasons || []).join(', ')}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="p-6 border-t border-slate-100 bg-slate-50/50 flex gap-3 justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={phase === 'sending'}
            className="px-5 py-2.5 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-200 disabled:opacity-50 transition-colors"
          >
            Отмена
          </button>
          {phase === 'form' && (
            <button
              type="button"
              id="btn-ozon-supply-submit"
              onClick={handleSubmit}
              disabled={missingSku.length > 0 || rows.length === 0}
              className="px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-bold transition-colors flex items-center gap-2"
            >
              <Send size={16} />
              Оформить заявку в Ozon
            </button>
          )}
          {phase === 'verdict' && (
            <button
              type="button"
              id="btn-ozon-supply-confirm"
              onClick={handleConfirmAnyway}
              className="px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-bold transition-colors flex items-center gap-2"
            >
              <Send size={16} />
              Создать заявку в этом составе
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
