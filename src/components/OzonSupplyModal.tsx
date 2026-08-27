import React, { useState, useMemo, useEffect, useRef } from 'react';
import { buildCargoPlan, buildBoxesPayload } from '../lib/ozonCargo';
import { X, Send, Trash2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { directWarehouseFor, disabledReason, isClusterSelectable, parseDirectClusters, validateSelection } from '../lib/ozonDirectSupply';
import { isCabinetCompatible } from '../lib/ozonSupplyCabinet';
import { resolveOzonArticle, parseExcludedClusters } from '../lib/ozonCoverage';
import { acceptedForLine, applyOzonCorrection, capForSupplyLine, foldOzonVerdict } from '../lib/ozonSupplyLines';

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
  /** Пункт 59. Магазины, в которых продаётся товар. Пустой список — магазин неизвестен. */
  cabinets?: string[];
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
  const supplySettings = useWarehouseStore((state) => state.ozonSupplySettings);
  const ozonSettings = useWarehouseStore((state) => state.ozonSettings);

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

  /* ---- Item 45. Adding a cluster or an article by hand ----------------------------
   * These two live ABOVE the early return on purpose. Hooks must run in the same order on
   * every render; when they sat below it, opening the window ran two useMemo calls that the
   * closed render had not, React threw «Rendered more hooks than during the previous
   * render» and the whole page went blank until a reload. See rule 11.11 in the brief.
   */

  /** Clusters offered in the picker: the reference list MINUS the ones banned for shipping
   *  in the settings, current ones first. A banned cluster gets no recommendation either,
   *  so offering it here would contradict the rest of the screen. */
  const clusterOptions = useMemo(() => {
    const excluded = parseExcludedClusters(ozonSettings ? ozonSettings.excludedClusters : '');
    const used = new Set(activeRows.map((r) => r.clusterId));
    const refs = (ozonClusterRefs || []).filter((c) => c.clusterId && !excluded.has(c.clusterId));
    return [...refs].sort((a, b) => {
      const ua = used.has(a.clusterId) ? 0 : 1;
      const ub = used.has(b.clusterId) ? 0 : 1;
      if (ua !== ub) return ua - ub;
      return a.clusterName.localeCompare(b.clusterName, 'ru');
    });
  }, [ozonClusterRefs, ozonSettings, activeRows]);

  /* ---- Пункт 58. Прямая поставка едет отдельной заявкой ---------------------------
   * Запрет обязан жить и здесь, а не только на экране рекомендаций: иначе он обходится
   * в два клика — отметить один кластер в рекомендациях, а второй дописать уже тут.
   * Недоступный кластер из списка НЕ убирается, а показывается серым с объяснением:
   * исчезнувший из списка Екатеринбург выглядел бы поломкой, а не правилом.
   */
  const directRules = useMemo(
    () => parseDirectClusters(supplySettings.directClusters),
    [supplySettings.directClusters]
  );

  /** Кластеры, которые уже есть в собираемой заявке. */
  /**
   * Пункт 58, этап 5. Прямая поставка: заявка едет ОДНИМ кластером, точки отгрузки у неё нет,
   * а склад размещения называет продавец. Склад по умолчанию берётся из настроек; если Ozon
   * его не даёт, человек выбирает замену сам — приложение не подменяет молча.
   */
  const [pickedWarehouseId, setPickedWarehouseId] = useState('');
  const [pickedWarehouseName, setPickedWarehouseName] = useState('');
  const [warehouseAlternatives, setWarehouseAlternatives] = useState<{ warehouseId: string; name: string; address: string }[]>([]);
  const [warehouseProblem, setWarehouseProblem] = useState('');

  const supplyClusterIds = useMemo(() => {
    const ids: string[] = [];
    activeRows.forEach((r) => {
      const cid = String(r.clusterId || '').trim();
      if (cid && ids.indexOf(cid) < 0) ids.push(cid);
    });
    return ids;
  }, [activeRows]);

  /** Правило прямой поставки для собранного состава: null — заявка кросс-докинговая. */
  const directRule = useMemo(
    () => directWarehouseFor(directRules, supplyClusterIds),
    [directRules, supplyClusterIds]
  );
  const isDirect = directRule !== null;

  /** Склад, который поедет в Ozon: выбранная замена важнее склада из настроек. */
  const activeWarehouseId = pickedWarehouseId || (directRule ? directRule.warehouseId : '');
  const activeWarehouseName = pickedWarehouseName || (directRule ? directRule.warehouseName : '');

  /** Articles offered for the chosen cluster: something must be free to ship on «Мой склад»,
   *  an Ozon SKU is required,
   *  otherwise the line cannot be sent at all, and the pair must not already be in the
   *  supply — rowKey is article|||clusterId and a duplicate would collide. */
  const articleOptions = useMemo(() => {
    if (!addForm.clusterId) return [];
    const taken = new Set(allRows.filter((r) => r.clusterId === addForm.clusterId).map((r) => r.article));
    return (stockOptions || [])
      .filter((o) => o.freeMyStock > 0 && skuMap[o.article] && !taken.has(o.article))
      // Пункт 59. Заявка принадлежит одному магазину, поэтому товары чужого кабинета
      // в список не попадают вовсе: добавленный сюда артикул уехал бы по чужим ключам.
      .filter((o) => isCabinetCompatible([[cabinet]], o.cabinets || []))
      .sort((a, b) => a.article.localeCompare(b.article, 'ru'));
  }, [addForm.clusterId, stockOptions, skuMap, allRows, cabinet]);

  /* ---- Ozon's answer, folded into the composition -------------------------------
   * Ozon replies per cluster with two lists of items: what will go into the supply and
   * what will not. The window used to show that as a separate read-only block above the
   * editable one, so the same supply was described twice. Here the answer is reduced to
   * «per cluster, per article: accepted / rejected» and printed inside the row it belongs
   * to. Items come back as offerId + Ozon SKU, so the article is restored the same way
   * the rest of the screen does it.
   */
  const ozonByCluster = useMemo(
    () => foldOzonVerdict(
      (verdict && verdict.clusters) || [],
      (offerId, sku) => resolveOzonArticle(skus, offerId, sku)
    ),
    [verdict, skus]
  );

  /** Строки заявки, сгруппированные по кластеру: кластер — заголовок, товары — внутри. */
  const rowsByCluster = useMemo(() => {
    const out: { clusterId: string; clusterName: string; rows: SupplyPlanRow[] }[] = [];
    const idx: Record<string, number> = {};
    for (const r of activeRows) {
      if (idx[r.clusterId] === undefined) {
        idx[r.clusterId] = out.length;
        out.push({ clusterId: r.clusterId, clusterName: r.clusterName, rows: [] });
      }
      out[idx[r.clusterId]].rows.push(r);
    }
    return out;
  }, [activeRows]);

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

  const addFormCap = addForm.article ? capForRow(addForm.article, '') : 0;

  const addLine = () => {
    const cluster = clusterOptions.find((c) => c.clusterId === addForm.clusterId);
    if (!cluster) {
      toast.error('Выберите кластер');
      return;
    }
    // Пункт 58. Сторож на случай, если выбор всё же прошёл мимо серого пункта списка.
    if (!isClusterSelectable(directRules, supplyClusterIds, cluster.clusterId)) {
      toast.error(disabledReason(directRules, supplyClusterIds, cluster.clusterId));
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

  /** Сколько штук Ozon примет и сколько не примет по всей заявке. */
  const ozonTotals = (() => {
    let accepted = 0;
    let rejected = 0;
    for (const r of activeRows) {
      const one = acceptedForLine(ozonByCluster, { article: r.article, clusterId: r.clusterId, qty: getQty(r) });
      accepted += one.accepted;
      rejected += one.notAccepted;
    }
    return { accepted, rejected };
  })();

  /**
   * «Скорректировать поставку»: строки, которые Ozon берёт, получают принятое количество,
   * а те, из которых он не берёт ничего, УХОДЯТ из заявки — строка с нулём это не позиция
   * поставки, а позиция, которой там быть не должно. Кластер, потерявший все свои строки,
   * уходит следом: везти на склад нечего.
   * Пересчёт после этого не нужен — состав становится ровно тем, который Ozon подтвердил,
   * поэтому dirty снимается. Кнопка живёт только при неизменённом составе: по строке,
   * добавленной после расчёта, ответа Ozon просто нет.
   */
  const correctToOzon = () => {
    if (!verdict) return;
    const result = applyOzonCorrection(
      ozonByCluster,
      activeRows.map((r) => ({ article: r.article, clusterId: r.clusterId, qty: getQty(r) }))
    );
    const nextRemoved = { ...removedRows };
    for (const key of result.removedKeys) nextRemoved[key] = true;
    setQtyEdit({ ...qtyEdit, ...result.quantities });
    setRemovedRows(nextRemoved);
    setDirty(false);

    if (Object.keys(result.quantities).length === 0) {
      toast.error('Ozon не принимает ни одной позиции — заявку создать не из чего');
      return;
    }
    const parts: string[] = [];
    if (result.removedKeys.length > 0) parts.push(`убрано позиций: ${result.removedKeys.length}`);
    if (result.removedClusterIds.length > 0) parts.push(`кластеров: ${result.removedClusterIds.length}`);
    toast.success(parts.length > 0
      ? `Состав приведён к ответу Ozon (${parts.join(', ')})`
      : 'Количества выставлены по ответу Ozon');
  };

  /** Кластеры живого состава — те, где реально что-то остаётся отгружать. */
  const liveClusterIds = () =>
    Array.from(new Set(activeRows.filter((r) => getQty(r) > 0).map((r) => r.clusterId)));

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
        supplyType: isDirect ? 'DIRECT' : 'CROSSDOCK',
        storageWarehouseId: isDirect ? activeWarehouseId : '',
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
          dropOffName: isDirect ? (activeWarehouseName + ' (привезу сам)') : dropOffWarehouseName,
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
   * Расчёт черновика. Заявку НЕ создаёт никогда.
   * Прежде первое нажатие создавало заявку сразу, если Ozon принимал состав целиком, —
   * человек не видел ни кластеров, ни возможности что-то добавить, заявка просто уезжала.
   * Теперь путь один и тот же при любом ответе Ozon: расчёт → показ состава с ответом →
   * отдельное нажатие «Создать заявку в этом составе». Создание заявки необратимо, и
   * последнее слово всегда за человеком.
   */
  const runDraft = async () => {
    // Пункт 59. Пустой магазин прокси молча превращал в первый кабинет из настроек,
    // и заявка уезжала по чужим ключам. Лучше остановиться здесь.
    if (!cabinet) {
      toast.error('Магазин заявки не определён: соберите заявку из товаров одного магазина или выберите магазин фильтром вкладки');
      return;
    }
    // Пункт 58. У прямой поставки точки отгрузки нет вовсе, зато обязателен склад,
    // и состав обязан пройти сторож правила: смешанная заявка в Ozon не существует.
    const selectionProblem = validateSelection(directRules, supplyClusterIds);
    if (selectionProblem) {
      toast.error(selectionProblem);
      return;
    }
    if (isDirect) {
      if (!activeWarehouseId) {
        toast.error('Не выбран склад прямой поставки — укажите его в настройках Ozon');
        return;
      }
    } else if (!dropOffWarehouseId || !dropOffWarehouseType) {
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
        cabinet, dropOffWarehouseId, dropOffWarehouseType, clusters,
        supplyType: isDirect ? 'DIRECT' : 'CROSSDOCK',
        storageWarehouseId: isDirect ? activeWarehouseId : '',
        storageWarehouseName: isDirect ? activeWarehouseName : ''
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

    // Ozon не дал склад: показываем причину и список замен, но сами не подменяем.
    const directAnswer = data.directWarehouse;
    if (isDirect && directAnswer && directAnswer.problem) {
      setWarehouseProblem(String(directAnswer.message || 'Ozon не принимает поставку на выбранный склад'));
      setWarehouseAlternatives(Array.isArray(directAnswer.alternatives) ? directAnswer.alternatives : []);
      toast.error(directAnswer.message || 'Ozon не принимает поставку на выбранный склад', { duration: 15000 });
      setSending(false);
      return;
    }
    setWarehouseProblem('');
    setWarehouseAlternatives([]);

    const hasRejected = Array.isArray(data.rejectedItems) && data.rejectedItems.length > 0;
    const hasBadCluster = (data.clusters || []).some((c: any) => c.state !== 'FULL_AVAILABLE');
    const hasRestricted = (data.clusters || []).some((c: any) => (c.rejected || []).length > 0);

    setSending(false);
    if (hasRejected || hasBadCluster || hasRestricted) {
      toast.error('Ozon принял заявку не полностью — проверьте состав');
    } else {
      toast.success('Ozon готов принять весь состав. Проверьте и нажмите «Создать заявку в этом составе»');
    }
  };

  const handlePrimary = async () => {
    if (noBoxNormRows.length > 0) {
      toast.error('Не задано количество в коробке для артикулов: ' + noBoxNormRows.join(', ') + '. Заполните «Штук в коробке» в SKU Базе — без этого грузоместа не разложить.');
      return;
    }
    if (!verdict) {
      await runDraft();
      return;
    }
    if (dirty) {
      await runDraft();
      return;
    }
    setSending(true);
    // Только кластеры, которые остались в составе: убранный кластер или обнулённая после
    // коррекции строка не должны уезжать в Ozon.
    const clusterIds = liveClusterIds().filter((id) => ozonByCluster[id]);
    if (clusterIds.length === 0) {
      toast.error('В заявке не осталось ни одной позиции');
      setSending(false);
      return;
    }
    await sendOrder(draftId, clusterIds, verdict);
  };

  // Первое нажатие только СЧИТАЕТ черновик — надпись обязана это говорить, иначе человек
  // думает, что уже оформил заявку. Создаёт её только «Создать заявку в этом составе».
  const primaryLabel = !verdict ? 'Проверить в Ozon' : dirty ? 'Пересчитать в Ozon' : 'Создать заявку в этом составе';
  const primaryIsSafe = Boolean(verdict) && dirty;

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 fade-in">
      <div className="bg-white rounded-3xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh] modal-enter">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <div>
            <h3 className="text-xl font-bold text-slate-900">Оформить поставку в Ozon</h3>
            <div className="text-xs text-slate-500 mt-0.5">
              {isDirect
                ? `Привезу самостоятельно · склад ${activeWarehouseName || 'не выбран'}`
                : `Точка отгрузки: ${dropOffWarehouseName || 'не выбрана'}`}
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
                <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 text-xs font-semibold text-red-600">
                  Не удалось определить Ozon-SKU: {missingSku.join(', ')}. SKU берётся из зеркала «Остатки Ozon», запасной источник — колонка «ШК Ozon» в SKU Базе.
                </div>
              )}

              {verdict && (
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600">
                  {dirty
                    ? 'Состав изменён после расчёта. Нажмите «Пересчитать в Ozon» — заявка при этом НЕ создаётся.'
                    : 'Ozon ответил. Заявка ещё НЕ создана — ниже видно, что он примет. Можно поправить количества, добавить кластер или товар, нажать «Скорректировать поставку». Заявка уйдёт в Ozon только по кнопке «Создать заявку в этом составе».'}
                </div>
              )}

              <div className="flex items-end justify-between gap-3 pt-1">
                <div className="min-w-0">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Состав заявки</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Количество можно менять, лишнюю строку или кластер — убрать, а недостающие позиции добавить внизу. Остатки на складе это не меняет.
                  </div>
                </div>
                {verdict && !dirty && (
                  <button
                    type="button"
                    onClick={correctToOzon}
                    title="Выставить в каждой строке то количество, которое Ozon согласился принять"
                    className="shrink-0 px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-100 transition-colors"
                  >
                    Скорректировать поставку
                  </button>
                )}
              </div>

              {verdict && (
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-3">
                  <div className="text-xs text-slate-500">Ozon примет из заявки</div>
                  <div className="text-xs text-slate-600">
                    <span className="font-bold text-slate-900">{ozonTotals.accepted} шт</span>
                    {ozonTotals.rejected > 0 ? (
                      <> · не примет <span className="font-bold text-red-600">{ozonTotals.rejected} шт</span></>
                    ) : (
                      <span className="text-slate-400"> · всё целиком</span>
                    )}
                  </div>
                </div>
              )}

              {noBoxNormRows.length > 0 && (
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600">
                  Не задано количество в коробке (поле «Штук в коробке» в SKU Базе): {noBoxNormRows.join(', ')}.
                  Заявку это не блокирует, но посчитать коробки не получится.
                </div>
              )}

              {partialBoxRows.length > 0 && (
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600">
                  Неполные коробки: {partialBoxRows.map((r) => {
                    const b = boxInfo(r);
                    return `${r.article} / ${r.clusterName} — ${b.fullBoxes} полных и ${b.remainder} шт из ${b.perBox}`;
                  }).join('; ')}.
                  Это не ошибка — заявку создать можно. Чтобы коробки были полными, округлите количество.
                </div>
              )}

              {/* Один список: кластер — заголовок, товары — внутри, ответ Ozon — в самой строке.
                  Прежде ответ Ozon жил отдельным блоком выше, и одна и та же заявка описывалась дважды. */}
              <div className="flex flex-col gap-3">
                {rowsByCluster.map((group) => {
                  const v = ozonByCluster[group.clusterId];
                  const stateText = !v
                    ? ''
                    : v.state === 'FULL_AVAILABLE'
                      ? 'принимает полностью'
                      : v.state === 'PARTIAL_AVAILABLE'
                        ? 'принимает частично'
                        : v.state === 'NOT_AVAILABLE'
                          ? 'не принимает'
                          : 'статус не определён';
                  const reasonText = !v ? '' :
                    v.invalidReason === 'NOT_AVAILABLE_MATRIX' ? ' · склад не принимает такие товары'
                    : v.invalidReason === 'NOT_AVAILABLE_RANK' ? ' · склад недоступен по рейтингу'
                    : v.invalidReason === 'NOT_AVAILABLE_ROUTE' ? ' · нет маршрута'
                    : v.invalidReason === 'PARTIAL_MATRIX_AVAILABLE' ? ' · примет только часть товаров'
                    : v.invalidReason.indexOf('TIMESLOT') >= 0 ? ' · нет свободных слотов'
                    : '';
                  return (
                    <div key={group.clusterId} className="rounded-2xl border border-slate-200 overflow-hidden">
                      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-base font-bold text-slate-900 truncate">{group.clusterName}</div>
                          {v && (
                            <div className="text-[11px] text-slate-500 truncate">Ozon {stateText}{reasonText}</div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => removeCluster(group.clusterId)}
                          title="Убрать весь кластер из заявки"
                          className="shrink-0 text-[11px] font-bold text-slate-500 hover:text-red-600 transition-colors"
                        >
                          Убрать кластер
                        </button>
                      </div>

                      <div className="divide-y divide-slate-100">
                        {group.rows.map((r) => {
                          const b = boxInfo(r);
                          const seen = v ? v.byArticle[r.article] : undefined;
                          const one = acceptedForLine(ozonByCluster, { article: r.article, clusterId: r.clusterId, qty: getQty(r) });
                          const accepted = v ? one.accepted : null;
                          const notAccepted = seen || v ? one.notAccepted : 0;
                          return (
                            <div key={rowKey(r)} className="flex items-center gap-3 px-4 py-3">
                              <div className="min-w-0 flex-1">
                                <div className="font-mono font-bold text-sm text-slate-800 truncate">{r.article}</div>
                                {r.limitedByMyStock && (
                                  <div className="text-[11px] text-slate-500">урезано остатком Моего склада</div>
                                )}
                                {hasFreeFigure(r.article) && (
                                  <div className="text-[11px] text-slate-400">
                                    доступно для отгрузки {capForRow(r.article, rowKey(r))} шт
                                    {addedRows.some((a) => rowKey(a) === rowKey(r)) && (
                                      <span className="ml-1.5 text-slate-500 font-semibold">добавлено вручную</span>
                                    )}
                                  </div>
                                )}
                                {accepted !== null && (
                                  <div className="text-[11px] mt-0.5">
                                    <span className="text-slate-500">Ozon примет </span>
                                    <span className="font-bold text-slate-900">{accepted} шт</span>
                                    {notAccepted > 0 && (
                                      <>
                                        <span className="text-slate-500"> · не примет </span>
                                        <span className="font-bold text-red-600">{notAccepted} шт</span>
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>

                              <div className="text-[11px] shrink-0 text-right text-slate-500">
                                {b.perBox <= 0 ? (
                                  <span>норма коробки<br />не задана</span>
                                ) : (
                                  <>
                                    <div className="font-semibold">{b.totalBoxes} кор</div>
                                    <div className="text-slate-400">по {b.perBox} шт</div>
                                    {b.isPartial && <div>неполная: {b.remainder} шт</div>}
                                  </>
                                )}
                              </div>

                              <input
                                type="number"
                                min="0"
                                step="1"
                                max={hasFreeFigure(r.article) ? capForRow(r.article, rowKey(r)) : undefined}
                                value={getQty(r)}
                                onChange={(e) => changeQty(r, e.target.value)}
                                className="w-24 px-3 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-slate-400 outline-none text-sm font-semibold text-slate-800 bg-white"
                              />
                              <span className="text-[11px] text-slate-400 shrink-0">шт</span>
                              <button
                                type="button"
                                onClick={() => removeRow(r)}
                                title="Убрать эту строку из заявки"
                                className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 transition-colors shrink-0"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              {verdict && (verdict.rejectedItems || []).length > 0 && (
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">Причины отказа Ozon</div>
                  {(verdict.rejectedItems || []).map((r: any, i: number) => (
                    <div key={i} className="text-[11px] text-slate-600">
                      кластер {r.clusterId}, SKU {r.sku}: {(r.reasons || []).join(', ')}
                    </div>
                  ))}
                </div>
              )}

              {/* Пункт 58, этап 5. Ozon не дал склад прямой поставки: показываем причину и
                  доступные склады этого кластера. Подменять склад молча нельзя — решение,
                  куда физически везти груз, принимает человек. */}
              {isDirect && warehouseProblem && (
                <div className="p-3 rounded-2xl border border-amber-200 bg-amber-50 flex flex-col gap-2">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-amber-600">Склад прямой поставки</div>
                  <div className="text-sm font-semibold text-amber-900">{warehouseProblem}</div>
                  {warehouseAlternatives.length === 0 ? (
                    <div className="text-xs text-amber-800">
                      Замен нет. Уберите этот кластер из заявки или дождитесь, пока Ozon откроет склад.
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {warehouseAlternatives.map((w) => (
                        <button
                          key={w.warehouseId}
                          type="button"
                          onClick={() => {
                            setPickedWarehouseId(w.warehouseId);
                            setPickedWarehouseName(w.name);
                            setWarehouseProblem('');
                            setWarehouseAlternatives([]);
                            markDirty();
                            toast.success('Склад заменён на «' + (w.name || w.warehouseId) + '». Нажмите «Пересчитать в Ozon»');
                          }}
                          className="w-full text-left p-2.5 rounded-xl border border-amber-200 bg-white hover:bg-amber-100/50 transition-colors"
                        >
                          <div className="text-sm font-bold text-slate-800 break-words">{w.name || w.warehouseId}</div>
                          {w.address && <div className="text-xs text-slate-400 mt-0.5 break-words">{w.address}</div>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {/* Item 45. Adding a cluster or an article that the recommendation did not propose. */}
              <div className="p-3 rounded-2xl border border-slate-200 bg-slate-50 flex flex-col gap-2">
                <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Добавить позицию</div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={addForm.clusterId}
                    onChange={(e) => setAddForm({ clusterId: e.target.value, article: '', qty: '' })}
                    className="flex-1 min-w-[9rem] px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-slate-400"
                  >
                    <option value="">Кластер…</option>
                    {clusterOptions.map((c) => {
                      const blocked = !isClusterSelectable(directRules, supplyClusterIds, c.clusterId);
                      return (
                        <option key={c.clusterId} value={c.clusterId} disabled={blocked}>
                          {blocked ? `${c.clusterName} — только отдельной заявкой` : c.clusterName}
                        </option>
                      );
                    })}
                  </select>
                  <select
                    value={addForm.article}
                    disabled={!addForm.clusterId}
                    onChange={(e) => setAddForm({ ...addForm, article: e.target.value, qty: '' })}
                    className="flex-1 min-w-[9rem] px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-slate-400 disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    <option value="">Товар…</option>
                    {articleOptions.map((o) => (
                      <option key={o.article} value={o.article}>{o.article}</option>
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
                    className="w-24 px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold outline-none focus:ring-2 focus:ring-slate-400 disabled:bg-slate-100"
                  />
                  <button
                    type="button"
                    onClick={addLine}
                    disabled={!addForm.article || !addForm.qty}
                    className="px-4 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-40 text-slate-700 text-sm font-bold transition-colors"
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
                          ? 'Выберите товар. В списке только те SKU, у которых есть остатки на Своём складе.'
                          : 'В этот кластер добавить нечего: свободных остатков на Своём складе по подходящим товарам нет.')
                      : 'Выберите кластер — можно любой, не только из рекомендаций.'}
                  </div>
                )}
              </div>

              {Object.keys(removedRows).length > 0 && (
                <button
                  type="button"
                  onClick={restoreRows}
                  className="text-[11px] font-bold text-slate-500 hover:text-slate-800"
                >
                  Вернуть убранные строки
                </button>
              )}

              <div className="p-3 rounded-2xl border border-slate-200 bg-slate-50 text-xs font-bold text-slate-700">
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
              className="px-5 py-2.5 rounded-xl disabled:opacity-50 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold transition-colors flex items-center gap-2"
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
