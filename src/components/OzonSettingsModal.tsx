import React, { useState, useEffect, useMemo } from 'react';
import { X, HelpCircle, Search, Check } from 'lucide-react';
import { toast } from 'sonner';
import { useWarehouseStore } from '../store/useWarehouseStore';

interface OzonSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface OzonSettingsData {
  speedWeeks: number;
  minStockDays: number;
  targetStockDays: number;
  maxClusterDays: number;
  factoryOrderDays: number;
  returnsToSalePct: number;
  salesRetentionWeeks: number;
  excludedClusters: string;
  priorityClusters: string;
  maxBoxesPerCluster: number;
  dropOffWarehouseId: string;
  dropOffWarehouseName: string;
  dropOffWarehouseType: string;
}

const FieldHint: React.FC<{ text: string; position?: 'top' | 'bottom' }> = ({ text, position = 'top' }) => (
  <span className="relative inline-flex group align-middle ml-1.5">
    <HelpCircle size={14} className="text-slate-400 hover:text-indigo-500 cursor-help" />
    <span
      className={`pointer-events-none absolute left-1/2 -translate-x-1/2 z-10 hidden group-hover:block w-64 bg-slate-800 text-white text-xs font-normal normal-case rounded-xl px-3 py-2 shadow-lg leading-snug whitespace-normal ${
        position === 'bottom' ? 'top-full mt-2' : 'bottom-full mb-2'
      }`}
    >
      {text}
    </span>
  </span>
);

export const OzonSettingsModal: React.FC<OzonSettingsModalProps> = ({ isOpen, onClose }) => {
  const fetchGas = useWarehouseStore((state) => state.fetchGas);
  const ozonStocks = useWarehouseStore((state) => state.ozonStocks);
  const sessionToken = useWarehouseStore((state) => state.sessionToken);
  const devMode = useWarehouseStore((state) => state.devMode);
  const currentUser = useWarehouseStore((state) => state.currentUser);

  const [dropOffQuery, setDropOffQuery] = useState('');
  const [dropOffResults, setDropOffResults] = useState<{ warehouseId: string; name: string; address: string; warehouseType: string }[]>([]);
  const [dropOffSearching, setDropOffSearching] = useState(false);

  const [directory, setDirectory] = useState<{ clusterId: string; clusterName: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<OzonSettingsData>({
    speedWeeks: 4,
    minStockDays: 7,
    targetStockDays: 30,
    maxClusterDays: 100,
    factoryOrderDays: 60,
    returnsToSalePct: 80,
    salesRetentionWeeks: 78,
    excludedClusters: '',
    priorityClusters: '',
    maxBoxesPerCluster: 30,
    dropOffWarehouseId: '',
    dropOffWarehouseName: '',
    dropOffWarehouseType: '',
  });

  const handleDropOffSearch = async () => {
    const query = dropOffQuery.trim();
    if (query.length < 4) {
      toast.error('Введите минимум 4 символа названия точки отгрузки');
      return;
    }
    setDropOffSearching(true);
    try {
      const role = currentUser?.role?.toLowerCase() || '';
      const isAdminRole = role === 'admin' || role === 'администратор';
      const sendDevMode = devMode && isAdminRole;

      const res = await fetch('/api/ozon/dropoff/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken, search: query, ...(sendDevMode ? { devMode: true } : {}) })
      });
      const result = await res.json();
      if (result.status === 'success' && Array.isArray(result.data?.warehouses)) {
        setDropOffResults(result.data.warehouses);
        if (result.data.warehouses.length === 0) {
          toast.error('Ozon не нашёл точек отгрузки по этому названию');
        }
      } else {
        toast.error(result.message || 'Ошибка поиска точки отгрузки');
      }
    } catch (e: any) {
      toast.error('Ошибка сети при поиске точки отгрузки: ' + (e?.message || ''));
    } finally {
      setDropOffSearching(false);
    }
  };

  const clusters = useMemo(() => {
    if (directory.length > 0) {
      const map = new Map<string, string>();
      directory.forEach((item) => {
        const cid = String(item.clusterId || '').trim();
        if (cid) {
          if (!map.has(cid)) {
            const cname = String(item.clusterName || '').trim();
            map.set(cid, cname || `Кластер ${cid}`);
          }
        }
      });
      return Array.from(map.entries())
        .map(([clusterId, clusterName]) => ({ clusterId, clusterName }))
        .sort((a, b) => a.clusterName.localeCompare(b.clusterName, 'ru'));
    }

    const map = new Map<string, string>();
    (ozonStocks || []).forEach((item) => {
      const cid = String(item.clusterId || '').trim();
      if (cid) {
        if (!map.has(cid)) {
          const cname = String(item.clusterName || '').trim();
          map.set(cid, cname || `Кластер ${cid}`);
        }
      }
    });
    return Array.from(map.entries())
      .map(([clusterId, clusterName]) => ({ clusterId, clusterName }))
      .sort((a, b) => a.clusterName.localeCompare(b.clusterName, 'ru'));
  }, [directory, ozonStocks]);

  const excludedSet = useMemo(() => {
    return new Set((form.excludedClusters || '').split(',').map((s) => s.trim()).filter(Boolean));
  }, [form.excludedClusters]);

  const priorityMap = useMemo(() => {
    const map: Record<string, number> = {};
    (form.priorityClusters || '').split(',').map((s) => s.trim()).filter(Boolean).forEach((part) => {
      const [rawId, rawK] = part.split(':');
      const id = String(rawId || '').trim();
      if (!id) return;
      const k = Number(String(rawK || '').trim().replace(',', '.'));
      map[id] = isNaN(k) || k < 1 ? 1.5 : k;
    });
    return map;
  }, [form.priorityClusters]);

  const serializePriority = (map: Record<string, number>) =>
    Object.entries(map).map(([id, k]) => `${id}:${k}`).join(',');

  const handleTogglePriority = (clusterId: string) => {
    const next = { ...priorityMap };
    if (next[clusterId] !== undefined) {
      delete next[clusterId];
      setForm({ ...form, priorityClusters: serializePriority(next) });
      return;
    }
    next[clusterId] = 1.5;
    const nextExcluded = (form.excludedClusters || '').split(',').map((s) => s.trim()).filter(Boolean).filter((id) => id !== clusterId);
    setForm({ ...form, priorityClusters: serializePriority(next), excludedClusters: nextExcluded.join(',') });
  };

  const handleChangePriorityK = (clusterId: string, value: string) => {
    const next = { ...priorityMap };
    const k = Number(String(value).replace(',', '.'));
    next[clusterId] = isNaN(k) || k < 1 ? 1 : k;
    setForm({ ...form, priorityClusters: serializePriority(next) });
  };

  const handleToggleCluster = (clusterId: string) => {
    const currentList = (form.excludedClusters || '').split(',').map((s) => s.trim()).filter(Boolean);
    const isRemoving = currentList.includes(clusterId);
    const nextList = isRemoving
      ? currentList.filter((id) => id !== clusterId)
      : [...currentList, clusterId];
    if (isRemoving) {
      setForm({ ...form, excludedClusters: nextList.join(',') });
      return;
    }
    const nextPriority = { ...priorityMap };
    delete nextPriority[clusterId];
    setForm({ ...form, excludedClusters: nextList.join(','), priorityClusters: serializePriority(nextPriority) });
  };

  useEffect(() => {
    if (isOpen) {
      setLoading(true);

      fetchGas('getOzonClusters')
        .then((res) => {
          if (res?.status === 'success' && Array.isArray(res.data)) {
            const list = res.data
              .map((item: any) => ({
                clusterId: String(item.clusterId || '').trim(),
                clusterName: String(item.clusterName || '').trim(),
              }))
              .filter((item: any) => Boolean(item.clusterId));
            setDirectory(list);
          }
        })
        .catch((err) => {
          console.error('Ошибка получения справочника кластеров:', err);
        });

      fetchGas('getOzonSettings')
        .then((res) => {
          if (res?.status === 'success' && res.data) {
            setForm({
              speedWeeks: Number(res.data.speedWeeks) || 4,
              minStockDays: Number(res.data.minStockDays) || 7,
              targetStockDays: Number(res.data.targetStockDays) || 30,
              maxClusterDays: res.data.maxClusterDays === undefined || res.data.maxClusterDays === '' ? 100 : Number(res.data.maxClusterDays),
              factoryOrderDays: Number(res.data.factoryOrderDays) || 60,
              returnsToSalePct: Number(res.data.returnsToSalePct) || 80,
              salesRetentionWeeks: Number(res.data.salesRetentionWeeks) || 78,
              excludedClusters: String(res.data.excludedClusters || ''),
              priorityClusters: String(res.data.priorityClusters || ''),
              maxBoxesPerCluster: Number(res.data.maxBoxesPerCluster) || 30,
              dropOffWarehouseId: String(res.data.dropOffWarehouseId || ''),
              dropOffWarehouseName: String(res.data.dropOffWarehouseName || ''),
              dropOffWarehouseType: String(res.data.dropOffWarehouseType || ''),
            });
          } else if (res?.status === 'error') {
            toast.error(res.message || 'Ошибка загрузки настроек Ozon');
          }
        })
        .catch((err) => {
          toast.error(err?.message || 'Ошибка обращения к серверу');
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [isOpen, fetchGas]);

  if (!isOpen) return null;

  const handleSave = async () => {
    const checkMinDays = Math.max(0, parseFloat(String(form.minStockDays)) || 0);
    const checkTargetDays = Math.max(0, parseFloat(String(form.targetStockDays)) || 0);
    if (checkTargetDays <= checkMinDays) {
      toast.error('Целевой запас должен быть больше Неснижаемого остатка: неснижаемый входит внутрь целевого, а не прибавляется к нему');
      return;
    }
    setSaving(true);
    try {
      const payload: OzonSettingsData = {
        speedWeeks: Math.max(1, parseInt(String(form.speedWeeks), 10) || 1),
        minStockDays: Math.max(0, parseFloat(String(form.minStockDays)) || 0),
        targetStockDays: Math.max(0, parseFloat(String(form.targetStockDays)) || 0),
        maxClusterDays: Math.max(0, parseFloat(String(form.maxClusterDays)) || 0),
        factoryOrderDays: Math.max(0, parseFloat(String(form.factoryOrderDays)) || 0),
        returnsToSalePct: Math.min(100, Math.max(0, parseFloat(String(form.returnsToSalePct)) || 0)),
        salesRetentionWeeks: Math.max(1, parseInt(String(form.salesRetentionWeeks), 10) || 1),
        excludedClusters: form.excludedClusters,
        priorityClusters: form.priorityClusters,
        maxBoxesPerCluster: Math.max(1, parseInt(String(form.maxBoxesPerCluster), 10) || 1),
        dropOffWarehouseId: form.dropOffWarehouseId,
        dropOffWarehouseName: form.dropOffWarehouseName,
        dropOffWarehouseType: form.dropOffWarehouseType,
      };

      const res = await fetchGas('saveOzonSettings', { data: payload });
      if (res?.status === 'success') {
        toast.success('Настройки Ozon сохранены');
        onClose();
      } else {
        toast.error(res?.message || 'Ошибка сохранения настроек Ozon');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Ошибка сети при сохранении настроек');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 fade-in">
      <div className="bg-white rounded-3xl shadow-xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh] modal-enter">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <h3 className="text-xl font-bold text-slate-900">Настройки Ozon</h3>
          <button
            onClick={onClose}
            type="button"
            className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-500"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          {loading ? (
            <div className="py-12 text-center text-slate-500 font-medium">
              Загрузка…
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Полных недель для скорости продаж
                  <FieldHint position="bottom" text="Сколько последних ПОЛНЫХ недель продаж берётся для расчёта скорости. Текущая незавершённая неделя не учитывается. Например, 4 — скорость = продажи за 4 полные недели ÷ 28 дней. Больше недель — стабильнее оценка, но медленнее реакция на изменение спроса." />
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={form.speedWeeks}
                  onChange={(e) =>
                    setForm({ ...form, speedWeeks: e.target.value === '' ? 0 : parseInt(e.target.value, 10) })
                  }
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm font-semibold text-slate-800 bg-slate-50/50"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Неснижаемый остаток, дней
                  <FieldHint position="bottom" text="Страховой запас в днях продаж, который всегда должен оставаться на складах Ozon. Вычитается при расчёте покрытия: покрытие = (расчётный остаток − скорость × эти дни) ÷ скорость. Чем больше значение, тем раньше появится рекомендация сделать поставку." />
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={form.minStockDays}
                  onChange={(e) =>
                    setForm({ ...form, minStockDays: e.target.value === '' ? 0 : parseFloat(e.target.value) })
                  }
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm font-semibold text-slate-800 bg-slate-50/50"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Целевой запас на Ozon, дней
                  <FieldHint position="bottom" text="На сколько дней продаж пополняется запас при поставке. Рекомендация поставки = скорость × целевой запас − расчётный остаток кластера. Неснижаемый остаток входит ВНУТРЬ этого срока и отдельно не прибавляется, поэтому значение обязано быть больше неснижаемого. Чем больше значение, тем крупнее и реже поставки." />
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={form.targetStockDays}
                  onChange={(e) =>
                    setForm({ ...form, targetStockDays: e.target.value === '' ? 0 : parseFloat(e.target.value) })
                  }
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm font-semibold text-slate-800 bg-slate-50/50"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Максимальный срок продаж кластера, дней
                  <FieldHint position="bottom" text="Защита от заваливания медленных кластеров. Поставка идёт целыми коробками, поэтому кластеру со скоростью 0,07 шт в день одна коробка на 42 шт даёт запас почти на два года. Если после поставки расчётный запас кластера превысит это число дней, кластер из рекомендации исключается целиком и непокрытой потребности не создаёт — на сигнал заказа на фабрике он не влияет. Значение 0 полностью выключает эту защиту." />
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={form.maxClusterDays}
                  onChange={(e) =>
                    setForm({ ...form, maxClusterDays: e.target.value === '' ? 0 : parseFloat(e.target.value) })
                  }
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm font-semibold text-slate-800 bg-slate-50/50"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Объём заказа на фабрике, дней
                  <FieldHint text="Размер одного заказа на фабрике в днях продаж: рекомендуемый объём = скорость продаж × это число дней. Сигнал «пора заказывать» появляется, когда общего запаса (Ozon + Мой склад) не хватает на срок поставки товара плюс неснижаемые дни." />
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={form.factoryOrderDays}
                  onChange={(e) =>
                    setForm({ ...form, factoryOrderDays: e.target.value === '' ? 0 : parseFloat(e.target.value) })
                  }
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm font-semibold text-slate-800 bg-slate-50/50"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  % возвратов, возвращающихся в продажу
                  <FieldHint text="Какая доля возвратов реально возвращается в продажу. Возвраты входят в расчётный остаток с этим коэффициентом: расчётный остаток = Доступно + В пути + Возвраты × этот %." />
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="any"
                  value={form.returnsToSalePct}
                  onChange={(e) =>
                    setForm({ ...form, returnsToSalePct: e.target.value === '' ? 0 : parseFloat(e.target.value) })
                  }
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm font-semibold text-slate-800 bg-slate-50/50"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Срок хранения продаж, недель
                  <FieldHint text="Сколько недель истории продаж хранится в листе «Продажи Ozon». Строки старше удаляются автоматически при синхронизации. 78 недель = 18 месяцев — запас для будущего анализа сезонности." />
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={form.salesRetentionWeeks}
                  onChange={(e) =>
                    setForm({ ...form, salesRetentionWeeks: e.target.value === '' ? 0 : parseInt(e.target.value, 10) })
                  }
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm font-semibold text-slate-800 bg-slate-50/50"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Максимум коробок на кластер
                  <FieldHint text="Тарифный лимит Ozon на бесплатную отгрузку в один кластер. Если коробок больше, превышение подсвечивается в мастере поставки и остаток лучше оформить отдельной заявкой. Технический предел Ozon на один вызов — тоже 30 коробок." />
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={form.maxBoxesPerCluster}
                  onChange={(e) =>
                    setForm({ ...form, maxBoxesPerCluster: e.target.value === '' ? 0 : parseInt(e.target.value, 10) })
                  }
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm font-semibold text-slate-800 bg-slate-50/50"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Точка отгрузки Ozon
                  <FieldHint text="Склад Ozon, куда вы физически привозите коробки. Дальше Ozon развозит товар по кластерам сам. Найдите точку по части названия — например «ПЫШМА» — и выберите из списка. Ozon может сменить точку, тогда просто найдите новую." />
                </label>

                {form.dropOffWarehouseId ? (
                  <div className="mb-2 p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                    <div className="text-sm font-bold text-emerald-900">{form.dropOffWarehouseName || 'Без названия'}</div>
                    <div className="text-xs text-emerald-700 mt-0.5">
                      ID {form.dropOffWarehouseId} · {form.dropOffWarehouseType || 'тип не указан'}
                    </div>
                  </div>
                ) : (
                  <div className="mb-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs font-semibold text-amber-800">
                    Точка отгрузки не выбрана — оформить поставку не получится
                  </div>
                )}

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={dropOffQuery}
                    placeholder="Название точки, минимум 4 символа"
                    onChange={(e) => setDropOffQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleDropOffSearch(); } }}
                    className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm font-semibold text-slate-800 bg-slate-50/50"
                  />
                  <button
                    type="button"
                    onClick={handleDropOffSearch}
                    disabled={dropOffSearching}
                    className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white transition-colors flex items-center gap-1.5 text-sm font-bold"
                  >
                    <Search size={16} />
                    {dropOffSearching ? 'Ищу…' : 'Найти'}
                  </button>
                </div>

                {dropOffResults.length > 0 && (
                  <div className="mt-2 space-y-1.5 max-h-52 overflow-y-auto">
                    {dropOffResults.map((w) => {
                      const isActive = w.warehouseId === form.dropOffWarehouseId;
                      return (
                        <button
                          key={w.warehouseId}
                          type="button"
                          onClick={() =>
                            setForm({
                              ...form,
                              dropOffWarehouseId: w.warehouseId,
                              dropOffWarehouseName: w.name,
                              dropOffWarehouseType: w.warehouseType,
                            })
                          }
                          className={`w-full text-left p-3 rounded-xl border transition-colors ${
                            isActive
                              ? 'bg-indigo-50 border-indigo-300'
                              : 'bg-white border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            {isActive && <Check size={14} className="text-indigo-600 mt-0.5 shrink-0" />}
                            <div className="min-w-0">
                              <div className="text-sm font-bold text-slate-800 break-words">{w.name}</div>
                              <div className="text-xs text-slate-500 mt-0.5">{w.warehouseType}</div>
                              <div className="text-xs text-slate-400 mt-0.5 break-words">{w.address}</div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Приоритетные кластеры
                  <FieldHint
                    position="top"
                    text="Отметь кластеры, где наличие товара обязательно (обычно топ по продажам). Для них целевой и неснижаемый запас умножаются на коэффициент: при коэффициенте 1,5 и целевом запасе 30 дней приоритетный кластер получит 45 дней. Рекомендация к поставке загорается раньше и объём выше. Кластер без поставок приоритетным быть не может."
                  />
                </label>
                {clusters.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">
                    Кластеры появятся после первой загрузки остатков Ozon
                  </p>
                ) : (
                  <div className="space-y-2 mt-2">
                    {clusters.map((c) => {
                      const isPriority = priorityMap[c.clusterId] !== undefined;
                      const isExcluded = excludedSet.has(c.clusterId);
                      return (
                        <div key={c.clusterId} className="flex items-center justify-between gap-2">
                          <label className={`flex items-center gap-2.5 text-sm cursor-pointer select-none ${isExcluded ? 'text-slate-300 cursor-not-allowed' : 'text-slate-700 hover:text-slate-900'}`}>
                            <input
                              type="checkbox"
                              checked={isPriority}
                              disabled={isExcluded}
                              onChange={() => handleTogglePriority(c.clusterId)}
                              className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 accent-indigo-600 cursor-pointer disabled:cursor-not-allowed"
                            />
                            <span>{c.clusterName}</span>
                          </label>
                          {isPriority && (
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="text-[11px] text-slate-400">коэф.</span>
                              <input
                                type="number"
                                step="0.1"
                                min="1"
                                value={priorityMap[c.clusterId]}
                                onChange={(e) => handleChangePriorityK(c.clusterId, e.target.value)}
                                className="w-16 px-2 py-1 text-xs border border-slate-200 rounded-lg text-right focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300"
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="border-t border-slate-100" />

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Кластеры без поставок
                  <FieldHint
                    position="top"
                    text="Отметь кластеры, в которые ты НЕ возишь товар (дорогая доставка). Для них не будут считаться рекомендации поставок и неснижаемый запас. Остатки и продажи этих кластеров продолжают учитываться в общих итогах и в сигнале «пора заказать на фабрике»."
                  />
                </label>
                {clusters.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">
                    Кластеры появятся после первой загрузки остатков Ozon
                  </p>
                ) : (
                  <div className="space-y-2 mt-2">
                    {clusters.map((c) => {
                      const isChecked = excludedSet.has(c.clusterId);
                      return (
                        <label
                          key={c.clusterId}
                          className="flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer select-none hover:text-slate-900"
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => handleToggleCluster(c.clusterId)}
                            className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 accent-indigo-600 cursor-pointer"
                          />
                          <span>{c.clusterName}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="p-6 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-5 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-bold hover:bg-slate-100 transition-colors"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading}
            className="px-5 py-2.5 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-50"
          >
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  );
};
