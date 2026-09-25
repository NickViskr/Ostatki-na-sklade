import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, RefreshCw, Loader2, Trash2, Pencil, ChevronDown, ChevronRight, AlertTriangle, Save, FileUp, RotateCw
} from 'lucide-react';
import { toast } from 'sonner';
import { useChinaStore } from '../store/useChinaStore';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { useUIStore } from '../store/useUIStore';
import { ChinaBatch, ChinaBatchLine } from '../types';
import { chinaBatchPipelineInfo } from '../lib/factoryOrderDisplay';
import { ChinaBatchModal } from './ChinaBatchModal';
import { ChinaPaymentsCard } from './ChinaPaymentsCard';
import { ChinaForecastPanel } from './ChinaForecastPanel';
import {
  CHINA_COST_TYPES, ChinaBatchForm, ChinaCostRow, chinaArticleConflicts, chinaBatchToForm, chinaCheckMark,
  chinaCostRowsOf, chinaCostRowsPayload, chinaEtaText, chinaFormFromArrival, chinaFormFromFiles,
  chinaFormToPayload, chinaFreightPerKgLabel, chinaLevelledIndexes, chinaMarkingMatches, chinaMatchArrivalBatch,
  chinaMatchFinalBatch, chinaRateSourceLabel, chinaRateStatusText, chinaRemainingText, chinaShowWeightFactor,
  chinaTariffRateUnit
} from '../lib/chinaBatchForm';
import {
  ChinaParsedArrival, ChinaParsedBatch, ChinaParsedReport, ChinaSheets, chinaReportPayload,
  detectChinaFile, parseChinaArrivalFile, parseChinaBatchFile, parseChinaReportFile
} from '../lib/chinaFileParse';
import { chinaSheetsFromFile } from '../lib/chinaXlsx';
import { chinaArticleOptions } from '../lib/chinaArticles';
import {
  ChinaAiKind, ChinaAiParsed, chinaAiFallbackMark, chinaAiFallbackNeeded, chinaAiFallbackReason,
  chinaAiNotice, chinaAiParse, chinaAiPassed, chinaAiRead
} from '../lib/chinaAiRead';

const money = (value: number, currency: string): string =>
  `${(Number(value) || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

/** Item 81f: «после стоимости в валюте указывай стоимость в рублях в скобках» — the rubles are
 * the script's own figure, never computed here; when it is 0 or missing only the currency
 * amount is shown, so old data without it renders exactly as before. */
const moneyWithRub = (value: number, currency: string, rub?: number): string =>
  rub ? `${money(value, currency)} (${money(rub, '₽')})` : money(value, currency);

const statusColour = (status: string): string => {
  if (status === 'Прибыла') return 'bg-emerald-50 text-emerald-700';
  if (status === 'В пути') return 'bg-amber-50 text-amber-700';
  return 'bg-slate-100 text-slate-600';
};

/** The article and the same-product marker are edited in place, one batch at a time. */
interface LabelDraft { article: string; group: string }

export const ChinaOrdersTab: React.FC = () => {
  const batches = useChinaStore((s) => s.batches);
  const settings = useChinaStore((s) => s.settings);
  const isLoading = useChinaStore((s) => s.isLoading);
  const isSaving = useChinaStore((s) => s.isSaving);
  const loaded = useChinaStore((s) => s.loaded);
  const error = useChinaStore((s) => s.error);
  const fetchChinaBatches = useChinaStore((s) => s.fetchChinaBatches);
  const setupChinaSpreadsheet = useChinaStore((s) => s.setupChinaSpreadsheet);
  const saveChinaBatch = useChinaStore((s) => s.saveChinaBatch);
  const deleteChinaBatch = useChinaStore((s) => s.deleteChinaBatch);
  const saveChinaReportAction = useChinaStore((s) => s.saveChinaReport);
  const setChinaRubCostsDone = useChinaStore((s) => s.setChinaRubCostsDone);
  const setConfirmDialog = useUIStore((s) => s.setConfirmDialog);
  const skus = useWarehouseStore((s) => s.skus);
  const sessionToken = useWarehouseStore((s) => s.sessionToken) || '';
  const currentUser = useWarehouseStore((s) => s.currentUser);
  const isAdmin = currentUser?.role?.toLowerCase() === 'admin' ||
    ['admin', 'админ', 'администратор'].includes(currentUser?.username?.toLowerCase() || '');
  // Item 83.4: the pipeline indicator per batch reads the warehouse's own «Заказы на фабрике» —
  // fetch it once if nothing has loaded it yet (e.g. this tab opened first, before «Остатки Ozon»).
  const factoryOrders = useWarehouseStore((s) => s.factoryOrders);
  const fetchFactoryOrders = useWarehouseStore((s) => s.fetchFactoryOrders);
  const syncChinaFactoryOrders = useChinaStore((s) => s.syncChinaFactoryOrders);
  const [isSyncingFactoryOrders, setIsSyncingFactoryOrders] = useState(false);

  const [openId, setOpenId] = useState<string>('');
  const [editing, setEditing] = useState<ChinaBatch | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [labels, setLabels] = useState<Record<string, LabelDraft>>({});
  const [importForm, setImportForm] = useState<ChinaBatchForm | null>(null);
  const [importNotes, setImportNotes] = useState<string[]>([]);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  // Item 81i: true when an arrival file just filled the batch's own weight/volume, because the
  // shipment is boxes with no pallets — the modal shows a note about it under the lines table.
  const [importBoxesOnly, setImportBoxesOnly] = useState(false);
  // Item 81g, step 7: the grid of cells and the script's own reading of it, kept ONLY when the
  // script found nothing to complain about — «Проверить ИИ» in the import window runs on these.
  const [importAiCheck, setImportAiCheck] = useState<{ kind: ChinaAiKind; sheets: ChinaSheets; scriptParsed: ChinaAiParsed } | null>(null);
  const [isReading, setIsReading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // Item 1 (owner, 2026-09-25): the Russian-side cost block is a local editable list, per batch,
  // sent whole with «Сохранить артикулы и пересчитать» — nothing here calls the script until
  // then. `undefined` for a batch means "no local edits yet": the rows shown are the batch's own
  // saved costs (or the two defaults, chinaCostRowsOf).
  const [costDrafts, setCostDrafts] = useState<Record<string, ChinaCostRow[]>>({});

  useEffect(() => { fetchChinaBatches(); }, [fetchChinaBatches]);
  useEffect(() => { if (factoryOrders.length === 0) fetchFactoryOrders(); }, [factoryOrders.length, fetchFactoryOrders]);

  const open = useMemo(() => batches.find((b) => b.id === openId) || null, [batches, openId]);

  const labelOf = (line: ChinaBatchLine): LabelDraft =>
    labels[line.id] || { article: line.article, group: line.group };

  const setLabel = (line: ChinaBatchLine, patch: Partial<LabelDraft>) =>
    setLabels((prev) => ({ ...prev, [line.id]: { ...labelOf(line), ...patch } }));

  // Item 81f, owner check: an article chosen for one line of a marking belongs to the whole
  // marking — every line of that batch sharing it (case-insensitive, trimmed) gets it too.
  const setArticleByMarking = (batch: ChinaBatch, line: ChinaBatchLine, article: string) => {
    const matched = chinaMarkingMatches(batch.lines, line.marking);
    const indexes = matched.length > 0 ? matched : [batch.lines.indexOf(line)];
    setLabels((prev) => {
      const next = { ...prev };
      indexes.forEach((i) => {
        const l = batch.lines[i];
        next[l.id] = { ...(prev[l.id] || { article: l.article, group: l.group }), article };
      });
      return next;
    });
  };

  const labelsChanged = (batch: ChinaBatch): boolean =>
    batch.lines.some((l) => {
      const draft = labels[l.id];
      return !!draft && (draft.article !== l.article || draft.group !== l.group);
    });

  // Item 1: the rows shown for a batch — its own local draft once the owner has touched
  // anything, otherwise its saved costs (or the two defaults for a batch with none yet).
  const costRowsOf = (batch: ChinaBatch): ChinaCostRow[] => costDrafts[batch.id] || chinaCostRowsOf(batch.costs);
  const costsChanged = (batch: ChinaBatch): boolean => costDrafts[batch.id] !== undefined;

  const setCostField = (batch: ChinaBatch, index: number, patch: Partial<ChinaCostRow>) => {
    const rows = costRowsOf(batch).slice();
    rows[index] = { ...rows[index], ...patch };
    setCostDrafts((prev) => ({ ...prev, [batch.id]: rows }));
  };

  const addCostRow = (batch: ChinaBatch) => {
    setCostDrafts((prev) => ({
      ...prev,
      [batch.id]: [...costRowsOf(batch), { id: '', type: CHINA_COST_TYPES[0], amountRub: '', comment: '' }]
    }));
  };

  const removeCostRow = (batch: ChinaBatch, index: number) => {
    const rows = costRowsOf(batch).slice();
    rows.splice(index, 1);
    setCostDrafts((prev) => ({ ...prev, [batch.id]: rows }));
  };

  // Saving the articles is saving the batch: the script recomputes it, because the article
  // and the marker decide which lines are costed as one product. Item 1: the Russian-side cost
  // list rides along in the SAME call, but only when the owner actually touched it — an
  // article-only save must not resend costs and re-tick «Расходы РФ внесены» behind his back.
  const saveLabels = async (batch: ChinaBatch) => {
    const form = chinaBatchToForm(batch);
    form.lines = form.lines.map((line, i) => {
      const draft = labels[batch.lines[i].id];
      return draft ? { ...line, article: draft.article, group: draft.group } : line;
    });
    const payload = chinaFormToPayload(form);
    if (costsChanged(batch)) payload.costs = chinaCostRowsPayload(costRowsOf(batch));
    const ok = await saveChinaBatch(payload);
    if (ok) {
      setLabels((prev) => {
        const next = { ...prev };
        batch.lines.forEach((l) => delete next[l.id]);
        return next;
      });
      setCostDrafts((prev) => {
        const next = { ...prev };
        delete next[batch.id];
        return next;
      });
    }
  };

  // Item 81g, step 7: called for a file whose OWN reading either failed outright (`parsed` is
  // null) or does not sum to what the file itself states — the owner's own safety net, an AI
  // reading of the SAME grid. Used only when it is trustworthy on its own terms (no warnings of
  // its own); otherwise the script's result (however broken) is kept, and both are shown, same
  // as before this feature existed.
  const runAiFallback = async <T extends ChinaAiParsed>(kind: ChinaAiKind, sheets: ChinaSheets, scriptParsed: T | null):
    Promise<{ parsed: T | null; checkMark: string; checkNote: string }> => {
    const reason = chinaAiFallbackReason(scriptParsed);
    try {
      const raw = await chinaAiRead(sessionToken, kind, sheets, reason);
      const aiParsed = chinaAiParse(kind, raw);
      if (chinaAiPassed(aiParsed)) {
        toast.warning(chinaAiNotice(reason));
        return { parsed: aiParsed as T, checkMark: chinaAiFallbackMark(true), checkNote: reason };
      }
    } catch (e) {
      console.error('China AI fallback failed', e);
    }
    return { parsed: scriptParsed, checkMark: chinaAiFallbackMark(false), checkNote: '' };
  };

  // Item 81c: the owner picks the files the Chinese side sent — the batch file and, beside
  // it, the running account, which is the only place the order number, the arrival date and
  // the carrier's yuan-per-dollar rate are written. The parser fills the form, the owner
  // checks it and saves; the script does the money.
  //
  // Item 81e: a THIRD kind of file, the arrival at the carrier's Yiwu warehouse, comes before
  // the batch has a code of its own — files may be picked in any order, so both kinds are
  // matched against the batches already saved, not against each other.
  //
  // Item 81g, step 7: a file the script could not read, or whose own sums did not add up, is
  // handed to AI before anything else happens — see `runAiFallback`.
  const readFiles = async (picked: FileList | null) => {
    if (!picked || picked.length === 0) return;
    setIsReading(true);
    const problems: string[] = [];
    const foundBatches: ChinaParsedBatch[] = [];
    const batchMeta: { checkMark: string; checkNote: string; sheets: ChinaSheets }[] = [];
    const foundArrivals: ChinaParsedArrival[] = [];
    const arrivalMeta: { checkMark: string; checkNote: string; sheets: ChinaSheets }[] = [];
    let report: ChinaParsedReport | null = null;
    let reportMeta = { checkMark: '', checkNote: '' };
    for (const file of Array.from(picked)) {
      try {
        const sheets = await chinaSheetsFromFile(file);
        const kind = detectChinaFile(sheets);
        if (kind === 'report') {
          let parsed = parseChinaReportFile(sheets);
          let checkMark = parsed && parsed.warnings.length === 0 ? 'скрипт' : '';
          let checkNote = '';
          if (chinaAiFallbackNeeded(parsed)) {
            const outcome = await runAiFallback('report', sheets, parsed);
            parsed = outcome.parsed;
            checkMark = outcome.checkMark;
            checkNote = outcome.checkNote;
          }
          report = parsed;
          reportMeta = { checkMark, checkNote };
        } else if (kind === 'batch') {
          let parsed = parseChinaBatchFile(sheets);
          let checkMark = parsed && parsed.warnings.length === 0 ? 'скрипт' : '';
          let checkNote = '';
          if (chinaAiFallbackNeeded(parsed)) {
            const outcome = await runAiFallback('batch', sheets, parsed);
            parsed = outcome.parsed;
            checkMark = outcome.checkMark;
            checkNote = outcome.checkNote;
          }
          if (parsed) { foundBatches.push(parsed); batchMeta.push({ checkMark, checkNote, sheets }); }
        } else if (kind === 'arrival') {
          let parsed = parseChinaArrivalFile(sheets);
          let checkMark = parsed && parsed.warnings.length === 0 ? 'скрипт' : '';
          let checkNote = '';
          if (chinaAiFallbackNeeded(parsed)) {
            const outcome = await runAiFallback('arrival', sheets, parsed);
            parsed = outcome.parsed;
            checkMark = outcome.checkMark;
            checkNote = outcome.checkNote;
          }
          if (parsed) { foundArrivals.push(parsed); arrivalMeta.push({ checkMark, checkNote, sheets }); }
        } else {
          problems.push(`${file.name}: не похоже ни на файл партии, ни на данные приёмки, ни на финансовый отчёт`);
        }
      } catch (e) {
        problems.push(`${file.name}: не удалось прочитать — ${(e as Error).message}`);
      }
    }
    setIsReading(false);
    if (fileInput.current) fileInput.current.value = '';

    // Item 81g: a report file alone is now a valid import — the browser groups nothing but its
    // own dates, all the money is worked out by the script.
    if (foundBatches.length === 0 && foundArrivals.length === 0) {
      if (report) {
        const payload = {
          ...chinaReportPayload(report),
          ...(reportMeta.checkMark === 'ИИ' ? { source: 'ИИ', aiReason: reportMeta.checkNote } : {})
        };
        const warnings = await saveChinaReportAction(payload as unknown as Record<string, unknown>);
        if (warnings && warnings.length > 0) toast.warning(warnings.join('; '));
        return;
      }
      toast.error(problems[0] || 'Файл партии в выбранных файлах не нашёлся');
      return;
    }
    if (foundBatches.length > 1) {
      problems.push(`Файлов партий выбрано ${foundBatches.length}; открыт первый (${foundBatches[0].code}), остальные загрузите после`);
    }
    if (foundArrivals.length > 1) {
      problems.push(`Файлов приёмки выбрано ${foundArrivals.length}; открыт первый (${foundArrivals[0].draftCode}), остальные загрузите после`);
    }

    let result: { form: ChinaBatchForm; notes: string[]; warnings: string[]; boxesOnly: boolean };
    let aiCheck: { kind: ChinaAiKind; sheets: ChinaSheets; scriptParsed: ChinaAiParsed } | null = null;
    if (foundBatches.length > 0) {
      const parsed = foundBatches[0];
      const meta = batchMeta[0];
      result = chinaFormFromFiles(parsed, report, chinaMatchFinalBatch(parsed.code, parsed.lines, batches));
      result.form.checkMark = meta.checkMark;
      result.form.checkNote = meta.checkNote;
      if (meta.checkMark === 'скрипт') aiCheck = { kind: 'batch', sheets: meta.sheets, scriptParsed: parsed };
    } else {
      const parsed = foundArrivals[0];
      const meta = arrivalMeta[0];
      result = chinaFormFromArrival(parsed, chinaMatchArrivalBatch(parsed.draftCode, parsed.lines, batches));
      result.form.checkMark = meta.checkMark;
      result.form.checkNote = meta.checkNote;
      if (meta.checkMark === 'скрипт') aiCheck = { kind: 'arrival', sheets: meta.sheets, scriptParsed: parsed };
    }
    if (result.form.checkMark === 'ИИ') result.notes.unshift(chinaAiNotice(result.form.checkNote));
    // A report picked ALONGSIDE a batch or arrival file is saved too, on its own — the batch
    // form still opens for the owner to check, but the money of the report does not wait for it.
    if (report) {
      const payload = {
        ...chinaReportPayload(report),
        ...(reportMeta.checkMark === 'ИИ' ? { source: 'ИИ', aiReason: reportMeta.checkNote } : {})
      };
      saveChinaReportAction(payload as unknown as Record<string, unknown>).then((warnings) => {
        if (warnings && warnings.length > 0) toast.warning(warnings.join('; '));
      });
    }
    setImportForm(result.form);
    setImportNotes(result.notes.concat(problems));
    setImportWarnings(result.warnings);
    setImportBoxesOnly(result.boxesOnly);
    setImportAiCheck(aiCheck);
    setEditing(null);
    setShowModal(true);
  };

  // Item 83.4: the admin-only manual/first-run reconciliation of «Заказы на фабрике» — the
  // success/summary toast is the store's own (`syncChinaFactoryOrders`); this one adds the
  // before→after pipeline qty of every article the sync actually changed.
  const runSyncFactoryOrders = async () => {
    setIsSyncingFactoryOrders(true);
    const result = await syncChinaFactoryOrders();
    setIsSyncingFactoryOrders(false);
    if (!result) return;
    const changedArticles = Array.from(new Set([...Object.keys(result.before), ...Object.keys(result.after)]))
      .filter((a) => (result.before[a] || 0) !== (result.after[a] || 0))
      .sort();
    if (changedArticles.length === 0) return;
    toast.custom(() => (
      <div className="bg-white border border-slate-200 rounded-xl shadow-lg p-4 text-sm max-w-sm">
        <p className="font-bold mb-2">Труба изменилась по артикулам</p>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-400 text-left">
              <th className="pr-2 pb-1">Артикул</th>
              <th className="pr-2 pb-1 text-right">Было</th>
              <th className="pb-1 text-right">Стало</th>
            </tr>
          </thead>
          <tbody>
            {changedArticles.map((a) => (
              <tr key={a}>
                <td className="pr-2 font-mono">{a}</td>
                <td className="pr-2 text-right">{result.before[a] || 0}</td>
                <td className="text-right font-bold">{result.after[a] || 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ), { duration: 12000 });
  };

  const askDeleteBatch = (batch: ChinaBatch) => {
    setConfirmDialog({
      show: true,
      title: 'Удалить партию?',
      message: `Партия ${batch.code} будет перемещена в корзину вместе со строками товара и расходами. Её можно восстановить в разделе «Удалённое».`,
      onConfirm: async () => {
        setConfirmDialog({ show: false, title: '', message: '', onConfirm: () => {} });
        await deleteChinaBatch(batch.id);
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Заказы в Китае</h1>
          <p className="text-sm text-slate-500">
            Партии с фабрики, перевозка и себестоимость прибывшего товара.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchChinaBatches()}
            disabled={isLoading}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-bold text-slate-600 hover:text-indigo-600 disabled:opacity-50"
          >
            {isLoading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            Обновить
          </button>
          {isAdmin && (
            <button
              data-testid="btn-sync-china-factory-orders"
              onClick={runSyncFactoryOrders}
              disabled={isSyncingFactoryOrders}
              title="Пересчитать заказы на фабрике по партиям и прогнозам «Заказы в Китае»"
              className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-bold text-slate-600 hover:text-indigo-600 disabled:opacity-50"
            >
              {isSyncingFactoryOrders ? <Loader2 size={16} className="animate-spin" /> : <RotateCw size={16} />}
              Обновить заказы на фабрике
            </button>
          )}
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,.xls"
            multiple
            className="hidden"
            onChange={(e) => readFiles(e.target.files)}
          />
          <button
            data-testid="btn-import-china-files"
            onClick={() => fileInput.current?.click()}
            disabled={isReading}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-bold text-slate-600 hover:text-indigo-600 disabled:opacity-50"
          >
            {isReading ? <Loader2 size={16} className="animate-spin" /> : <FileUp size={16} />}
            Загрузить файлы китайцев
          </button>
          <button
            data-testid="btn-new-china-batch"
            onClick={() => { setEditing(null); setShowModal(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700"
          >
            <Plus size={16} /> Новая партия
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={18} />
          <div className="grow">
            <p className="text-sm font-bold text-red-700">Модуль не отвечает</p>
            <p className="text-sm text-red-600">{error}</p>
            <button
              onClick={() => setupChinaSpreadsheet()}
              disabled={isSaving}
              className="mt-2 px-3 py-1.5 bg-white border border-red-200 rounded-lg text-sm font-bold text-red-600 hover:bg-red-100 disabled:opacity-50"
            >
              Настроить таблицу
            </button>
          </div>
        </div>
      )}

      {loaded && !error && <ChinaPaymentsCard />}
      {loaded && !error && <ChinaForecastPanel />}

      {loaded && batches.length === 0 && !error && (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-500">
          Партий пока нет. Нажмите «Новая партия» и внесите данные из файла китайцев.
        </div>
      )}

      <div className="space-y-3">
        {batches.map((batch) => {
          const isOpen = batch.id === openId;
          const levelledLines = chinaLevelledIndexes(batch.lines);
          const conflicts = chinaArticleConflicts(batch.lines);
          const hasBoxData = batch.lines.some((l) => l.boxVolumeM3 > 0 || l.factoryBoxKg > 0);
          const checkMark = chinaCheckMark(batch.checkMark || '', batch.checkNote || '');
          // Item 89: the transit itself takes about `transitDays` from the shipping date — 30
          // unless the script says otherwise for this account.
          const eta = chinaEtaText(batch, Number(settings.transitDays) || 30, new Date());
          const remaining = chinaRemainingText(batch);
          // Item 83.4: display-only — the actual pipeline lives in «Заказы на фабрике», this
          // just shows whether THIS batch is still counted there.
          const pipelineInfo = chinaBatchPipelineInfo(factoryOrders, batch.code);
          return (
            <div key={batch.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <button
                onClick={() => setOpenId(isOpen ? '' : batch.id)}
                className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-slate-50"
              >
                {isOpen ? <ChevronDown size={18} className="text-slate-400" /> : <ChevronRight size={18} className="text-slate-400" />}
                <div className="grow">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold">{batch.code || '(без кода)'}</span>
                    {checkMark && <span className={`font-bold ${checkMark.className}`} title={checkMark.title}>{checkMark.glyph}</span>}
                    {batch.orderNo && <span className="text-sm text-slate-400">заказ №{batch.orderNo}</span>}
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${statusColour(batch.status)}`}>{batch.status}</span>
                    {batch.history && (
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">история без курса</span>
                    )}
                    {batch.closed && (
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">Расчёт закрыт</span>
                    )}
                    {pipelineInfo && (
                      <span
                        className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${pipelineInfo.received ? 'bg-slate-100 text-slate-500' : 'bg-sky-50 text-sky-700'}`}
                        title="Пункт «Заказы на фабрике» вкладки «Остатки Ozon»"
                      >
                        {pipelineInfo.received ? 'получено' : `в трубе: ${pipelineInfo.qty} шт`}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {batch.shippedAt && <>отгружена {batch.shippedAt} </>}
                    {eta.text && <>· <span className={eta.className}>{eta.text}</span> </>}
                    · {batch.lines.length} строк · {batch.weightKg} кг
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold">{money(batch.totalRub, '₽')}</div>
                  <div className="text-xs text-slate-400">себестоимость партии</div>
                  {remaining && (
                    <div className={`text-xs font-bold ${remaining.className}`} title={remaining.title}>
                      {remaining.text}
                    </div>
                  )}
                </div>
              </button>

              {isOpen && open && (
                <div className="border-t border-slate-100 p-5 space-y-6">
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 text-sm">
                    <div><div className="text-xs text-slate-400 uppercase font-bold">Товар</div>{moneyWithRub(batch.goodsCny, '¥', batch.goodsRub)}</div>
                    <div><div className="text-xs text-slate-400 uppercase font-bold">Доставка по Китаю</div>{moneyWithRub(batch.chinaDeliveryCny, '¥', batch.chinaDeliveryRub)}</div>
                    <div>
                      <div className="text-xs text-slate-400 uppercase font-bold">Перевозка</div>
                      {moneyWithRub(batch.freightUsd, '$', batch.freightRub)}
                      {!!batch.ratePerKgUsd && (
                        <span className="block text-[10px] text-slate-400">
                          тариф карго: {moneyWithRub(batch.ratePerKgUsd, `$/${chinaTariffRateUnit(batch.tariffBasis)}`, batch.tariffRub)}
                        </span>
                      )}
                      {!!batch.freightPerKgUsd && (
                        <span className="block text-[10px] text-slate-400">
                          реально {chinaFreightPerKgLabel(batch.freightPerKgBase || '')}: {moneyWithRub(batch.freightPerKgUsd, '$', batch.freightPerKgRub)}
                        </span>
                      )}
                    </div>
                    <div><div className="text-xs text-slate-400 uppercase font-bold">Расходы РФ</div>{money(batch.rubCosts, '₽')}</div>
                    <div>
                      <div className="text-xs text-slate-400 uppercase font-bold">Курс товара</div>
                      {batch.rubRate || '—'}
                      {batch.rubRateSource && <span className="block text-[10px] text-slate-400">{chinaRateSourceLabel(batch.rubRateSource, batch.rubRateFrom || '', batch.rateFromPayment || '')}</span>}
                    </div>
                    {batch.freightRate !== undefined && (
                      <div>
                        <div className="text-xs text-slate-400 uppercase font-bold">Курс перевозки</div>
                        {batch.freightRate || '—'}
                        {batch.freightRateSource && <span className="block text-[10px] text-slate-400">{chinaRateSourceLabel(batch.freightRateSource, batch.rubRateFrom || '', batch.rateFromPayment || '')}</span>}
                      </div>
                    )}
                    {chinaShowWeightFactor(batch.weightFactor, batch.lines) && (
                      <div>
                        <div className="text-xs text-slate-400 uppercase font-bold">Коэффициент веса</div>
                        {batch.weightFactor}
                        <span className="block text-[10px] text-slate-400">во сколько раз вес по накладной больше суммы весов строк</span>
                      </div>
                    )}
                  </div>

                  {(batch.paidCny > 0 || batch.unpaidCny > 0) && (
                    <p className="text-sm text-slate-500">
                      По отчёту китайцев по заказу №{batch.orderNo || '—'}: оплачено {money(batch.paidCny, '¥')}
                      {batch.unpaidCny > 0 && <>, долг {money(batch.unpaidCny, '¥')}</>}
                      {' · '}
                      <span className={batch.rubRateSource ? 'text-slate-500' : 'text-amber-600'}>
                        {chinaRateStatusText(batch.rubRateSource, batch.rubRateFrom || '', batch.payments.length, batch.rateFromPayment || '')}
                      </span>
                    </p>
                  )}

                  {conflicts.length > 0 && (
                    <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      {conflicts.map((c, i) => <p key={i}>{c}</p>)}
                    </div>
                  )}

                  {!batch.closed && batch.missing && batch.missing.length > 0 && (
                    <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      <p className="font-bold">Чего не хватает для закрытого расчёта</p>
                      <ul className="list-disc list-inside">
                        {batch.missing.map((m, i) => <li key={i}>{m}</li>)}
                      </ul>
                    </div>
                  )}

                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <input
                      type="checkbox"
                      checked={!!batch.rubCostsDone}
                      onChange={(e) => setChinaRubCostsDone(batch.id, e.target.checked)}
                    />
                    Расходы в РФ внесены полностью
                  </label>

                  {batch.goodsKg > 0 && (
                    <div className="bg-slate-50 rounded-xl p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <h3 className="col-span-2 md:col-span-4 font-bold text-sm -mb-1">Упаковка и перевозка</h3>
                      <div>
                        <div className="text-xs text-slate-400 uppercase font-bold">Вес товара → упаковано</div>
                        {money(batch.goodsKg, 'кг')} → {money(batch.weightKg, 'кг')}
                        <span className="block text-[10px] text-slate-400">упаковка {money(batch.packagingKg, 'кг')}, +{money((batch.packagingKg / batch.goodsKg) * 100, '%')}</span>
                      </div>
                      <div>
                        <div className="text-xs text-slate-400 uppercase font-bold">Объём товара → упаковано</div>
                        {batch.goodsVolumeM3 > 0 ? (
                          <>
                            {money(batch.goodsVolumeM3, 'м³')} → {money(batch.volumeM3, 'м³')}
                            <span className="block text-[10px] text-slate-400">+{money((batch.packagingM3 / batch.goodsVolumeM3) * 100, '%')}</span>
                          </>
                        ) : '—'}
                      </div>
                      <div>
                        <div className="text-xs text-slate-400 uppercase font-bold">Плотность, кг/м³: в коробках фабрики → на паллетах</div>
                        {money(batch.goodsDensity, '')} → {money(batch.packedDensity, '')}
                      </div>
                      <div>
                        <div className="text-xs text-slate-400 uppercase font-bold">Тариф считается по</div>
                        {batch.tariffBasis || '—'}
                      </div>
                      <div>
                        <div className="text-xs text-slate-400 uppercase font-bold">Перевозка товара</div>
                        {money(batch.goodsFreightUsd, '$')} → {money(batch.goodsFreightRub, '₽')}
                        <span className="block text-[10px] text-slate-400">{money(batch.goodsFreightShareCost, '%')} себестоимости партии</span>
                      </div>
                      <div>
                        <div className="text-xs text-slate-400 uppercase font-bold">Перевозка упаковки</div>
                        {money(batch.packagingUsd, '$')} → {money(batch.packagingRub, '₽')}
                        <span className="block text-[10px] text-slate-400">
                          {money(batch.packagingShareFreight, '%')} перевозки, {money(batch.packagingShareCost, '%')} себестоимости
                        </span>
                      </div>
                      <div>
                        <div className="text-xs text-slate-400 uppercase font-bold">Дата приёмки в Китае</div>
                        {batch.receivedAt || '—'}
                      </div>
                    </div>
                  )}

                  {batch.weightFactor !== null && (batch.weightFactor < 0.8 || batch.weightFactor > 1.25)
                    && !batch.lines.every((l) => l.weightSource === 'приёмка' || l.weightSource === 'вручную') && (
                    <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      Оценка веса по паллетам расходится с накладной в {batch.weightFactor} раза.
                      Если знаете вес коробки — впишите его в строке, он важнее оценки.
                    </div>
                  )}

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-[11px] uppercase text-slate-400 text-left border-b border-slate-100">
                          <th className="py-2 pr-3">Маркировка</th>
                          <th className="py-2 pr-3">Коробок</th>
                          <th className="py-2 pr-3">Кол-во</th>
                          <th className="py-2 pr-3">Цена ¥</th>
                          <th className="py-2 pr-3">Сумма ¥</th>
                          <th className="py-2 pr-3">Вес, кг</th>
                          {hasBoxData && <th className="py-2 pr-3">Коробка Д×Ш×В, м</th>}
                          {hasBoxData && <th className="py-2 pr-3">Кг/коробка</th>}
                          {hasBoxData && <th className="py-2 pr-3">Кг/шт</th>}
                          {hasBoxData && <th className="py-2 pr-3">Плотность</th>}
                          <th className="py-2 pr-3">Перевозка</th>
                          <th className="py-2 pr-3">Расходы РФ ₽</th>
                          <th className="py-2 pr-3">Себестоимость ₽</th>
                          <th className="py-2 pr-3">₽ за штуку</th>
                          <th className="py-2 pr-3">Наш артикул</th>
                          <th className="py-2 pr-3">Один товар</th>
                        </tr>
                      </thead>
                      <tbody>
                        {batch.lines.map((line, index) => {
                          const draft = labelOf(line);
                          const levelled = levelledLines.has(index);
                          return (
                            <tr key={line.id} className="border-b border-slate-50">
                              <td className="py-2 pr-3 font-bold">
                                {line.marking}
                                {levelled && <span className="ml-2 text-[10px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">общая себестоимость</span>}
                              </td>
                              <td className="py-2 pr-3">{line.boxes}</td>
                              <td className="py-2 pr-3">{line.qty}</td>
                              <td className="py-2 pr-3">{line.priceCny}</td>
                              <td className="py-2 pr-3">{moneyWithRub(line.sumCny, '¥', line.goodsRub)}</td>
                              <td className="py-2 pr-3">
                                {line.weightKg}
                                <span className="block text-[10px] text-slate-400">{line.weightSource}</span>
                              </td>
                              {hasBoxData && (
                                <td className="py-2 pr-3">
                                  {line.boxLengthM > 0 ? `${line.boxLengthM}×${line.boxWidthM}×${line.boxHeightM}` : '—'}
                                </td>
                              )}
                              {hasBoxData && <td className="py-2 pr-3">{line.factoryBoxKg || '—'}</td>}
                              {hasBoxData && <td className="py-2 pr-3">{line.kgPerPiece || '—'}</td>}
                              {hasBoxData && <td className="py-2 pr-3">{line.densityKgM3 ? money(line.densityKgM3, '') : '—'}</td>}
                              <td className="py-2 pr-3">
                                {line.freightShareRub ? money(line.freightShareRub, '₽') : money(line.freightShareCny, '¥')}
                              </td>
                              <td className="py-2 pr-3">{money(line.rubShare, '₽')}</td>
                              <td className="py-2 pr-3">{money(line.costRub, '₽')}</td>
                              <td className="py-2 pr-3 font-bold">{money(line.unitRub, '₽')}</td>
                              <td className="py-2 pr-3">
                                <select
                                  className="px-2 py-1 border border-slate-200 rounded text-sm min-w-[220px]"
                                  value={draft.article}
                                  onChange={(e) => setArticleByMarking(batch, line, e.target.value)}
                                >
                                  <option value="">— выберите артикул —</option>
                                  {chinaArticleOptions(skus, draft.article).map((a) => (
                                    <option key={a} value={a}>{a}</option>
                                  ))}
                                </select>
                              </td>
                              <td className="py-2 pr-3">
                                <input
                                  className="px-2 py-1 border border-slate-200 rounded text-sm w-32"
                                  value={draft.group}
                                  onChange={(e) => setLabel(line, { group: e.target.value })}
                                  placeholder="одна метка"
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <p className="text-xs text-slate-500 max-w-2xl">
                      «Один товар» — для одинаковых товаров с разными артикулами: впишите в такие строки
                      одну и ту же метку (например «короб 8 шт»), и они получат общую себестоимость.
                      Строки с одинаковым артикулом выравниваются и без метки.
                    </p>
                    <button
                      data-testid="btn-save-china-labels"
                      onClick={() => saveLabels(batch)}
                      disabled={isSaving || (!labelsChanged(batch) && !costsChanged(batch))}
                      className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 disabled:opacity-40"
                    >
                      {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                      Сохранить артикулы и пересчитать
                    </button>
                  </div>

                  <div className="bg-slate-50 rounded-xl p-4 space-y-3">
                    <h3 className="font-bold text-sm">Расходы в рублях — делятся по коробкам</h3>
                    <p className="text-xs text-slate-500">
                      Строки ниже сохраняются вместе с артикулами, кнопкой «Сохранить артикулы и пересчитать» —
                      пустая строка (без суммы) не сохраняется.
                    </p>
                    <table className="w-full text-sm">
                      <tbody>
                        {costRowsOf(batch).map((row, i) => (
                          <tr key={row.id || `new-${i}`} className="border-b border-slate-200 last:border-0">
                            <td className="py-1.5 pr-3">
                              <select
                                className="px-2 py-1 border border-slate-200 rounded text-sm"
                                value={row.type}
                                onChange={(e) => setCostField(batch, i, { type: e.target.value })}
                              >
                                {CHINA_COST_TYPES.map((k) => <option key={k} value={k}>{k}</option>)}
                              </select>
                            </td>
                            <td className="py-1.5 pr-3">
                              <input
                                className="px-2 py-1 border border-slate-200 rounded text-sm w-28"
                                placeholder="Сумма, ₽"
                                value={row.amountRub}
                                onChange={(e) => setCostField(batch, i, { amountRub: e.target.value })}
                              />
                            </td>
                            <td className="py-1.5 pr-3">
                              <input
                                className="w-full px-2 py-1 border border-slate-200 rounded text-sm"
                                placeholder="Комментарий"
                                value={row.comment}
                                onChange={(e) => setCostField(batch, i, { comment: e.target.value })}
                              />
                            </td>
                            <td className="py-1.5 text-right">
                              <button onClick={() => removeCostRow(batch, i)} className="text-slate-300 hover:text-red-500">
                                <Trash2 size={15} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <button
                      data-testid="btn-add-china-cost-row"
                      onClick={() => addCostRow(batch)}
                      className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-bold text-indigo-600 hover:bg-indigo-50"
                    >
                      Добавить строку
                    </button>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => { setEditing(batch); setShowModal(true); }}
                      className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-bold text-slate-600 hover:text-indigo-600"
                    >
                      <Pencil size={16} /> Изменить партию
                    </button>
                    <button
                      onClick={() => askDeleteBatch(batch)}
                      className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-red-500 hover:text-red-600"
                    >
                      <Trash2 size={16} /> Удалить партию
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showModal && (
        <ChinaBatchModal
          batch={editing}
          initialForm={importForm}
          notes={importNotes}
          warnings={importWarnings}
          boxesOnly={importBoxesOnly}
          aiCheck={importAiCheck}
          onClose={() => {
            setShowModal(false);
            setEditing(null);
            setImportForm(null);
            setImportNotes([]);
            setImportWarnings([]);
            setImportBoxesOnly(false);
            setImportAiCheck(null);
          }}
        />
      )}
    </div>
  );
};
