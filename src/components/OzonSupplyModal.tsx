import React, { useState, useMemo, useEffect, useRef } from 'react';
import { X, AlertTriangle, Send, Trash2, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { resolveOzonArticle } from '../lib/ozonCoverage';

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

const REQUEST_TIMEOUT_SEC = 60;

export const OzonSupplyModal: React.FC<OzonSupplyModalProps> = ({
  isOpen, onClose, rows, cabinet, dropOffWarehouseId, dropOffWarehouseName, dropOffWarehouseType, onCreated
}) => {
  const skus = useWarehouseStore((state) => state.skus);
  const ozonStocks = useWarehouseStore((state) => state.ozonStocks);
  const sessionToken = useWarehouseStore((state) => state.sessionToken);
  const devMode = useWarehouseStore((state) => state.devMode);
  const currentUser = useWarehouseStore((state) => state.currentUser);
  const fetchGas = useWarehouseStore((state) => state.fetchGas);

  const [phase, setPhase] = useState<Phase>('form');
  const [qtyEdit, setQtyEdit] = useState<Record<string, number>>({});
  const [removedRows, setRemovedRows] = useState<Record<string, boolean>>({});
  const [draftId, setDraftId] = useState('');
  const [verdict, setVerdict] = useState<any>(null);
  const [secondsLeft, setSecondsLeft] = useState(REQUEST_TIMEOUT_SEC);
  const [timedOut, setTimedOut] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  const rowKey = (r: SupplyPlanRow) => `${r.article}|||${r.clusterId}`;

  // Сброс состояния при каждом открытии: иначе зависшая фаза отправки
  // остаётся навсегда и модалка больше не открывается нормально
  useEffect(() => {
    if (isOpen) {
      setPhase('form');
      setQtyEdit({});
      setRemovedRows({});
      setDraftId('');
      setVerdict(null);
      setSecondsLeft(REQUEST_TIMEOUT_SEC);
      setTimedOut(false);
    }
  }, [isOpen]);

  // Обратный отсчёт во время работы с Ozon
  useEffect(() => {
    if (phase !== 'sending') return;
    setSecondsLeft(REQUEST_TIMEOUT_SEC);
    setTimedOut(false);
    const id = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(id);
          setTimedOut(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [phase]);

  const getQty = (r: SupplyPlanRow) => {
    const v = qtyEdit[rowKey(r)];
    return v === undefined ? r.qty : v;
  };

  const activeRows = useMemo(
    () => rows.filter((r) => !removedRows[rowKey(r)]),
    [rows, removedRows]
  );

  /**
   * Нормализация значения в числовой Ozon-SKU.
   * Отсекает буквенные префиксы технических штрихкодов (OZN1706096599),
   * дробный хвост из Google Sheets (1706096599.0) и пробелы.
   */
  const normalizeOzonSku = (raw: any): string => {
    let v = String(raw == null ? '' : raw).trim();
    if (!v) return '';
    v = v.replace(/\s+/g, '');
    v = v.replace(/\.0+$/, '');
    const digits = v.replace(/\D/g, '');
    if (!digits) return '';
    if (digits.length < 6) return '';
    return digits;
  };

  const skuMap = useMemo(() => {
    const map: Record<string, string> = {};

    for (const row of ozonStocks || []) {
      const article = resolveOzonArticle(skus, row.offerId, row.sku);
      if (!article || article === 'НЕИЗВЕСТНО') continue;
      if (map[article]) continue;
      const normalized = normalizeOzonSku(row.sku);
      if (normalized) map[article] = normalized;
    }

    for (const s of skus) {
      if (map[s.sku]) continue;
      const normalized = normalizeOzonSku(s.ozonBarcode);
      if (normalized) map[s.sku] = normalized;
    }

    return map;
  }, [skus, ozonStocks]);

  const missingSku = useMemo(
    () => Array.from(new Set(activeRows.filter((r) => !skuMap[r.article]).map((r) => r.article))),
    [activeRows, skuMap]
  );

  const totals = useMemo(() => {
    let qty = 0;
    for (const r of activeRows) qty += getQty(r);
    const clusters = new Set(activeRows.map((r) => r.clusterId));
    return { qty, rows: activeRows.length, clusters: clusters.size };
  }, [activeRows, qtyEdit]);

  if (!isOpen) return null;

  const buildPayloadClusters = () => {
    const byCluster: Record<string, { clusterId: string; items: { sku: number; quantity: number }[] }> = {};
    for (const r of activeRows) {
      const q = getQty(r);
      if (q <= 0) continue;
      const ozonSku = skuMap[r.article];
      if (!ozonSku) continue;
      if (!byCluster[r.clusterId]) byCluster[r.clusterId] = { clusterId: r.clusterId, items: [] };
      byCluster[r.clusterId].items.push({ sku: Number(ozonSku), quantity: q });
    }
    return Object.values(byCluster);
  };

  const buildAvailabilityCheck = () => {
    const byArticle: Record<string, number> = {};
    for (const r of activeRows) {
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

  /** fetch с жёстким обрывом по таймауту, чтобы модалка не висела вечно */
  const fetchWithTimeout = async (url: string, body: string) => {
    const controller = new AbortController();
    abortRef.current = controller;
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_SEC * 1000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal
      });
      return await res.json();
    } finally {
      clearTimeout(timer);
      abortRef.current = null;
    }
  };

  const handleClose = () => {
    if (phase === 'sending' && !timedOut) {
      const ok = window.confirm(
        'Запрос к Ozon ещё выполняется. Если закрыть окно сейчас, заявка всё равно может быть создана — проверьте её в Ozon Seller. Закрыть?'
      );
      if (!ok) return;
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    onClose();
  };

  const sendOrder = async (useDraftId: string, clusterIds: string[]) => {
    let result: any;
    try {
      result = await fetchWithTimeout('/api/ozon/supply/create', proxyBody({
        cabinet,
        draftId: useDraftId,
        clusterIds,
        availabilityCheck: buildAvailabilityCheck()
      }));
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        toast.error('Ozon не ответил за минуту. Проверьте список заявок в Ozon Seller: заявка могла быть создана.');
      } else {
        toast.error('Ошибка сети: ' + (e?.message || ''));
      }
      setPhase('verdict');
      return;
    }

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
          itemsJSON: JSON.stringify(activeRows.map((r) => ({ article: r.article, clusterId: r.clusterId, qty: getQty(r) }))),
          status: 'Создана'
        }
      });
    } catch (e) {
      console.error('Не удалось записать заявку в журнал:', e);
    }

    toast.success('Заявка создана в Ozon. Номер: ' + orderId + '. Грузоместа заполните в Ozon Seller.');
    onCreated();
    onClose();
  };

  const handleSubmit = async () => {
    if (!dropOffWarehouseId || !dropOffWarehouseType) {
      toast.error('Не выбрана точка отгрузки — укажите её в настройках Ozon');
      return;
    }
    if (missingSku.length > 0) {
      toast.error('Не удалось определить Ozon-SKU для артикулов: ' + missingSku.join(', ') + '. Проверьте, что товар есть в зеркале «Остатки Ozon», либо заполните ШК Ozon в SKU Базе.');
      return;
    }
    const clusters = buildPayloadClusters();
    if (clusters.length === 0) {
      toast.error('Состав заявки пуст');
      return;
    }

    setPhase('sending');

    let result: any;
    try {
      result = await fetchWithTimeout('/api/ozon/supply/draft', proxyBody({
        cabinet, dropOffWarehouseId, dropOffWarehouseType, clusters
      }));
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        toast.error('Ozon не ответил за минуту. Заявка НЕ создана — попробуйте ещё раз.');
      } else {
        toast.error('Ошибка сети: ' + (e?.message || ''));
      }
      setPhase('form');
      return;
    }

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
  };

  const handleConfirmAnyway = async () => {
    setPhase('sending');
    const clusterIds = (verdict?.clusters || []).map((c: any) => String(c.clusterId));
    await sendOrder(draftId, clusterIds);
  };

  const handleBackToForm = () => {
    setPhase('form');
    setVerdict(null);
    setDraftId('');
  };

  const removeCluster = (clusterId: string) => {
    const next = { ...removedRows };
    for (const r of rows) {
      if (r.clusterId === clusterId) next[rowKey(r)] = true;
    }
    setRemovedRows(next);
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
          <button onClick={handleClose} type="button" className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-500">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-3">
          {phase === 'sending' && (
            <div className="py-12 text-center">
              {timedOut ? (
                <div className="space-y-2">
                  <div className="text-sm font-bold text-red-700">Ozon не ответил за минуту</div>
                  <div className="text-xs text-slate-600 max-w-md mx-auto">
                    Заявка могла быть создана, а могла и нет. Откройте Ozon Seller, раздел FBO → Заявки на поставку.
                    Если заявка появилась — отмените её там и создайте заново. Если нет — просто попробуйте ещё раз.
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="text-slate-500 font-medium">Работаем с Ozon…</div>
                  <div className="text-3xl font-bold text-indigo-600 tabular-nums">{secondsLeft}</div>
                  <div className="text-xs text-slate-400">секунд до истечения ожидания</div>
                </div>
              )}
            </div>
          )}

          {phase === 'form' && (
            <>
              {missingSku.length > 0 && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs font-semibold text-red-800">
                  Не удалось определить Ozon-SKU: {missingSku.join(', ')}. SKU берётся из зеркала «Остатки Ozon», запасной источник — колонка «ШК Ozon» в SKU Базе.
                </div>
              )}
              <div className="text-xs text-slate-500">
                Проверьте состав. Количество можно уменьшить, лишнюю строку или кластер — убрать крестиком.
                Остатки на складе это не меняет: в Ozon уходит заявленное количество.
              </div>
              <div className="flex flex-col gap-2">
                {activeRows.map((r) => (
                  <div key={rowKey(r)} className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 bg-slate-50/50">
                    <div className="min-w-0 flex-1">
                      <div className="font-mono font-bold text-sm text-slate-800 truncate">{r.article}</div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {r.clusterName}
                        {skuMap[r.article] && <span className="ml-1.5 text-slate-400">SKU {skuMap[r.article]}</span>}
                      </div>
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
                    <button
                      type="button"
                      onClick={() => setRemovedRows({ ...removedRows, [rowKey(r)]: true })}
                      title="Убрать эту строку из заявки"
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors shrink-0"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>

              {totals.clusters > 1 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <span className="text-[11px] text-slate-400 mr-1">Убрать кластер целиком:</span>
                  {Array.from(new Set(activeRows.map((r) => r.clusterId))).map((cid) => {
                    const cname = activeRows.find((r) => r.clusterId === cid)?.clusterName || cid;
                    return (
                      <button
                        key={cid}
                        type="button"
                        onClick={() => removeCluster(cid)}
                        className="px-2 py-1 rounded-lg border border-slate-200 text-[11px] font-semibold text-slate-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors"
                      >
                        {cname} ✕
                      </button>
                    );
                  })}
                </div>
              )}

              {Object.keys(removedRows).length > 0 && (
                <button
                  type="button"
                  onClick={() => setRemovedRows({})}
                  className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800"
                >
                  Вернуть убранные строки
                </button>
              )}

              <div className="text-xs font-bold text-slate-700">
                Итого: {totals.rows} строк, {totals.clusters} кластеров, {totals.qty} шт
              </div>
            </>
          )}

          {phase === 'verdict' && verdict && (
            <>
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 flex gap-2">
                <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                <div className="text-xs font-semibold text-amber-900">
                  Ozon принял заявку не полностью. Заявка ещё НЕ создана.
                  Можно вернуться и убрать проблемные кластеры или уменьшить количество — либо создать заявку в том составе, который Ozon подтвердил.
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
          {phase === 'verdict' && (
            <button
              type="button"
              onClick={handleBackToForm}
              className="px-5 py-2.5 rounded-xl text-sm font-bold text-indigo-600 hover:bg-indigo-50 transition-colors flex items-center gap-2 mr-auto"
            >
              <ArrowLeft size={16} />
              Вернуться и исправить
            </button>
          )}
          <button
            type="button"
            onClick={handleClose}
            className="px-5 py-2.5 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-200 transition-colors"
          >
            {phase === 'sending' && timedOut ? 'Закрыть' : 'Отмена'}
          </button>
          {phase === 'form' && (
            <button
              type="button"
              id="btn-ozon-supply-submit"
              onClick={handleSubmit}
              disabled={missingSku.length > 0 || activeRows.length === 0}
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
