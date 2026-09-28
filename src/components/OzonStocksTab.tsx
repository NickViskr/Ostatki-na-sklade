import React, { useMemo, useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { useUIStore } from '../store/useUIStore';
import { useChinaStore } from '../store/useChinaStore';
import { FactoryOrder, KitItem } from '../types';
import { chinaFactoryOrdersToForecastLines } from '../lib/chinaForecastView';
import { parseDirectClusters } from '../lib/ozonDirectSupply';
import { clampManualQty, manualKey } from '../lib/ozonManualSupply';
import { OzonCoverageResult, OzonCoverageSettings } from '../lib/ozonCoverage';
import { summarizeSettingsImpact, OzonSettingsImpact } from '../lib/ozonSettingsImpact';
import { buildCoverageSource, computeCoverage } from '../lib/ozonCoverageSource';
import { useOzonStocksTabModel } from './useOzonStocksTabModel';
import { OzonStocksHeader } from './OzonStocksHeader';
import { OzonStocksNotices } from './OzonStocksNotices';
import { OzonRecommendationsPanel } from './OzonRecommendationsPanel';
import { OzonCoverageTable } from './OzonCoverageTable';
import { OzonComponentsTable } from './OzonComponentsTable';
import { OzonStocksModals } from './OzonStocksModals';

const OZON_COLS_STORAGE_KEY = 'ozon_stocks_hidden_cols';
const OZON_DEFAULT_HIDDEN_COLS = ['preparing', 'requested', 'excess', 'other'];

/** The bit of `ozonClustersRaw` the «new clusters» notice reads — the store keeps the
 *  whole array untyped (`any[]`), this is only the shape used here. */
interface OzonClusterRawItem {
  notified: boolean;
  clusterId: string;
  clusterName: string;
}

export const OzonStocksTab: React.FC = React.memo(() => {
  const currentUser = useWarehouseStore((state) => state.currentUser);
  const isAdmin = currentUser?.role?.toLowerCase() === 'admin' || ['admin', 'админ', 'администратор'].includes(currentUser?.username?.toLowerCase() || '');

  const ozonStocks = useWarehouseStore((state) => state.ozonStocks);
  const ozonStocksSyncIssues = useWarehouseStore((state) => state.ozonStocksSyncIssues);
  const fetchOzonStocks = useWarehouseStore((state) => state.fetchOzonStocks);
  const runOzonStocksSync = useWarehouseStore((state) => state.runOzonStocksSync);
  const exportKanCost = useWarehouseStore((state) => state.exportKanCost);
  const fetchGas = useWarehouseStore((state) => state.fetchGas);
  const isProcessing = useWarehouseStore((state) => state.isProcessing);
  const ozonSales = useWarehouseStore((state) => state.ozonSales);
  const fetchOzonSales = useWarehouseStore((state) => state.fetchOzonSales);
  // Item 86, step D: history-aware sales speed. Absent/empty behaves exactly like before this item.
  const ozonStockHistory = useWarehouseStore((state) => state.ozonStockHistory);
  const skus = useWarehouseStore((state) => state.skus);
  const kits = useWarehouseStore((state) => state.kits);
  const getEffectiveAvailability = useWarehouseStore((state) => state.getEffectiveAvailability);
  const getEffectiveAvgCost = useWarehouseStore((state) => state.getEffectiveAvgCost);
  const lastPurchasePrices = useWarehouseStore((state) => state.lastPurchasePrices);
  const fetchLastPurchasePrices = useWarehouseStore((state) => state.fetchLastPurchasePrices);
  const rawStocks = useWarehouseStore((state) => state.stock);
  const factoryOrders = useWarehouseStore((state) => state.factoryOrders);
  const fetchFactoryOrders = useWarehouseStore((state) => state.fetchFactoryOrders);
  const externalShipments = useWarehouseStore((state) => state.externalShipments);
  const fetchExternalShipments = useWarehouseStore((state) => state.fetchExternalShipments);
  const ozonSupplyRequests = useWarehouseStore((state) => state.ozonSupplyRequests);
  const fetchOzonSupplyRequests = useWarehouseStore((state) => state.fetchOzonSupplyRequests);

  const [showSettings, setShowSettings] = useState(false);
  const [expandedArticles, setExpandedArticles] = useState<Record<string, boolean>>({});
  const [expandedClusters, setExpandedClusters] = useState<Record<string, boolean>>({});
  // Item 26 stage A2 (2026-08-20): настройки, справочник кластеров и признак их загрузки
  // берутся из хранилища. Раньше эта вкладка запрашивала getOzonSettings и getOzonClusters
  // заново, хотя главная страница уже получила ровно эти данные составным вызовом.
  const ozonSettings = useWarehouseStore((state) => state.ozonSettings);
  const supplySettings = useWarehouseStore((state) => state.ozonSupplySettings);
  const clusterRefs = useWarehouseStore((state) => state.ozonClusterRefs);
  const clustersRaw = useWarehouseStore((state) => state.ozonClustersRaw);
  const clusterRefsLoaded = useWarehouseStore((state) => state.ozonRefsLoaded);
  // Пункт 29, этап E: признак того, что ответ на запрос справочника
  // кластеров получен — успешно или с ошибкой, неважно. Пока ответа нет,
  // расчёт покрытия не запускается, иначе таблица рисуется без названий
  // кластеров и потом переписывается.
  const [selectedSupply, setSelectedSupply] = useState<Record<string, boolean>>({});
  const [supplySummaryOpen, setSupplySummaryOpen] = useState(false);

  const supplyKey = (article: string, clusterId: string) => `${article}|||${clusterId}`;

  // Пункт 58. Кластер прямой поставки едет ОДИН: смешанного черновика в Ozon не существует.
  // Поэтому галочки взаимоисключающие, и правило смотрит на ВЕСЬ выбор по всем артикулам,
  // а не на строку товара — иначе запрет обходился бы отметкой в соседней карточке.
  const directRules = useMemo(() => parseDirectClusters(supplySettings.directClusters), [supplySettings.directClusters]);

  // Item 88 ticket 04 follow-up: `selectedClusterIds` now comes from the tab model hook below
  // (buildSelectedClusterIds) — the same computation, moved out of the screen.

  const toggleSupplyRow = (article: string, clusterId: string) => {
    const key = supplyKey(article, clusterId);
    setSelectedSupply((prev) => {
      const next = { ...prev };
      if (next[key]) delete next[key];
      else next[key] = true;
      return next;
    });
  };

  const [cabinetFilter, setCabinetFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyWithRecommendations, setOnlyWithRecommendations] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [factoryModalArticle, setFactoryModalArticle] = useState<string | null>(null);
  const [pendingModalArticle, setPendingModalArticle] = useState<string | null>(null);
  const [showRecommendations, setShowRecommendations] = useState(false);
  /* ---- Пункт 63. Поставка, собранная руками по таблице остатков --------------------
   * Рекомендации отвечают на вопрос «где заканчивается товар». Вопрос «я хочу перевезти
   * вот это вот туда» они не решают, а он законный: владелец видит картину по кластерам
   * и распределяет остаток сам. Режим включается кнопкой и живёт ОТДЕЛЬНО от галочек в
   * «Рекомендациях» — решение владельца 27.08.2026, у каждого списка своя заявка.
   * Значение по ключу — текст поля количества: пустая строка это отмеченный кластер,
   * которому количество ещё не задали. */
  const [manualMode, setManualMode] = useState(false);
  const [manualQty, setManualQty] = useState<Record<string, string>>({});
  const [manualSummaryOpen, setManualSummaryOpen] = useState(false);

  const [showColsMenu, setShowColsMenu] = useState(false);
  const [hiddenCols, setHiddenCols] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(OZON_COLS_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error('Ошибка чтения настроек колонок Ozon:', e);
    }
    return OZON_DEFAULT_HIDDEN_COLS;
  });

  const toggleCol = (key: string) => {
    setHiddenCols((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      try {
        localStorage.setItem(OZON_COLS_STORAGE_KEY, JSON.stringify(next));
      } catch (e) {
        console.error('Ошибка сохранения настроек колонок Ozon:', e);
      }
      return next;
    });
  };

  const isColVisible = (key: string) => !hiddenCols.includes(key);

  const notifyCheckDone = useRef(false);

  // Пункт 29, этап D: отдельный эффект проверки новых кластеров удалён.
  // Он делал второй такой же запрос getOzonClusters при каждом открытии
  // вкладки. Проверка перенесена в эффект ниже, где кластеры уже грузятся.

  useEffect(() => {
    if (isAdmin) {
      fetchOzonStocks();
      fetchOzonSales();
      fetchFactoryOrders();
      fetchLastPurchasePrices();
      fetchExternalShipments();
      fetchOzonSupplyRequests();
    }
  }, [isAdmin, fetchOzonStocks, fetchOzonSales, fetchFactoryOrders, fetchLastPurchasePrices, fetchExternalShipments, fetchOzonSupplyRequests]);

  // Пункт 29, этап D: сообщение о новых кластерах Ozon.
  // Item 26 stage A2: справочник больше не запрашивается здесь — он уже в хранилище,
  // принесённый составным вызовом. Осталась только сама проверка флага «Уведомлён».
  useEffect(() => {
    if (!isAdmin) return;
    if (!clusterRefsLoaded || notifyCheckDone.current) return;
    notifyCheckDone.current = true;
    const unnotified = (clustersRaw as OzonClusterRawItem[]).filter((item) => item.notified === false);
    if (unnotified.length === 0) return;
    const names = unnotified
      .map((item) => {
        const cid = String(item.clusterId || '').trim();
        const cname = String(item.clusterName || '').trim();
        return cname || `Кластер ${cid}`;
      })
      .join(', ');
    toast.info(`Новые кластеры Ozon: ${names}`, { duration: 10000 });
    fetchGas('markOzonClustersNotified').catch((err) => console.error('markOzonClustersNotified error:', err));
  }, [isAdmin, clusterRefsLoaded, clustersRaw, fetchGas]);

  useEffect(() => {
    if (!showColsMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('#ozon-columns-menu') && !target.closest('#btn-ozon-columns')) {
        setShowColsMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showColsMenu]);

  useEffect(() => {
    if (!isFullscreen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFullscreen(false);
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isFullscreen]);

  const toggleArticle = (article: string) => {
    setExpandedArticles((prev) => ({ ...prev, [article]: !prev[article] }));
  };

  const toggleCluster = (key: string) => {
    setExpandedClusters((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Пункт 35. Цена единицы для колонки «Стоимость заказа, ₽».
  // Берётся цена последнего поступления на склад, а НЕ средняя себестоимость:
  // средняя искажена накопленной капитализацией и даёт цифры в сотни раз больше.
  // У виртуального комплекта цена складывается из цен компонентов по нормам.
  // Если поступлений не было, откатываемся на средняя себестоимость.
  const getOrderUnitCost = React.useCallback((article: string): { price: number; source: string } => {
    const virtualKit = kits.find((k: KitItem) => k.kitSku === article && k.type === 'virtual');
    if (virtualKit && Array.isArray(virtualKit.components) && virtualKit.components.length > 0) {
      let sum = 0;
      const parts: string[] = [];
      for (const comp of virtualKit.components) {
        const norm = Number(comp.quantity) || 0;
        const rec = lastPurchasePrices[comp.componentSku];
        const unit = rec && rec.price > 0 ? rec.price : 0;
        sum += unit * norm;
        parts.push(`${comp.componentSku} ${unit.toFixed(2)} ₽ × ${norm}`);
      }
      if (sum > 0) return { price: sum, source: 'по последним поступлениям компонентов: ' + parts.join(', ') };
      return { price: getEffectiveAvgCost(article), source: 'поступлений компонентов не было, взята средняя себестоимость' };
    }
    const rec = lastPurchasePrices[article];
    if (rec && rec.price > 0) return { price: rec.price, source: `по последнему поступлению ${rec.date}` };
    return { price: getEffectiveAvgCost(article), source: 'поступлений не было, взята средняя себестоимость' };
  }, [kits, lastPurchasePrices, getEffectiveAvgCost]);

  // Item 48. The list of shops for the drop-down is the ONLY thing here that must stay
  // unfiltered — a filter that hides its own options cannot be undone. Everything else on
  // the screen reads filteredOzonStocks, so it is declared first: the summary cards, the
  // shop badges and the freshness stamp all used to be computed from every shop at once,
  // and the four big numbers went on standing still while the table below them shrank.
  const ozonStocksCabinets = useMemo(() => {
    if (!ozonStocks || ozonStocks.length === 0) return [];
    return Array.from(new Set(ozonStocks.map(s => s.cabinet).filter(Boolean)));
  }, [ozonStocks]);

  // Item 88, ticket 03: one shared coverage source assembles everything below (cabinet-filtered
  // stocks/sales/stock history, the local pending reserve, the factory pipeline, availability
  // incl. kit components). The dashboard builds the same source with cabinet 'all'. `rawStocks`
  // stays a dep: `getEffectiveAvailability` reads the store's `stock` slice through a stable
  // function reference, so a stock change would not otherwise invalidate this memo.
  const coverageSource = useMemo(() => {
    const d = new Date();
    const todayIsoNow = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return buildCoverageSource(
      { ozonStocks, ozonSales, ozonStockHistory, skus, kits, clusterRefs, externalShipments, ozonSupplyRequests, factoryOrders, availabilityOf: getEffectiveAvailability },
      { cabinet: cabinetFilter, todayIso: todayIsoNow, waitForClusterRefs: true, clusterRefsLoaded }
    );
  }, [ozonStocks, ozonSales, ozonStockHistory, skus, kits, clusterRefs, externalShipments, ozonSupplyRequests, factoryOrders, getEffectiveAvailability, rawStocks, cabinetFilter, clusterRefsLoaded]);

  const filteredOzonStocks = coverageSource.stocks;

  const maxUpdatedAt = useMemo(() => {
    if (filteredOzonStocks.length === 0) return '';
    let max = '';
    for (const s of filteredOzonStocks) {
      if (s.updatedAt && s.updatedAt > max) {
        max = s.updatedAt;
      }
    }
    return max;
  }, [filteredOzonStocks]);

  const ozonTotals = useMemo(() => {
    let available = 0;
    let requested = 0;
    let transit = 0;
    let returns = 0;
    for (const s of filteredOzonStocks) {
      available += s.available || 0;
      requested += s.requested || 0;
      transit += s.transit || 0;
      returns += s.returns || 0;
    }
    return { available, requested, transit, returns };
  }, [filteredOzonStocks]);

  const uniqueCabinetsCount = useMemo(() => {
    const cabs = new Set(filteredOzonStocks.map(s => s.cabinet));
    return cabs.size;
  }, [filteredOzonStocks]);

  // Item 86, step D: same cabinet filter as stocks — history of a foreign cabinet must not tell
  // the speed of the selected one that it was in stock when it was not.
  const filteredOzonSales = coverageSource.sales;
  const filteredOzonStockHistory = coverageSource.stockHistory;

  // Локальный зачёт: товар из уже созданных заявок, который Ozon ещё не показал в «В заявках».
  // Фильтр по кабинету тот же, что у остатков и продаж, иначе заявки чужого кабинета
  // уменьшили бы потребность выбранного.
  const pendingSupplies = coverageSource.pending;

  // Названия кластеров по идентификатору — для расшифровки зачёта.
  const clusterNameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of clusterRefs) {
      const id = String(c.clusterId || '').trim();
      if (id) map[id] = String(c.clusterName || '').trim();
    }
    return map;
  }, [clusterRefs]);

  // Строки расшифровки зачёта по товару, открытому в модалке.
  const pendingModalRows = useMemo(() => {
    if (!pendingModalArticle) return [];
    return pendingSupplies.details
      .filter((d) => d.article === pendingModalArticle)
      .sort((a, b) => String(b.since || '').localeCompare(String(a.since || '')));
  }, [pendingModalArticle, pendingSupplies]);

  // Item 35/83/88 ticket 03: open factory orders — «ordered, not received» — now
  // built once inside coverageSource, shared with Dashboard.tsx. Item 83e/83d: the same call
  // also gives the hidden-manual notice and the «задерживается N дн» label of a late China row —
  // both used by the table below. `factoryOrdersByArticle`, `hiddenManualIds` and
  // `hiddenManualByArticle` (item 88 ticket 04) now come from the tab model hook below.
  const openFactoryOrders = coverageSource.openFactoryOrders;
  const factoryOnOrder = openFactoryOrders.qty;

  const resolveFactoryOrderConflict = useWarehouseStore((state) => state.resolveFactoryOrderConflict);
  const setConfirmDialog = useUIStore((state) => state.setConfirmDialog);
  const askResolveFactoryConflict = (order: FactoryOrder, same: boolean) => {
    setConfirmDialog({
      show: true,
      title: same ? 'Это тот же заказ?' : 'Это разные заказы?',
      message: same
        ? `Ручной заказ на ${order.qty} шт по артикулу ${order.article} закроется как дубликат заказа из Китая. Отменить это будет нельзя.`
        : `Ручной заказ на ${order.qty} шт по артикулу ${order.article} и заказ из Китая по этому же артикулу будут считаться РАЗНЫМИ и оба войдут в ТРУБУ.`,
      onConfirm: async () => {
        setConfirmDialog({ show: false, title: '', message: '', onConfirm: () => {} });
        await resolveFactoryOrderConflict(order.id, same);
      }
    });
  };

  /* ---- «Распределить весь остаток» ------------------------------------------------
   * Кластер попадает в распределение, только если у товара есть скорость продаж именно в
   * нём, а скорость считается за окно «Полных недель для скорости продаж» (обычно 4).
   * У товара, который кончился на Ozon, продажи прекратились везде, где остаток обнулился,
   * поэтому такие кластеры выпадают: спроса нет, потому что не было товара.
   * Кнопка пересчитывает распределение ЭТОГО товара по окну тренда (обычно 13 недель) —
   * тогда кластеры, продававшие до дефицита, возвращаются со своей долей.
   * Расчёт по широкому окну ленивый: пока ни один товар не переключён, он не запускается.
   */
  const wideArticles = useUIStore((state) => state.ozonWideArticles);
  const toggleWideArticle = useUIStore((state) => state.toggleOzonWideArticle);

  // Item 87 step 4, item 88 ticket 03: the ONE place that runs coverage over this screen's own
  // coverageSource — everything but `settings` is fixed. Used by the `coverage` memo below AND
  // handed to the settings modal as `computeImpact`, so its «было → станет» summary can never
  // disagree with what this screen itself shows for the same settings. `coverageSource.ready`
  // carries the old length/clusterRefsLoaded gate (item 29 stage E: wait for the cluster
  // reference).
  const runCoverage = React.useCallback((settings: OzonCoverageSettings): OzonCoverageResult | null => {
    return computeCoverage(coverageSource, settings);
  }, [coverageSource]);

  // Item 87 step 4. Recomputes coverage for arbitrary settings (the form in the settings modal,
  // merged over the store's ozonSettings) and folds it into the four «было → станет» figures.
  // Same `getOrderUnitCost` the table's «Стоимость заказа, ₽» column uses — no new price source.
  const computeSettingsImpact = React.useCallback((settings: OzonCoverageSettings): OzonSettingsImpact | null => {
    const result = runCoverage(settings);
    if (!result) return null;
    return summarizeSettingsImpact(result, (article) => getOrderUnitCost(article).price);
  }, [runCoverage, getOrderUnitCost]);

  const todayIso = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  // Item 88, ticket 04: every computed value the tab shows — coverage rows, component rows,
  // kit bottlenecks, visible rows, cluster shares, factory-order bookkeeping, the manual and
  // recommendation supply plans — now comes from the tab model, one stage per `useMemo` inside
  // the hook, same dependency granularity as the memos it replaces.
  const {
    coverage, wideCoverage, wideWeeks, coverageRows, componentRows, bottleneckByKit, visibleRows,
    clusterShares, factoryOrdersByArticle, activeFactoryOrders, hiddenManualIds,
    hiddenManualByArticle, factoryCellByArticle, factoryCellByComponent, factoryModalRow,
    offOzonFactoryOrders, cabinetsByArticleMap, selectedCabinetSets, selectedClusterIds,
    supplyStockOptions, supplyClusterRefs, manualPicks, manualClusterIds, manualCabinetSets,
    manualInfos, manualPlan, recommendations, supplyPlan,
  } = useOzonStocksTabModel({
    source: coverageSource,
    settings: ozonSettings,
    maxBoxesPerCluster: supplySettings.maxBoxesPerCluster,
    factoryOrders,
    wideArticles,
    selectedSupply,
    manualQty,
    searchQuery,
    onlyWithRecommendations,
    factoryModalArticle,
    todayIso,
  });

  const toggleManualPick = (article: string, clusterId: string) => {
    const key = manualKey(article, clusterId);
    setManualQty((prev) => {
      const next = { ...prev };
      if (next[key] !== undefined) delete next[key];
      else next[key] = '';
      return next;
    });
  };

  const changeManualQty = (article: string, clusterId: string, raw: string, freeMyStock: number) => {
    const key = manualKey(article, clusterId);
    // Пустое поле оставляем пустым: владелец стирает цифру, чтобы набрать новую.
    const value = raw === '' ? '' : String(clampManualQty(raw, freeMyStock, manualPicks, article, clusterId));
    setManualQty((prev) => ({ ...prev, [key]: value }));
  };

  const exitManualMode = () => {
    setManualMode(false);
    setManualQty({});
  };

  // Item 82: «Прогноз Китай» — the signal «Заказ на фабрике» sent straight to the forecast
  // calculator of the module «Заказы в Китае», admin only. Reads the stores directly instead of
  // subscribing, since this is a one-shot action, not something the render depends on.
  const goToChinaForecast = () => {
    const lines = chinaFactoryOrdersToForecastLines(recommendations.factories);
    useChinaStore.getState().setForecastPrefill(lines);
    useUIStore.getState().setActiveTab('china');
  };

  if (!isAdmin) return null;

  return (
    <div className="space-y-6 tab-enter">
      {/* Ozon Stocks Mirror Section */}
      <div className="space-y-4 bg-slate-50/50 p-6 rounded-3xl border border-slate-200/60 shadow-sm" id="ozon-stocks-mirror-section">
        <OzonStocksHeader
          maxUpdatedAt={maxUpdatedAt}
          manualMode={manualMode}
          setManualMode={setManualMode}
          exitManualMode={exitManualMode}
          onFullscreen={() => setIsFullscreen(true)}
          showColsMenu={showColsMenu}
          onToggleColsMenu={() => setShowColsMenu((prev) => !prev)}
          isColVisible={isColVisible}
          onToggleCol={toggleCol}
          currentUser={currentUser}
          onOpenSettings={() => setShowSettings(true)}
          isProcessing={isProcessing}
          onExportKanCost={exportKanCost}
          onRefresh={runOzonStocksSync}
        />

        <div className="space-y-4" id="ozon-stocks-content">
            <OzonStocksNotices
              ozonStocksSyncIssues={ozonStocksSyncIssues}
              ozonStocksCabinets={ozonStocksCabinets}
              cabinetFilter={cabinetFilter}
              ozonTotals={ozonTotals}
            />

            <OzonRecommendationsPanel
              recommendations={recommendations}
              showRecommendations={showRecommendations}
              onToggleShowRecommendations={() => setShowRecommendations((v) => !v)}
              supplyPlan={supplyPlan}
              supplySettings={supplySettings}
              onClearSupplySelection={() => setSelectedSupply({})}
              onOpenSupplySummary={() => setSupplySummaryOpen(true)}
              selectedSupply={selectedSupply}
              onToggleSupplyRow={toggleSupplyRow}
              directRules={directRules}
              selectedClusterIds={selectedClusterIds}
              selectedCabinetSets={selectedCabinetSets}
              cabinetsByArticleMap={cabinetsByArticleMap}
              wideWeeks={wideWeeks}
              speedWeeks={ozonSettings.speedWeeks}
              onToggleWideArticle={toggleWideArticle}
              isAdmin={isAdmin}
              onGoToChinaForecast={goToChinaForecast}
              setFactoryModalArticle={setFactoryModalArticle}
            />

            <OzonCoverageTable
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              ozonStocksCabinets={ozonStocksCabinets}
              cabinetFilter={cabinetFilter}
              onCabinetChange={setCabinetFilter}
              onlyWithRecommendations={onlyWithRecommendations}
              onOnlyWithRecommendationsChange={setOnlyWithRecommendations}
              visibleRows={visibleRows}
              coverageRowsCount={coverageRows.length}
              manualMode={manualMode}
              manualPlan={manualPlan}
              supplySettings={supplySettings}
              onOpenManualSummary={() => setManualSummaryOpen(true)}
              isFullscreen={isFullscreen}
              onExitFullscreen={() => setIsFullscreen(false)}
              isColVisible={isColVisible}
              expandedArticles={expandedArticles}
              onToggleArticle={toggleArticle}
              expandedClusters={expandedClusters}
              onToggleCluster={toggleCluster}
              uniqueCabinetsCount={uniqueCabinetsCount}
              manualPicks={manualPicks}
              manualQty={manualQty}
              toggleManualPick={toggleManualPick}
              changeManualQty={changeManualQty}
              directRules={directRules}
              manualClusterIds={manualClusterIds}
              manualCabinetSets={manualCabinetSets}
              supplyClusterRefs={supplyClusterRefs}
              clusterShares={clusterShares}
              factoryOrdersByArticle={factoryOrdersByArticle}
              hiddenManualByArticle={hiddenManualByArticle}
              factoryCellByArticle={factoryCellByArticle}
              factoryLateById={openFactoryOrders.late}
              bottleneckByKit={bottleneckByKit}
              ozonSettings={ozonSettings}
              unboundInFlightByArticle={pendingSupplies.unboundInFlightByArticle}
              getOrderUnitCost={getOrderUnitCost}
              setFactoryModalArticle={setFactoryModalArticle}
              setPendingModalArticle={setPendingModalArticle}
              onResolveFactoryConflict={askResolveFactoryConflict}
            />

            <OzonComponentsTable
              offOzonFactoryOrders={offOzonFactoryOrders}
              componentRows={componentRows}
              factoryCellByComponent={factoryCellByComponent}
              factoryLateById={openFactoryOrders.late}
              ozonSettings={ozonSettings}
              clusterShares={clusterShares}
              setFactoryModalArticle={setFactoryModalArticle}
            />
          </div>
      </div>
      <OzonStocksModals
        showSettings={showSettings}
        onCloseSettings={() => setShowSettings(false)}
        computeSettingsImpact={computeSettingsImpact}
        supplySummaryOpen={supplySummaryOpen}
        onCloseSupplySummary={() => setSupplySummaryOpen(false)}
        supplyPlan={supplyPlan}
        supplyStockOptions={supplyStockOptions}
        selectedCabinetSets={selectedCabinetSets}
        cabinetFilter={cabinetFilter}
        clusterShares={clusterShares}
        supplySettings={supplySettings}
        setSelectedSupply={setSelectedSupply}
        exitManualMode={exitManualMode}
        manualSummaryOpen={manualSummaryOpen}
        onCloseManualSummary={() => setManualSummaryOpen(false)}
        manualPlan={manualPlan}
        manualCabinetSets={manualCabinetSets}
        setManualSummaryOpen={setManualSummaryOpen}
        factoryModalArticle={factoryModalArticle}
        onCloseFactoryModal={() => setFactoryModalArticle(null)}
        factoryModalRow={factoryModalRow}
        activeFactoryOrders={activeFactoryOrders}
        factoryOrdersByArticle={factoryOrdersByArticle}
        hiddenManualByArticle={hiddenManualByArticle}
        onResolveFactoryConflict={askResolveFactoryConflict}
        pendingModalArticle={pendingModalArticle}
        onClosePendingModal={() => setPendingModalArticle(null)}
        pendingModalRows={pendingModalRows}
        clusterNameById={clusterNameById}
      />
    </div>
  );
});
