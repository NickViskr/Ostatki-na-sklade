import React, { useState, useEffect, useMemo } from 'react';
import { X, HelpCircle, Search, Check, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { parseDirectClusters, type DirectClusterRule } from '../lib/ozonDirectSupply';
import {
  canEditOzonSettings,
  OZON_SETTINGS_BLOCKS,
  OZON_SETTINGS_FIELDS,
  OZON_SETTINGS_TEXT_HINTS,
  OZON_SETTINGS_AUTO_POLL_LINE,
  applyRecommended,
  buildOzonSettingsPayload,
  validateOzonSettingsForm,
  type OzonSettingsForm,
  type OzonSettingsFieldDef,
} from '../lib/ozonSettingsFields';

interface OzonSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Item 87 step 2. Which blocks are open by default; the rest start collapsed. */
  openBlocks?: string[];
  /** Item 87 step 3, test-only: seeds the form before the server fetch resolves — the display
   *  tests use it to render an invalid value without mocking `fetchGas`. */
  initialForm?: OzonSettingsForm;
}

const DEFAULT_FORM: OzonSettingsForm = {
  speedWeeks: 4,
  minStockDays: 7,
  targetStockDays: 30,
  deliveryToOzonDays: 7,
  maxClusterDays: 100,
  factoryOrderDays: 60,
  returnsToSalePct: 80,
  salesRetentionWeeks: 78,
  trendWeeks: 13,
  salesGrowthPct: 0,
  demandGrowthPct: 30,
  turnoverPeriodDays: 90,
  turnoverSlowDays: 45,
  turnoverFastDays: 20,
  gmroiGreenPct: 100,
  gmroiRedPct: 30,
  excludedClusters: '',
  priorityClusters: '',
  maxBoxesPerCluster: 30,
  dropOffWarehouseId: '',
  dropOffWarehouseName: '',
  dropOffWarehouseType: '',
  directClusters: '',
};

// Чтение числовой настройки Ozon с сервера. Не использовать `Number(value) || fallback` —
// ноль является законным значением настройки, а `||` считает его ложью и подменяет умолчанием.
const numSetting = (value: unknown, fallback: number): number => {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

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

const FIELDS_BY_BLOCK: Record<string, OzonSettingsFieldDef[]> = OZON_SETTINGS_FIELDS.reduce(
  (map, field) => {
    (map[field.block] ||= []).push(field);
    return map;
  },
  {} as Record<string, OzonSettingsFieldDef[]>
);

export const OzonSettingsModal: React.FC<OzonSettingsModalProps> = ({ isOpen, onClose, openBlocks, initialForm }) => {
  const fetchGas = useWarehouseStore((state) => state.fetchGas);
  const fetchOzonInitialData = useWarehouseStore((state) => state.fetchOzonInitialData);
  const ozonStocks = useWarehouseStore((state) => state.ozonStocks);
  const sessionToken = useWarehouseStore((state) => state.sessionToken);
  const devMode = useWarehouseStore((state) => state.devMode);
  const currentUser = useWarehouseStore((state) => state.currentUser);

  const canEdit = canEditOzonSettings(currentUser);

  const [openBlockIds, setOpenBlockIds] = useState<Set<string>>(new Set(openBlocks ?? []));
  const toggleBlock = (id: string) => {
    setOpenBlockIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const [dropOffQuery, setDropOffQuery] = useState('');
  const [dropOffResults, setDropOffResults] = useState<{ warehouseId: string; name: string; address: string; warehouseType: string }[]>([]);
  const [dropOffSearching, setDropOffSearching] = useState(false);

  // Пункт 58. Поиск склада прямой поставки идёт для ОДНОГО кластера за раз:
  // список складов у каждого кластера свой, и общий на всех сбивал бы с толку.
  const [directEditing, setDirectEditing] = useState<string>('');
  const [directQuery, setDirectQuery] = useState('');
  const [directResults, setDirectResults] = useState<{ warehouseId: string; name: string; address: string; warehouseType: string }[]>([]);
  const [directSearching, setDirectSearching] = useState(false);

  const [directory, setDirectory] = useState<{ clusterId: string; clusterName: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<OzonSettingsForm>(initialForm ?? DEFAULT_FORM);
  // Item 87 step 2. The values loaded from the server, kept aside to highlight anything the
  // user (or the «Вернуть к рекомендованным значениям» button) has changed since.
  const [loadedForm, setLoadedForm] = useState<OzonSettingsForm | null>(null);

  const isFieldChanged = (key: keyof OzonSettingsForm) => loadedForm !== null && form[key] !== loadedForm[key];

  // Item 87 step 3: the same rules the server enforces, checked BEFORE the save request leaves
  // the browser. Recomputed on every render — the form is small and validation is pure/cheap.
  const fieldErrors = useMemo(() => validateOzonSettingsForm(form), [form]);
  const fieldErrorByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const err of fieldErrors) map.set(err.key, err.message);
    return map;
  }, [fieldErrors]);
  const hasErrors = fieldErrors.length > 0;

  const handleNumericChange = (key: OzonSettingsFieldDef['key'], raw: string, integer?: boolean) => {
    const value = raw === '' ? 0 : integer ? parseInt(raw, 10) : parseFloat(raw);
    setForm((f) => ({ ...f, [key]: Number.isNaN(value) ? 0 : value }));
  };

  const handleApplyRecommended = () => {
    setForm((f) => applyRecommended(f));
    toast.success('Рекомендованные значения подставлены — проверьте и нажмите «Сохранить»');
  };

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

  /** Пункт 58. Правила прямой поставки в разобранном виде — настройка хранится строкой. */
  const directRules = useMemo(() => parseDirectClusters(form.directClusters), [form.directClusters]);

  const saveDirectRules = (rules: DirectClusterRule[]) => {
    setForm({ ...form, directClusters: rules.length === 0 ? '' : JSON.stringify(rules) });
  };

  const handleAddDirectCluster = (clusterId: string) => {
    const id = String(clusterId || '').trim();
    if (!id || directRules.some((r) => r.clusterId === id)) return;
    const cluster = clusters.find((c) => c.clusterId === id);
    saveDirectRules([
      ...directRules,
      { clusterId: id, clusterName: cluster?.clusterName || `Кластер ${id}`, warehouseId: '', warehouseName: '' }
    ]);
    setDirectEditing(id);
    setDirectQuery('');
    setDirectResults([]);
  };

  const handleRemoveDirectCluster = (clusterId: string) => {
    saveDirectRules(directRules.filter((r) => r.clusterId !== clusterId));
    if (directEditing === clusterId) {
      setDirectEditing('');
      setDirectResults([]);
    }
  };

  const handleDirectWarehousePick = (clusterId: string, warehouseId: string, warehouseName: string) => {
    saveDirectRules(directRules.map((r) => (r.clusterId === clusterId ? { ...r, warehouseId, warehouseName } : r)));
  };

  /** Ищет склады, на которые Ozon разрешает привезти груз самостоятельно. */
  const handleDirectSearch = async (clusterId: string) => {
    const query = directQuery.trim();
    if (query.length < 4) {
      toast.error('Введите минимум 4 символа названия склада');
      return;
    }
    setDirectSearching(true);
    try {
      const role = currentUser?.role?.toLowerCase() || '';
      const isAdminRole = role === 'admin' || role === 'администратор';
      const sendDevMode = devMode && isAdminRole;

      const res = await fetch('/api/ozon/dropoff/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken, search: query, supplyType: 'DIRECT', ...(sendDevMode ? { devMode: true } : {}) })
      });
      const result = await res.json();
      if (result.status === 'success' && Array.isArray(result.data?.warehouses)) {
        setDirectEditing(clusterId);
        setDirectResults(result.data.warehouses);
        if (result.data.warehouses.length === 0) {
          toast.error('Ozon не нашёл складов прямой поставки по этому названию');
        }
      } else {
        toast.error(result.message || 'Ошибка поиска склада прямой поставки');
      }
    } catch (e: any) {
      toast.error('Ошибка сети при поиске склада: ' + (e?.message || ''));
    } finally {
      setDirectSearching(false);
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
    // Item 87 step 2. A non-admin never sees this window — and must not trigger a fetch either.
    if (isOpen && canEdit) {
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
            const next: OzonSettingsForm = {
              // Счётчик недель, ноль бессмысленен — нижняя граница 1.
              speedWeeks: Math.max(1, numSetting(res.data.speedWeeks, 4)),
              minStockDays: numSetting(res.data.minStockDays, 7),
              targetStockDays: numSetting(res.data.targetStockDays, 30),
              deliveryToOzonDays: numSetting(res.data.deliveryToOzonDays, 7),
              maxClusterDays: numSetting(res.data.maxClusterDays, 100),
              factoryOrderDays: numSetting(res.data.factoryOrderDays, 60),
              returnsToSalePct: numSetting(res.data.returnsToSalePct, 80),
              // Счётчик недель, ноль бессмысленен — нижняя граница 1.
              salesRetentionWeeks: Math.max(1, numSetting(res.data.salesRetentionWeeks, 78)),
              // Счётчик недель, ноль бессмысленен — нижняя граница 1.
              trendWeeks: Math.max(1, numSetting(res.data.trendWeeks, 13)),
              salesGrowthPct: numSetting(res.data.salesGrowthPct, 0),
              demandGrowthPct: numSetting(res.data.demandGrowthPct, 30),
              turnoverPeriodDays: Math.max(1, numSetting(res.data.turnoverPeriodDays, 90)),
              turnoverSlowDays: numSetting(res.data.turnoverSlowDays, 45),
              turnoverFastDays: numSetting(res.data.turnoverFastDays, 20),
              gmroiGreenPct: numSetting(res.data.gmroiGreenPct, 100),
              gmroiRedPct: numSetting(res.data.gmroiRedPct, 30),
              excludedClusters: String(res.data.excludedClusters || ''),
              priorityClusters: String(res.data.priorityClusters || ''),
              // Счётчик коробок на кластер, ноль бессмысленен — нижняя граница 1.
              maxBoxesPerCluster: Math.max(1, numSetting(res.data.maxBoxesPerCluster, 30)),
              dropOffWarehouseId: String(res.data.dropOffWarehouseId || ''),
              dropOffWarehouseName: String(res.data.dropOffWarehouseName || ''),
              dropOffWarehouseType: String(res.data.dropOffWarehouseType || ''),
              directClusters: String(res.data.directClusters || ''),
            };
            setForm(next);
            setLoadedForm(next);
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
  }, [isOpen, canEdit, fetchGas]);

  if (!isOpen || !canEdit) return null;

  const handleSave = async () => {
    // Item 87 step 3: the Save button is already disabled while fieldErrors is non-empty — this
    // guard only covers a bypass (e.g. a stale click queued before the last keystroke re-ran
    // validation).
    if (hasErrors) {
      toast.error('Исправьте поля, отмеченные красным');
      return;
    }
    setSaving(true);
    try {
      const payload = buildOzonSettingsPayload(form);

      const res = await fetchGas('saveOzonSettings', { data: payload });
      if (res?.status === 'success') {
        toast.success('Настройки Ozon сохранены');
        // Item 26 stage A2: settings now live in the store and are no longer re-fetched when the
        // «Остатки Озон» tab mounts, so the saved values have to be pulled back explicitly —
        // otherwise the screen would keep calculating on the old ones until a full page reload.
        // The proxy drops its cached copy on saveOzonSettings, so this re-read returns fresh data.
        await fetchOzonInitialData();
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

  const renderNumericField = (field: OzonSettingsFieldDef) => {
    const errorMessage = fieldErrorByKey.get(field.key);
    return (
      <div key={field.key}>
        <label className="block text-xs font-bold text-slate-700 mb-1">
          {field.label}
          <FieldHint position="bottom" text={field.help} />
          {isFieldChanged(field.key) && (
            <span className="ml-2 text-[10px] font-bold text-amber-600 align-middle">изменено</span>
          )}
        </label>
        <input
          type="number"
          min={field.min}
          max={field.max}
          step={field.step}
          value={form[field.key]}
          onChange={(e) => handleNumericChange(field.key, e.target.value, field.integer)}
          className={`w-full px-4 py-2.5 rounded-xl border outline-none transition-all text-sm font-semibold text-slate-800 bg-slate-50/50 focus:ring-2 focus:ring-indigo-500 ${
            errorMessage
              ? 'border-red-400 ring-2 ring-red-100'
              : isFieldChanged(field.key)
              ? 'border-amber-300 ring-2 ring-amber-200'
              : 'border-slate-200'
          }`}
        />
        {errorMessage ? (
          <p className="text-xs text-red-600 font-semibold mt-1">{errorMessage}</p>
        ) : (
          <p className="text-xs text-slate-400 mt-1">{field.hint}</p>
        )}
      </div>
    );
  };

  const clustersEmptyHint = (
    <p className="text-xs text-slate-400 italic">
      Кластеры появятся после первой загрузки остатков Ozon
    </p>
  );

  const priorityClustersBlock = (
    <div>
      <label className="block text-xs font-bold text-slate-700 mb-1">
        Приоритетные кластеры
        <FieldHint
          position="top"
          text="Отметь кластеры, где наличие товара обязательно (обычно топ по продажам). Для них целевой и неснижаемый запас умножаются на коэффициент: при коэффициенте 1,5 и целевом запасе 30 дней приоритетный кластер получит 45 дней. Рекомендация к поставке загорается раньше и объём выше. Кластер без поставок приоритетным быть не может."
        />
      </label>
      {clusters.length === 0 ? (
        clustersEmptyHint
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
      <p className="text-xs text-slate-400 mt-1">{OZON_SETTINGS_TEXT_HINTS.priorityClusters}</p>
    </div>
  );

  const excludedClustersBlock = (
    <div>
      <label className="block text-xs font-bold text-slate-700 mb-1">
        Кластеры без поставок
        <FieldHint
          position="top"
          text="Отметь кластеры, в которые ты НЕ возишь товар (дорогая доставка). Для них не будут считаться рекомендации поставок и неснижаемый запас. Остатки и продажи этих кластеров продолжают учитываться в общих итогах и в сигнале «пора заказать на фабрике»."
        />
      </label>
      {clusters.length === 0 ? (
        clustersEmptyHint
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
      <p className="text-xs text-slate-400 mt-1">{OZON_SETTINGS_TEXT_HINTS.excludedClusters}</p>
    </div>
  );

  const dropOffBlock = (
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
      <p className="text-xs text-slate-400 mt-1">{OZON_SETTINGS_TEXT_HINTS.dropOff}</p>
    </div>
  );

  // Пункт 58. Прямая поставка: кластеры, на которые груз везётся своими силами
  // и сдаётся не на точку отгрузки, а прямо на склад размещения Ozon.
  const directSupplyBlock = (
    <div>
      <label className="block text-xs font-bold text-slate-700 mb-1">
        Прямая поставка — везу сам
        <FieldHint text="Кластеры, куда вы доставляете груз самостоятельно, минуя точку отгрузки. Такая заявка едет ОДНА: другие кластеры к ней не добавляются, потому что Ozon не принимает смешанные заявки. Для каждого кластера выберите склад, на который вы физически привозите коробки." />
      </label>

      {directRules.length === 0 ? (
        <p className="text-xs text-slate-400 italic mb-2">
          Прямых кластеров нет — все заявки идут через точку отгрузки
        </p>
      ) : (
        <div className="space-y-2 mb-2">
          {directRules.map((rule) => (
            <div key={rule.clusterId} className="p-3 rounded-xl border border-slate-200 bg-slate-50/50">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-bold text-slate-800 truncate">
                  {rule.clusterName || `Кластер ${rule.clusterId}`}
                  <span className="ml-1.5 text-xs font-semibold text-slate-400">ID {rule.clusterId}</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveDirectCluster(rule.clusterId)}
                  className="shrink-0 px-2.5 py-1 rounded-lg text-xs font-bold text-red-600 hover:bg-red-50 transition-colors"
                >
                  Убрать
                </button>
              </div>

              {rule.warehouseId ? (
                <div className="mt-2 p-2.5 rounded-lg bg-emerald-50 border border-emerald-200">
                  <div className="text-sm font-bold text-emerald-900 break-words">{rule.warehouseName || 'Без названия'}</div>
                  <div className="text-xs text-emerald-700 mt-0.5">ID {rule.warehouseId}</div>
                </div>
              ) : (
                <div className="mt-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs font-semibold text-amber-800">
                  Склад не выбран — заявку на этот кластер оформить не получится
                </div>
              )}

              <div className="flex gap-2 mt-2">
                <input
                  type="text"
                  value={directEditing === rule.clusterId ? directQuery : ''}
                  placeholder="Название склада, минимум 4 символа"
                  onFocus={() => { if (directEditing !== rule.clusterId) { setDirectEditing(rule.clusterId); setDirectQuery(''); setDirectResults([]); } }}
                  onChange={(e) => { setDirectEditing(rule.clusterId); setDirectQuery(e.target.value); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleDirectSearch(rule.clusterId); } }}
                  className="flex-1 px-3 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm font-semibold text-slate-800 bg-white"
                />
                <button
                  type="button"
                  onClick={() => handleDirectSearch(rule.clusterId)}
                  disabled={directSearching}
                  className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white transition-colors flex items-center gap-1.5 text-sm font-bold"
                >
                  <Search size={15} />
                  {directSearching && directEditing === rule.clusterId ? 'Ищу…' : 'Найти'}
                </button>
              </div>

              {directEditing === rule.clusterId && directResults.length > 0 && (
                <div className="mt-2 space-y-1.5 max-h-52 overflow-y-auto">
                  {directResults.map((w) => {
                    const isActive = w.warehouseId === rule.warehouseId;
                    return (
                      <button
                        key={w.warehouseId}
                        type="button"
                        onClick={() => handleDirectWarehousePick(rule.clusterId, w.warehouseId, w.name)}
                        className={`w-full text-left p-2.5 rounded-lg border transition-colors ${
                          isActive ? 'bg-indigo-50 border-indigo-300' : 'bg-white border-slate-200 hover:bg-slate-50'
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
          ))}
        </div>
      )}

      {clusters.length === 0 ? (
        clustersEmptyHint
      ) : (
        <select
          value=""
          onChange={(e) => handleAddDirectCluster(e.target.value)}
          className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm font-semibold text-slate-800 bg-slate-50/50"
        >
          <option value="">Добавить кластер прямой поставки…</option>
          {clusters
            .filter((c) => !directRules.some((r) => r.clusterId === c.clusterId))
            .map((c) => (
              <option key={c.clusterId} value={c.clusterId}>
                {c.clusterName}
              </option>
            ))}
        </select>
      )}
      <p className="text-xs text-slate-400 mt-1">{OZON_SETTINGS_TEXT_HINTS.direct}</p>
    </div>
  );

  const renderBlockBody = (blockId: string) => {
    const numericFields = (FIELDS_BY_BLOCK[blockId] || []).map(renderNumericField);
    if (blockId === 'speed') {
      return (
        <>
          {numericFields}
          <p className="text-xs text-slate-400 italic">{OZON_SETTINGS_AUTO_POLL_LINE}</p>
        </>
      );
    }
    if (blockId === 'clusters') {
      return (
        <>
          {priorityClustersBlock}
          <div className="border-t border-slate-100" />
          {excludedClustersBlock}
        </>
      );
    }
    if (blockId === 'dropoff') {
      return (
        <>
          {dropOffBlock}
          {directSupplyBlock}
        </>
      );
    }
    return numericFields;
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 fade-in">
      <div className="bg-white rounded-3xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh] modal-enter">
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

        <div className="p-6 overflow-y-auto flex-1 space-y-3">
          {loading ? (
            <div className="py-12 text-center text-slate-500 font-medium">
              Загрузка…
            </div>
          ) : (
            OZON_SETTINGS_BLOCKS.map((block) => {
              // Item 87 step 3: a block holding an invalid field is forced open, so the red
              // message is never hidden behind a collapsed header.
              const blockHasError = (FIELDS_BY_BLOCK[block.id] || []).some((f) => fieldErrorByKey.has(f.key));
              const isBlockOpen = openBlockIds.has(block.id) || blockHasError;
              return (
                <div key={block.id} className="border border-slate-200 rounded-2xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => toggleBlock(block.id)}
                    className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors"
                  >
                    <span className="text-sm font-bold text-slate-800">
                      {block.title}
                      {blockHasError && <span className="ml-1.5 text-red-600">●</span>}
                    </span>
                    {isBlockOpen ? <ChevronUp size={16} className="text-slate-500" /> : <ChevronDown size={16} className="text-slate-500" />}
                  </button>
                  {isBlockOpen && (
                    <div className="p-4 space-y-4 bg-white">
                      {renderBlockBody(block.id)}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="p-6 border-t border-slate-100 bg-slate-50/50 flex justify-between items-center gap-3">
          <button
            type="button"
            onClick={handleApplyRecommended}
            disabled={loading || saving}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-bold hover:bg-slate-100 transition-colors text-sm disabled:opacity-50"
          >
            <RotateCcw size={15} />
            Вернуть к рекомендованным значениям
          </button>
          <div className="flex items-center gap-3">
            {hasErrors && (
              <span className="text-xs font-semibold text-red-600">Исправьте поля, отмеченные красным</span>
            )}
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
              disabled={saving || loading || hasErrors}
              className="px-5 py-2.5 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-50"
            >
              {saving ? 'Сохранение…' : 'Сохранить'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
