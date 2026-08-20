import React, { useState, useMemo, useEffect, useRef } from 'react';
import { buildCargoPlan, buildBoxesPayload } from '../lib/ozonCargo';
import { X, AlertTriangle, Send, Trash2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { resolveOzonArticle } from '../lib/ozonCoverage';
import { capForSupplyLine } from '../lib/ozonSupplyLines';

export interface SupplyPlanRow {
  article: string;
  name: string;
  clusterId: string;
  clusterName: string;
  boxes: number;
  qty: number;
  limitedByMyStock: boolean;
}

/** Item 45. One addable article: what it is called and how much of it is free to ship.
 *  freeMyStock is stock on «Мой склад» MINUS the reserve held by supplies already created,
 *  which is why it can be smaller than what the warehouse physically holds. */
export interface SupplyStockOption {
  article: string;
  name: string;
  freeMyStock: number;
}

interface OzonSupplyModalProps {
  isOpen: boolean;
  onClose: () => void;
  rows: SupplyPlanRow[];
  stockOptions: SupplyStockOption[];
  cabinet: string;
  dropOffWarehouseId: string;
  dropOffWarehouseName: string;
  dropOffWarehouseType: string;
  onCreated: () => void;
}

const REQUEST_TIMEOUT_SEC = 60;
const FINALIZE_TIMEOUT_SEC = 180; // достройка идёт по каждому кластеру, минуты не хватает

export const OzonSupplyModal: React.FC<OzonSupplyModalProps> = ({
  isOpen, onClose, rows, stockOptions, cabinet, dropOffWarehouseId, dropOffWarehouseName, dropOffWarehouseType, onCreated
}) => {
  const skus = useWarehouseStore((state) => state.skus);
  const ozonStocks = useWarehouseStore((state) => state.ozonStocks);
  const sessionToken = useWarehouseStore((state) => state.sessionToken);
  const devMode = useWarehouseStore((state) => state.devMode);
  const currentUser = useWarehouseStore((state) => state.currentUser);
  const fetchGas = useWarehouseStore((state) => state.fetchGas);
  const ozonClusterRefs = useWarehouseStore((state) => state.ozonClusterRefs);

  const [sending, setSending] = useState(false);
  const [qtyEdit, setQtyEdit] = useState<Record<string, number>>({});
  const [removedRows, setRemovedRows] = useState<Record<string, boolean>>({});
  // Item 45. Lines the user added by hand. They live beside the recommended ones and go
  // through exactly the same path afterwards — payload, availability check, itemsJSON —
  // so the reserve on «Мой склад» is built for them the same way.
  const [addedRows, setAddedRows] = useState<SupplyPlanRow[]>([]);
  const [addForm, setAddForm] = useState<{ clusterId: string; article: string; qty: string }>({ clusterId: '', article: '', qty: '' });
  const [draftId, setDraftId] = useState('');
  const [verdict, setVerdict] = useState<any>(null);
  const [dirty, setDirty] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(REQUEST_TIMEOUT_SEC);
  const [timedOut, setTimedOut] = useState(false);
  const [progressText, setProgressText] = useState('');

  const abortRef = useRef<AbortController | null>(null);

  const rowKey = (r: SupplyPlanRow) => `${r.article}|||${r.clusterId}`;

  // Сброс состояния при каждом открытии
  useEffect(() => {
    if (isOpen) {
      setSending(false);
      setQtyEdit({});
      setRemovedRows({});
      setAddedRows([]);
      setAddForm({ clusterId: '', article: '', qty: '' });
      setDraftId('');
      setVerdict(null);
      setDirty(false);
      setSecondsLeft(REQUEST_TIMEOUT_SEC);
      setTimedOut(false);
      setProgressText('');
    }
  }, [isOpen]);

  // Обратный отсчёт во время работы с Ozon
  useEffect(() => {
    if (!sending || progressText) return;
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
  }, [sending, progressText]);

  const getQty = (r: SupplyPlanRow) => {
    const v = qtyEdit[rowKey(r)];
    return v === undefined ? r.qty : v;
  };

  /** Recommended lines plus the hand-added ones. Everything downstream reads activeRows,
   *  so a hand-added line needs no special case anywhere else. */
  const allRows = useMemo(() => [...rows, ...addedRows], [rows, addedRows]);

  const activeRows = useMemo(
    () => allRows.filter((r) => !removedRows[rowKey(r)]),
    [allRows, removedRows]
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

  /** Сколько единиц товара помещается в одну коробку, из SKU Базы */
  const pcsPerBoxMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const s of skus) {
      const n = Number(s.pcsPerBox) || 0;
      if (n > 0) map[s.sku] = n;
    }
    return map;
  }, [skus]);

  /** Разбор количества на коробки: сколько полных и сколько остаётся в неполной */
  const boxInfo = (r: SupplyPlanRow) => {
    const perBox = pcsPerBoxMap[r.article] || 0;
    const qty = getQty(r);
    if (perBox <= 0) {
      return { perBox: 0, fullBoxes: 0, remainder: 0, isPartial: false, totalBoxes: 0 };
    }
    const fullBoxes = Math.floor(qty / perBox);
    const remainder = qty % perBox;
    return {
      perBox,
      fullBoxes,
      remainder,
      isPartial: remainder > 0,
      totalBoxes: fullBoxes + (remainder > 0 ? 1 : 0)
    };
  };

  /**
   * Разбор на коробки для позиции из ответа Ozon.
   * Артикул приложения восстанавливается по offerId и Ozon-SKU через resolveOzonArticle,
   * норма упаковки берётся из SKU Базы.
   */
  const boxInfoForOzonItem = (it: any) => {
    const article = resolveOzonArticle(skus, String(it?.offerId || ''), String(it?.sku || ''));
    const perBox = pcsPerBoxMap[article] || 0;
    const qty = Number(it?.quantity) || 0;
    if (perBox <= 0) {
      return { perBox: 0, fullBoxes: 0, remainder: 0, isPartial: false, totalBoxes: 0 };
    }
    const fullBoxes = Math.floor(qty / perBox);
    const remainder = qty % perBox;
    return {
      perBox,
      fullBoxes,
      remainder,
      isPartial: remainder > 0,
      totalBoxes: fullBoxes + (remainder > 0 ? 1 : 0)
    };
  };

  const partialBoxRows = useMemo(
    () => activeRows.filter((r) => boxInfo(r).isPartial),
    [activeRows, qtyEdit, pcsPerBoxMap]
  );

  const noBoxNormRows = useMemo(
    () => Array.from(new Set(activeRows.filter((r) => !pcsPerBoxMap[r.article]).map((r) => r.article))),
    [activeRows, pcsPerBoxMap]
  );

  const totals = useMemo(() => {
    let qty = 0;
    for (const r of activeRows) qty += getQty(r);
    const clusters = new Set(activeRows.map((r) => r.clusterId));
    return { qty, rows: activeRows.length, clusters: clusters.size };
  }, [activeRows, qtyEdit]);

  /* ---- Item 45. Free stock on «Мой склад» ---------------------------------------
   * The owner's rule: a line may not ask for more than is actually free to ship, and the
   * screen must say how much that is. «Free» is stock minus the reserve already held by
   * created supplies — the warehouse can hold more than the figure shown.
   * One article can sit in several clusters of the same supply, so the ceiling for a line
   * is the free stock LESS what the other lines of the same article already take.
   */
  const freeByArticle = useMemo(() => {
    const map: Record<string, number> = {};
    for (const o of stockOptions || []) map[o.article] = Math.max(0, Number(o.freeMyStock) || 0);
    return map;
  }, [stockOptions]);

  const nameByArticle = useMemo(() => {
    const map: Record<string, string> = {};
    for (const o of stockOptions || []) map[o.article] = o.name || '';
    return map;
  }, [stockOptions]);

  /** true when we simply have no stock figure for this article — then nothing is capped. */
  const hasFreeFigure = (article: string) => Object.prototype.hasOwnProperty.call(freeByArticle, article);

  /** Ceiling for one line, in pieces. The arithmetic lives in src/lib/ozonSupplyLines.ts. */
  const capForRow = (article: string, exceptKey: string) =>
    capForSupplyLine(
      freeByArticle,
      activeRows.map((r) => ({ article: r.article, clusterId: r.clusterId, qty: getQty(r) })),
      article,
      exceptKey
    );

  if (!isOpen) return null;

  const markDirty = () => {
    if (verdict) setDirty(true);
  };

  const changeQty = (r: SupplyPlanRow, value: string) => {
    const raw = value === '' ? 0 : parseInt(value, 10);
    const asked = isNaN(raw) || raw < 0 ? 0 : raw;
    // Item 45. Hard ceiling, owner's decision 20.08.2026: a line may not ask for more than
    // is free to ship. The recommendation itself never exceeds it, so the clamp only ever
    // catches a hand-made increase.
    const cap = capForRow(r.article, rowKey(r));
    const next = Math.min(asked, cap);
    if (next < asked) {
      toast.error(`${r.article}: свободно для отгрузки ${cap} шт, больше поставить нельзя`);
    }
    setQtyEdit({ ...qtyEdit, [rowKey(r)]: next });
    markDirty();
  };

  const removeRow = (r: SupplyPlanRow) => {
    setRemovedRows({ ...removedRows, [rowKey(r)]: true });
    markDirty();
  };

  const removeCluster = (clusterId: string) => {
    const next = { ...removedRows };
    for (const r of allRows) {
      if (r.clusterId === clusterId) next[rowKey(r)] = true;
    }
    setRemovedRows(next);
    markDirty();
  };

  /* ---- Item 45. Adding a cluster or an article by hand ---------------------------- */

  /** Clusters offered in the picker: the whole reference list, current ones first. */
  const clusterOptions = useMemo(() => {
    const used = new Set(activeRows.map((r) => r.clusterId));
    const refs = (ozonClusterRefs || []).filter((c) => c.clusterId);
    return [...refs].sort((a, b) => {
      const ua = used.has(a.clusterId) ? 0 : 1;
      const ub = used.has(b.clusterId) ? 0 : 1;
      if (ua !== ub) return ua - ub;
      return a.clusterName.localeCompare(b.clusterName, 'ru');
    });
  }, [ozonClusterRefs, activeRows]);

  /** Articles that can still be put into the chosen cluster: an Ozon SKU is required,
   *  otherwise the line cannot be sent at all, and the pair must not already be in the
   *  supply — rowKey is article|||clusterId and a duplicate would collide. */
  const articleOptions = useMemo(() => {
    if (!addForm.clusterId) return [];
    const taken = new Set(allRows.filter((r) => r.clusterId === addForm.clusterId).map((r) => r.article));
    return (stockOptions || [])
      .filter((o) => skuMap[o.article] && !taken.has(o.article))
      .sort((a, b) => a.article.localeCompare(b.article, 'ru'));
  }, [addForm.clusterId, stockOptions, skuMap, allRows]);

  const addFormCap = addForm.article ? capForRow(addForm.article, '') : 0;

  const addLine = () => {
    const cluster = clusterOptions.find((c) => c.clusterId === addForm.clusterId);
    if (!cluster) {
      toast.error('Выберите кластер');
      return;
    }
    if (!addForm.article) {
      toast.error('Выберите товар');
      return;
    }
    const asked = parseInt(addForm.qty, 10);
    if (!(asked > 0)) {
      toast.error('Укажите количество больше нуля');
      return;
    }
    if (asked > addFormCap) {
      toast.error(`${addForm.article}: свободно для отгрузки ${addFormCap} шт`);
      return;
    }
    const key = `${addForm.article}|||${addForm.clusterId}`;
    if (allRows.some((r) => rowKey(r) === key)) {
      toast.error('Такой товар уже есть в этом кластере — измените количество в строке');
      return;
    }
    const perBox = pcsPerBoxMap[addForm.article] || 0;
    setAddedRows([
      ...addedRows,
      {
        article: addForm.article,
        name: nameByArticle[addForm.article] || '',
        clusterId: cluster.clusterId,
        clusterName: cluster.clusterName,
        boxes: perBox > 0 ? Math.ceil(asked / perBox) : 0,
        qty: asked,
        limitedByMyStock: false
      }
    ]);
    setAddForm({ clusterId: addForm.clusterId, article: '', qty: '' });
    markDirty();
  };

  const restoreRows = () => {
    setRemovedRows({});
    markDirty();
  };

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
  const fetchWithTimeout = async (url: string, body: string, timeoutSec: number = REQUEST_TIMEOUT_SEC) => {
    const controller = new AbortController();
    abortRef.current = controller;
    const timer = setTimeout(() => controller.abort(), timeoutSec * 1000);
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
    if (sending && !timedOut) {
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

  /**
   * Автоматическая достройка заявки после её создания: грузоместа, этикетки,
   * файлы состава и папка документов на Google Диске. Дополнительных кнопок нет.
   * Раскладка считается по составу, который подтвердил пользователь, то есть по
   * accepted из вердикта Ozon, а не по исходному плану.
   */
  const finalizeSupply = async (orderId: string, verdictData: any) => {
    const clustersOut: any[] = [];
    const zones: Record<string, string> = {};
    const articleSet: Record<string, boolean> = {};

    for (const c of (verdictData?.clusters || [])) {
      const accepted = Array.isArray(c?.accepted) ? c.accepted : [];
      const items = accepted.map((it: any) => ({
        offerId: String(it?.offerId || ''),
        barcode: String(it?.barcode || ''),
        quantity: Number(it?.quantity) || 0
      }));
      for (const it of accepted) {
        const bc = String(it?.barcode || '');
        if (bc) zones[bc] = String(it?.placementZone || '');
      }
      const plan = buildCargoPlan(items, skus);
      for (const b of plan.boxes) articleSet[b.article] = true;
      clustersOut.push({
        clusterId: String(c?.clusterId || ''),
        clusterName: String(c?.clusterName || ''),
        boxes: buildBoxesPayload(plan)
      });
    }

    setProgressText('Создаю грузоместа и этикетки в Ozon…');

    let fin: any;
    try {
      fin = await fetchWithTimeout('/api/ozon/supply/finalize', proxyBody({
        cabinet,
        orderId,
        clusters: clustersOut,
        zones
      }), FINALIZE_TIMEOUT_SEC);
    } catch (e: any) {
      const reason = e?.name === 'AbortError' ? 'Ozon не ответил вовремя' : (e?.message || 'ошибка сети');
      toast.error('Заявка создана, но грузоместа не отправлены: ' + reason + '. Заполните их в Ozon Seller.');
      return;
    }

    if (fin?.status !== 'success') {
      toast.error('Заявка создана, но грузоместа не отправлены: ' + (fin?.message || 'ошибка прокси') + '. Заполните их в Ozon Seller.');
      return;
    }

    const warnings: string[] = Array.isArray(fin.data?.warnings) ? fin.data.warnings : [];

    setProgressText('Складываю файлы на Google Диск…');

    try {
      const gas = await fetchGas('saveSupplyDocsToDrive', {
        data: {
          folderName: String(fin.data?.folderName || ''),
          files: Array.isArray(fin.data?.files) ? fin.data.files : [],
          articles: Object.keys(articleSet)
        }
      });
      const res = gas?.data || gas;
      const problems: string[] = Array.isArray(res?.problems) ? res.problems : [];
      const missing: string[] = Array.isArray(res?.missingLabels) ? res.missingLabels : [];

      toast.success('Папка «' + String(res?.folderName || '') + '» собрана на Google Диске');

      // Предупреждения показываем ПОСЛЕ успеха и держим дольше: иначе зелёный тост
      // накрывает их сверху и пользователь ничего не замечает
      const allWarnings: string[] = warnings.concat(problems);
      if (missing.length > 0) {
        allWarnings.push('Нет этикеток ШК для: ' + missing.join(', ') + '. Положите их в папку-библиотеку на Google Диске.');
      }
      allWarnings.forEach((w, i) => {
        setTimeout(() => toast.error(w, { duration: 15000 }), 400 * (i + 1));
      });
    } catch (e: any) {
      for (const w of warnings) toast.error(w, { duration: 15000 });
      toast.error('Файлы не сложены на Диск: ' + (e?.message || 'ошибка') + '. Скачайте их из Ozon Seller вручную.', { duration: 15000 });
    }
  };

  const sendOrder = async (useDraftId: string, clusterIds: string[], verdictData: any) => {
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
      setSending(false);
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
      setSending(false);
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

    toast.success('Заявка создана в Ozon. Номер: ' + orderId);
    await finalizeSupply(orderId, verdictData);
    setProgressText('');
    onCreated();
    onClose();
  };

  /**
   * Расчёт черновика.
   * autoCreate = true только при первом нажатии: если Ozon принял всё полностью,
   * заявка создаётся сразу. После любой правки состава пересчёт заявку не создаёт.
   */
  const runDraft = async (autoCreate: boolean) => {
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

    setSending(true);

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
      setSending(false);
      return;
    }

    if (result.status !== 'success') {
      toast.error(result.message || 'Ozon не рассчитал черновик');
      setSending(false);
      return;
    }

    const data = result.data;
    setDraftId(String(data.draftId || ''));
    setVerdict(data);
    setDirty(false);

    const hasRejected = Array.isArray(data.rejectedItems) && data.rejectedItems.length > 0;
    const hasBadCluster = (data.clusters || []).some((c: any) => c.state !== 'FULL_AVAILABLE');
    const hasRestricted = (data.clusters || []).some((c: any) => (c.rejected || []).length > 0);
    const clusterIds = (data.clusters || []).map((c: any) => String(c.clusterId));

    if (!autoCreate || hasRejected || hasBadCluster || hasRestricted) {
      setSending(false);
      if (hasRejected || hasBadCluster || hasRestricted) {
        toast.error('Ozon принял заявку не полностью — проверьте состав');
      } else {
        toast.success('Ozon подтвердил состав полностью');
      }
      return;
    }

    await sendOrder(String(data.draftId || ''), clusterIds, data);
  };

  const handlePrimary = async () => {
    if (noBoxNormRows.length > 0) {
      toast.error('Не задано количество в коробке для артикулов: ' + noBoxNormRows.join(', ') + '. Заполните «Штук в коробке» в SKU Базе — без этого грузоместа не разложить.');
      return;
    }
    if (!verdict) {
      await runDraft(true);
      return;
    }
    if (dirty) {
      await runDraft(false);
      return;
    }
    setSending(true);
    const clusterIds = (verdict.clusters || []).map((c: any) => String(c.clusterId));
    await sendOrder(draftId, clusterIds, verdict);
  };

  const primaryLabel = !verdict ? 'Оформить заявку в Ozon' : dirty ? 'Пересчитать в Ozon' : 'Создать заявку в этом составе';
  const primaryIsSafe = Boolean(verdict) && dirty;

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
          {sending ? (
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
                  {progressText ? (
                    <>
                      <div className="text-sm font-bold text-indigo-700">Заявка создана. Достраиваю поставку…</div>
                      <div className="text-xs text-slate-500">{progressText}</div>
                      <div className="text-xs text-slate-400">Не закрывайте окно</div>
                    </>
                  ) : null}
                  <div className="text-slate-500 font-medium">Работаем с Ozon…</div>
                  <div className="text-3xl font-bold text-indigo-600 tabular-nums">{secondsLeft}</div>
                  <div className="text-xs text-slate-400">секунд до истечения ожидания</div>
                </div>
              )}
            </div>
          ) : (
            <>
              {missingSku.length > 0 && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs font-semibold text-red-800">
                  Не удалось определить Ozon-SKU: {missingSku.join(', ')}. SKU берётся из зеркала «Остатки Ozon», запасной источник — колонка «ШК Ozon» в SKU Базе.
                </div>
              )}

              {verdict && dirty && (
                <div className="p-3 rounded-xl bg-indigo-50 border border-indigo-200 text-xs font-semibold text-indigo-900">
                  Состав изменён после расчёта. Нажмите «Пересчитать в Ozon» — заявка при этом НЕ создаётся.
                </div>
              )}

              {verdict && !dirty && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 flex gap-2">
                  <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                  <div className="text-xs font-semibold text-amber-900">
                    Ниже — ответ Ozon. Заявка ещё НЕ создана. Можно уменьшить количество или убрать кластер прямо здесь,
                    тогда потребуется пересчёт. Либо создать заявку в подтверждённом составе.
                  </div>
                </div>
              )}

              {verdict && (
                <div className="space-y-2">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Ответ Ozon</div>
                  {(verdict.clusters || []).map((c: any) => {
                    const stillSelected = activeRows.some((r) => r.clusterId === String(c.clusterId));
                    return (
                      <div key={c.clusterId} className={`p-3 rounded-xl border ${stillSelected ? 'border-slate-200' : 'border-slate-100 opacity-50'}`}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-bold text-sm text-slate-800">
                            {c.clusterName || c.clusterId}
                            {!stillSelected && <span className="ml-2 text-[11px] font-semibold text-slate-400">убран из заявки</span>}
                          </div>
                          <div className={`text-[11px] font-bold ${c.state === 'FULL_AVAILABLE' ? 'text-emerald-600' : c.state === 'PARTIAL_AVAILABLE' ? 'text-amber-600' : 'text-red-600'}`}>
                            {c.state === 'FULL_AVAILABLE'
                              ? 'принято'
                              : c.state === 'PARTIAL_AVAILABLE'
                                ? 'принято частично'
                                : c.state === 'NOT_AVAILABLE'
                                  ? 'кластер не принимает'
                                  : 'статус не определён'}
                            {c.invalidReason === 'NOT_AVAILABLE_MATRIX' && ' · склад не принимает такие товары'}
                            {c.invalidReason === 'NOT_AVAILABLE_RANK' && ' · склад недоступен по рейтингу'}
                            {c.invalidReason === 'NOT_AVAILABLE_ROUTE' && ' · нет маршрута'}
                            {c.invalidReason === 'PARTIAL_MATRIX_AVAILABLE' && ' · примет только часть товаров'}
                            {String(c.invalidReason || '').indexOf('TIMESLOT') >= 0 && ' · нет свободных слотов'}
                          </div>
                        </div>
                        {(c.accepted || []).length > 0 && (
                          <div className="mt-2">
                            <div className="text-[11px] font-bold uppercase text-slate-400">Войдёт в поставку</div>
                            {c.accepted.map((it: any, i: number) => {
                              const b = boxInfoForOzonItem(it);
                              return (
                                <div key={`a${i}`} className="text-[11px] text-slate-600 flex justify-between gap-2">
                                  <span className="truncate">{it.offerId || it.sku}</span>
                                  <span className="shrink-0 text-right">
                                    <span className="font-semibold">{it.quantity} шт</span>
                                    {b.perBox > 0 && (
                                      <span className="text-slate-400"> · {b.totalBoxes} кор по {b.perBox} шт</span>
                                    )}
                                    {b.isPartial && (
                                      <span className="text-amber-600 font-semibold"> · неполная: {b.remainder} шт</span>
                                    )}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {(c.rejected || []).length > 0 && (
                          <div className="mt-2">
                            <div className="text-[11px] font-bold uppercase text-red-500">Не войдёт</div>
                            {c.rejected.map((it: any, i: number) => {
                              const b = boxInfoForOzonItem(it);
                              return (
                                <div key={`r${i}`} className="text-[11px] text-red-600 flex justify-between gap-2">
                                  <span className="truncate">{it.offerId || it.sku}</span>
                                  <span className="shrink-0 text-right">
                                    <span className="font-semibold">{it.quantity} шт</span>
                                    {b.perBox > 0 && (
                                      <span className="text-red-400"> · {b.totalBoxes} кор по {b.perBox} шт</span>
                                    )}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {stillSelected && (
                          <button
                            type="button"
                            onClick={() => removeCluster(String(c.clusterId))}
                            className="mt-2 text-[11px] font-bold text-red-600 hover:text-red-800"
                          >
                            Убрать этот кластер из заявки
                          </button>
                        )}
                      </div>
                    );
                  })}

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
                </div>
              )}

              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 pt-1">Состав заявки</div>
              <div className="text-xs text-slate-500">
                Количество можно менять, лишнюю строку или кластер — убрать, а недостающие позиции добавить внизу. Остатки на складе это не меняет.
              </div>

              {noBoxNormRows.length > 0 && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs font-semibold text-amber-800">
                  Не задано количество в коробке (поле «Штук в коробке» в SKU Базе): {noBoxNormRows.join(', ')}.
                  Заявку это не блокирует, но посчитать коробки не получится.
                </div>
              )}

              {partialBoxRows.length > 0 && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs font-semibold text-amber-800">
                  Неполные коробки: {partialBoxRows.map((r) => {
                    const b = boxInfo(r);
                    return `${r.article} / ${r.clusterName} — ${b.fullBoxes} полных и ${b.remainder} шт из ${b.perBox}`;
                  }).join('; ')}.
                  Это не ошибка — заявку создать можно. Чтобы коробки были полными, округлите количество.
                </div>
              )}

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
                      {/* Item 45. How much of this article is still free to ship, with the
                          other lines of the same supply already taken into account. */}
                      {hasFreeFigure(r.article) && (
                        <div className="text-[11px] text-slate-400">
                          доступно для отгрузки {capForRow(r.article, rowKey(r))} шт
                          {addedRows.some((a) => rowKey(a) === rowKey(r)) && (
                            <span className="ml-1.5 text-indigo-500 font-semibold">добавлено вручную</span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="text-[11px] shrink-0 text-right">
                      {(() => {
                        const b = boxInfo(r);
                        if (b.perBox <= 0) {
                          return <span className="text-amber-600 font-semibold">норма коробки<br />не задана</span>;
                        }
                        return (
                          <>
                            <div className="text-slate-500 font-semibold">{b.totalBoxes} кор</div>
                            <div className="text-slate-400">по {b.perBox} шт</div>
                            {b.isPartial && (
                              <div className="text-amber-600 font-semibold">неполная: {b.remainder} шт</div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      max={hasFreeFigure(r.article) ? capForRow(r.article, rowKey(r)) : undefined}
                      value={getQty(r)}
                      onChange={(e) => changeQty(r, e.target.value)}
                      className="w-24 px-3 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm font-semibold text-slate-800 bg-white"
                    />
                    <span className="text-[11px] text-slate-400 shrink-0">шт</span>
                    <button
                      type="button"
                      onClick={() => removeRow(r)}
                      title="Убрать эту строку из заявки"
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors shrink-0"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>

              {/* Item 45. Adding a cluster or an article that the recommendation did not propose. */}
              <div className="p-3 rounded-xl border border-dashed border-indigo-200 bg-indigo-50/40 flex flex-col gap-2">
                <div className="text-[11px] font-bold uppercase tracking-wide text-indigo-500">Добавить позицию</div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={addForm.clusterId}
                    onChange={(e) => setAddForm({ clusterId: e.target.value, article: '', qty: '' })}
                    className="flex-1 min-w-[9rem] px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">Кластер…</option>
                    {clusterOptions.map((c) => (
                      <option key={c.clusterId} value={c.clusterId}>{c.clusterName}</option>
                    ))}
                  </select>
                  <select
                    value={addForm.article}
                    disabled={!addForm.clusterId}
                    onChange={(e) => setAddForm({ ...addForm, article: e.target.value, qty: '' })}
                    className="flex-1 min-w-[9rem] px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    <option value="">Товар…</option>
                    {articleOptions.map((o) => (
                      <option key={o.article} value={o.article}>
                        {o.article}{o.name ? ` — ${o.name}` : ''}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    max={addFormCap}
                    disabled={!addForm.article}
                    value={addForm.qty}
                    placeholder="шт"
                    onChange={(e) => setAddForm({ ...addForm, qty: e.target.value })}
                    className="w-24 px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-100"
                  />
                  <button
                    type="button"
                    onClick={addLine}
                    disabled={!addForm.article || !addForm.qty}
                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-bold transition-colors"
                  >
                    Добавить
                  </button>
                </div>
                {addForm.article ? (
                  <div className="text-[11px] text-slate-500">
                    Доступно для отгрузки: <span className="font-bold text-slate-700">{addFormCap} шт</span>.
                    {pcsPerBoxMap[addForm.article] > 0 && <> В коробке {pcsPerBoxMap[addForm.article]} шт.</>}
                    {' '}На складе может лежать больше — часть уже зарезервирована под созданные заявки.
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-400">
                    {addForm.clusterId
                      ? (articleOptions.length > 0
                          ? 'Выберите товар. В списке только те, у кого есть SKU Ozon и кого ещё нет в этом кластере.'
                          : 'В этот кластер добавить нечего: все подходящие товары уже в заявке.')
                      : 'Выберите кластер — можно любой, не только из рекомендаций.'}
                  </div>
                )}
              </div>

              {Object.keys(removedRows).length > 0 && (
                <button
                  type="button"
                  onClick={restoreRows}
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
        </div>

        <div className="p-6 border-t border-slate-100 bg-slate-50/50 flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleClose}
            className="px-5 py-2.5 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-200 transition-colors"
          >
            {timedOut ? 'Закрыть' : 'Отмена'}
          </button>
          {!sending && (
            <button
              type="button"
              id="btn-ozon-supply-submit"
              onClick={handlePrimary}
              disabled={missingSku.length > 0 || activeRows.length === 0}
              className={`px-5 py-2.5 rounded-xl disabled:opacity-50 text-white text-sm font-bold transition-colors flex items-center gap-2 ${
                primaryIsSafe ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-red-600 hover:bg-red-700'
              }`}
            >
              {primaryIsSafe ? <RefreshCw size={16} /> : <Send size={16} />}
              {primaryLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
