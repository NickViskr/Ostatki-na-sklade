import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Plus, Save, Trash2, AlertTriangle, Calculator } from 'lucide-react';
import { toast } from 'sonner';
import { useChinaStore } from '../store/useChinaStore';
import { useUIStore } from '../store/useUIStore';
import { ChinaForecastFactFigure, ChinaForecastLine, ChinaForecastResult, ChinaSavedForecast } from '../types';
import { chinaNumber } from '../lib/chinaBatchForm';
import { chinaForecastDateText, chinaForecastPrefillSplit } from '../lib/chinaForecastView';
import { forecastPipelineStatus, forecastPipelineStatusLabel } from '../lib/factoryOrderDisplay';

const money = (value: number, currency: string): string =>
  `${(Number(value) || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

const money0 = (value: number, currency: string): string =>
  `${Math.round(Number(value) || 0).toLocaleString('ru-RU')} ${currency}`;

/** Owner's display rule: a ¥ or $ figure is always followed by its ₽ equivalent in brackets —
 * the ₽ is the script's own figure (`goodsRub`, `freightRubTypical`, …), never computed here. */
const moneyWithRub = (value: number, currency: string, rub?: number): string =>
  rub ? `${money(value, currency)} (${money(rub, '₽')})` : money(value, currency);

const errClass = (pct: number | null): string => {
  if (pct === null) return 'text-slate-400';
  const abs = Math.abs(pct);
  if (abs <= 10) return 'text-emerald-600';
  if (abs <= 25) return 'text-amber-600';
  return 'text-red-600';
};

interface CalcLine { article: string; pieces: string }
const emptyCalcLine = (): CalcLine => ({ article: '', pieces: '' });

const factCell = (f: ChinaForecastFactFigure, unit: string): React.ReactNode => {
  if (f.fact === null) return <span className="text-slate-400">партия ещё не пришла</span>;
  return (
    <span>
      {f.forecast} → {f.fact} {unit} <span className={`font-bold ${errClass(f.errorPct)}`}>({f.errorPct}%)</span>
    </span>
  );
};

/**
 * Item 82: the forecast screen of the module «Заказы в Китае» — a calculator for a future
 * shipment, its saved history compared against what actually arrived, the carrier's own tariff
 * history and the box directory. Every money figure comes from `calcChinaForecast`/
 * `getChinaForecastData`; nothing here multiplies a rate by an amount.
 */
export const ChinaForecastPanel: React.FC = () => {
  const forecastData = useChinaStore((s) => s.forecastData);
  const batches = useChinaStore((s) => s.batches);
  const forecastPrefill = useChinaStore((s) => s.forecastPrefill);
  const setForecastPrefill = useChinaStore((s) => s.setForecastPrefill);
  const fetchChinaForecastData = useChinaStore((s) => s.fetchChinaForecastData);
  const calcChinaForecast = useChinaStore((s) => s.calcChinaForecast);
  const saveChinaForecast = useChinaStore((s) => s.saveChinaForecast);
  const deleteChinaForecast = useChinaStore((s) => s.deleteChinaForecast);
  const isSaving = useChinaStore((s) => s.isSaving);
  const setConfirmDialog = useUIStore((s) => s.setConfirmDialog);

  const [open, setOpen] = useState(false);
  const [calcLines, setCalcLines] = useState<CalcLine[]>([emptyCalcLine()]);
  const [result, setResult] = useState<ChinaForecastResult | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [orderNo, setOrderNo] = useState('');
  const [expectedShipAt, setExpectedShipAt] = useState('');
  const [comment, setComment] = useState('');
  const [prefillMissing, setPrefillMissing] = useState<string[]>([]);
  const [openForecastId, setOpenForecastId] = useState('');
  const [tariffsOpen, setTariffsOpen] = useState(false);
  const [boxesOpen, setBoxesOpen] = useState(false);

  // Item 82: a prefill from the warehouse screen opens the card even if the owner had it closed.
  useEffect(() => {
    if (forecastPrefill) setOpen(true);
  }, [forecastPrefill]);

  useEffect(() => {
    if (open && !forecastData) fetchChinaForecastData();
  }, [open, forecastData, fetchChinaForecastData]);

  // Applies the prefill once the box directory is loaded, then clears it — the panel is the only
  // reader, so nothing else needs to know it was consumed.
  useEffect(() => {
    if (!forecastPrefill || !forecastData) return;
    const split = chinaForecastPrefillSplit(forecastPrefill, forecastData.boxes);
    if (split.known.length > 0) {
      setCalcLines(split.known.map((l) => ({ article: l.article, pieces: String(l.pieces) })));
      setResult(null);
    }
    setPrefillMissing(split.missing);
    setForecastPrefill(null);
  }, [forecastPrefill, forecastData, setForecastPrefill]);

  const boxOptions = useMemo(() => {
    const boxes = (forecastData && forecastData.boxes) || {};
    return Object.keys(boxes).sort((a, b) => a.localeCompare(b, 'ru'));
  }, [forecastData]);

  const setLine = (index: number, patch: Partial<CalcLine>) =>
    setCalcLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  const addLine = () => setCalcLines((prev) => [...prev, emptyCalcLine()]);
  const removeLine = (index: number) => setCalcLines((prev) => prev.filter((_, i) => i !== index));

  const filledLines = () =>
    calcLines
      .map((l) => ({ article: l.article.trim(), pieces: chinaNumber(l.pieces) }))
      .filter((l) => l.article && l.pieces > 0);

  const runCalc = async () => {
    const lines = filledLines();
    if (lines.length === 0) {
      toast.error('Добавьте хотя бы один артикул с количеством');
      return;
    }
    setIsCalculating(true);
    const res = await calcChinaForecast(lines);
    setIsCalculating(false);
    setResult(res);
  };

  const save = async () => {
    const lines = filledLines();
    if (lines.length === 0) return;
    const ok = await saveChinaForecast({ orderNo: orderNo.trim(), expectedShipAt, comment: comment.trim(), lines });
    if (ok) { setOrderNo(''); setExpectedShipAt(''); setComment(''); }
  };

  const askDelete = (forecast: ChinaSavedForecast) => {
    setConfirmDialog({
      show: true,
      title: 'Удалить прогноз?',
      message: `Прогноз ${forecast.orderNo ? `по заказу №${forecast.orderNo}` : 'без номера заказа'} от ${forecast.createdAt} будет удалён без возможности восстановить.`,
      onConfirm: async () => {
        setConfirmDialog({ show: false, title: '', message: '', onConfirm: () => {} });
        await deleteChinaForecast(forecast.id);
      }
    });
  };

  const savedForecasts = useMemo(() => {
    const list = (forecastData && forecastData.forecasts) || [];
    return list.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [forecastData]);

  // Coordinator fix, 2026-09-25: the switch density and the two medians come straight from
  // `tariffSummary` (the script's own `chinaTariffPick` formula) — no browser-side median, and
  // no dependency on a prior «Рассчитать» to show the chart's switch line.
  const tariffSummary = forecastData ? forecastData.tariffSummary : null;

  const chart = useMemo(() => {
    const tariffs = (forecastData && forecastData.tariffs) || [];
    const kgBills = tariffs.filter((t) => t.basis === 'кг' && t.densityKgM3 > 0);
    const m3Bills = tariffs.filter((t) => t.basis === 'м³' && t.densityKgM3 > 0);
    if (kgBills.length === 0 && m3Bills.length === 0) return null;
    const allDensities = tariffs.map((t) => t.densityKgM3).filter((d) => d > 0);
    const rates = kgBills.map((t) => t.rate);
    const maxDensity = Math.max(...allDensities, 1);
    const maxRate = Math.max(...rates, 1);
    const maxWeight = Math.max(...tariffs.map((t) => t.weightKg), 1);
    const W = 320, H = 160, PAD = 24;
    const xOf = (d: number) => PAD + (d / maxDensity) * (W - 2 * PAD);
    const yOf = (r: number) => H - PAD - (r / maxRate) * (H - 2 * PAD);
    const rOf = (kg: number) => 3 + 6 * Math.sqrt(kg / maxWeight);
    return { kgBills, m3Bills, W, H, PAD, xOf, yOf, rOf, maxDensity };
  }, [forecastData]);

  if (!open) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl">
        <button
          type="button"
          data-testid="btn-china-forecast-open"
          onClick={() => setOpen(true)}
          className="w-full flex items-center gap-2 px-5 py-4 text-left font-bold hover:bg-slate-50 rounded-xl"
        >
          <ChevronRight size={18} className="text-slate-400" />
          <Calculator size={16} className="text-indigo-600" /> Прогноз поставки
        </button>
      </div>
    );
  }

  const totals = result ? result.totals : null;
  const field = 'block px-3 py-2 border border-slate-200 rounded-lg text-sm';

  return (
    <div className="bg-white border border-slate-200 rounded-xl">
      <button
        type="button"
        data-testid="btn-china-forecast-close"
        onClick={() => setOpen(false)}
        className="w-full flex items-center gap-2 px-5 py-4 text-left font-bold hover:bg-slate-50"
      >
        <ChevronDown size={18} className="text-slate-400" />
        <Calculator size={16} className="text-indigo-600" /> Прогноз поставки
      </button>

      {!forecastData && (
        <div className="px-5 pb-5 flex items-center gap-2 text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin" /> Читаем тарифы и справочник коробок…
        </div>
      )}

      {forecastData && (
        <div className="border-t border-slate-100 p-5 space-y-8">
          {/* a. Калькулятор */}
          <div className="space-y-3">
            <h3 className="font-bold text-sm">Калькулятор</h3>

            {prefillMissing.length > 0 && (
              <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Нет коробки в справочнике: {prefillMissing.join(', ')}
              </div>
            )}

            <div className="space-y-2">
              {calcLines.map((line, i) => (
                <div key={i} className="flex items-center gap-2 flex-wrap">
                  <select
                    data-testid={`select-china-forecast-article-${i}`}
                    className="px-2 py-1.5 border border-slate-200 rounded text-sm min-w-[260px]"
                    value={line.article}
                    onChange={(e) => setLine(i, { article: e.target.value })}
                  >
                    <option value="">— выберите артикул —</option>
                    {boxOptions.map((a) => {
                      const box = forecastData.boxes[a];
                      return (
                        <option key={a} value={a}>
                          {a}{box.name ? ` — ${box.name}` : ''} ({box.pcsPerBox} шт в коробке)
                        </option>
                      );
                    })}
                  </select>
                  <input
                    className="px-2 py-1.5 border border-slate-200 rounded text-sm w-28"
                    placeholder="штук"
                    value={line.pieces}
                    onChange={(e) => setLine(i, { pieces: e.target.value })}
                  />
                  {calcLines.length > 1 && (
                    <button onClick={() => removeLine(i)} className="text-slate-300 hover:text-red-500">
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={addLine}
                className="flex items-center gap-1 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-600 hover:text-indigo-600"
              >
                <Plus size={14} /> Строка
              </button>
              <button
                data-testid="btn-china-forecast-calc"
                onClick={runCalc}
                disabled={isCalculating}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 disabled:opacity-50"
              >
                {isCalculating ? <Loader2 size={16} className="animate-spin" /> : <Calculator size={16} />}
                Рассчитать
              </button>
            </div>

            {result && (
              <div className="space-y-4 pt-2">
                {result.warnings.length > 0 && (
                  <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-1">
                    {result.warnings.map((w, i) => <p key={i} className="flex items-center gap-2"><AlertTriangle size={14} /> {w}</p>)}
                  </div>
                )}

                <div className="space-y-2">
                  {result.lines.map((line: ChinaForecastLine, i) => (
                    <div key={i} className="bg-slate-50 rounded-lg p-3 text-sm">
                      <div className="font-bold">{line.article} · {line.pieces} шт</div>
                      {line.warning ? (
                        <p className="text-amber-600">{line.warning}</p>
                      ) : (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-1 text-xs">
                          <div>{line.boxes} коробок{!!line.missingToFullBox && <span className="block text-amber-600">до полной коробки не хватает {line.missingToFullBox} шт</span>}</div>
                          <div>вес товара {money(line.kg || 0, 'кг')}</div>
                          <div>товар {moneyWithRub(line.goodsCny || 0, '¥', line.goodsRub)}</div>
                          <div>
                            перевозка {moneyWithRub(line.freightUsdTypical || 0, '$', line.freightRubTypical)}
                            <span className="block text-slate-400">
                              от {moneyWithRub(line.freightUsdLow || 0, '$', line.freightRubLow)} до {moneyWithRub(line.freightUsdHigh || 0, '$', line.freightRubHigh)}
                            </span>
                          </div>
                          <div className="col-span-2 md:col-span-4 font-bold">
                            {money(line.costPerPieceTypical || 0, '₽')} за штуку
                            <span className="font-normal text-slate-400"> · от {money(line.costPerPieceLow || 0, '₽')} до {money(line.costPerPieceHigh || 0, '₽')}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {totals && (
                  <div className="bg-slate-50 rounded-xl p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <h4 className="col-span-2 md:col-span-4 font-bold text-sm -mb-1">Итого</h4>
                    <div>
                      <div className="text-xs text-slate-400 uppercase font-bold">Товар → накладная</div>
                      {money(totals.goodsKg, 'кг')} → {money(totals.chargeableKg, 'кг')}
                      {totals.goodsM3 > 0 && <span className="block text-[11px] text-slate-400">{money(totals.goodsM3, 'м³')} → {money(totals.chargeableM3, 'м³')}</span>}
                    </div>
                    <div>
                      <div className="text-xs text-slate-400 uppercase font-bold">Плотность по накладной</div>
                      {money(totals.chargeableDensityKgM3, 'кг/м³')}
                      <span className="block text-[11px] text-slate-400">считается по {result.pick.basis}</span>
                    </div>
                    <div>
                      <div className="text-xs text-slate-400 uppercase font-bold">Тариф карго</div>
                      {result.pick.empty ? result.pick.message : (
                        <>
                          {money(result.pick.typicalUsd, `$/${result.pick.basis}`)}
                          <span className="block text-[11px] text-slate-400">от {money(result.pick.lowUsd, '$')} до {money(result.pick.highUsd, '$')}</span>
                          <span className="block text-[11px] text-slate-400">похожие партии: {result.pick.codes.join(', ') || '—'}</span>
                        </>
                      )}
                    </div>
                    <div>
                      <div className="text-xs text-slate-400 uppercase font-bold">Надбавка перевозчика</div>
                      {money(result.pick.extrasPct, '%')}
                    </div>
                    <div>
                      <div className="text-xs text-slate-400 uppercase font-bold">Доставка по Китаю</div>
                      {moneyWithRub(totals.domesticCny, '¥', totals.domesticRub)}
                    </div>
                    <div>
                      <div className="text-xs text-slate-400 uppercase font-bold">Расходы в РФ</div>
                      {money(totals.russianCosts, '₽')}
                    </div>
                    <div>
                      <div className="text-xs text-slate-400 uppercase font-bold">Курс ₽/¥</div>
                      {result.rubRate || '—'}
                      {result.rubRateSource && <span className="block text-[11px] text-slate-400">{result.rubRateSource}</span>}
                    </div>
                    <div>
                      <div className="text-xs text-slate-400 uppercase font-bold">Курс карго ¥/$</div>
                      {result.cargoRate || '—'}
                    </div>
                    <div>
                      <div className="text-xs text-slate-400 uppercase font-bold">Упаковка (по партиям)</div>
                      вес × {result.packagingFactors.weightFactor} (N={result.packagingFactors.weightFactorN})
                      <span className="block text-[11px] text-slate-400">объём × {result.packagingFactors.volumeFactor} (N={result.packagingFactors.volumeFactorN})</span>
                    </div>
                    <div>
                      <div className="text-xs text-slate-400 uppercase font-bold">Ожидаемое прибытие</div>
                      {result.estimatedArrival ? chinaForecastDateText(result.estimatedArrival) : '—'}
                    </div>
                    <div className="col-span-2 md:col-span-4 font-bold text-base">
                      {money0(totals.costRubTypical, '₽')} себестоимость
                      <span className="font-normal text-slate-400 text-sm"> · от {money0(totals.costRubLow, '₽')} до {money0(totals.costRubHigh, '₽')}</span>
                    </div>
                  </div>
                )}

                <div className="flex items-end gap-2 flex-wrap">
                  <label className="block">
                    <span className="text-[11px] font-bold text-slate-500 uppercase">Номер заказа</span>
                    <input className={`${field} w-40`} value={orderNo} onChange={(e) => setOrderNo(e.target.value)} placeholder="необязательно" />
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-bold text-slate-500 uppercase">Ожидаемая отгрузка с фабрики</span>
                    <input
                      type="date"
                      className={`${field} w-40`}
                      value={expectedShipAt}
                      onChange={(e) => setExpectedShipAt(e.target.value)}
                    />
                  </label>
                  <label className="block grow">
                    <span className="text-[11px] font-bold text-slate-500 uppercase">Комментарий</span>
                    <input className={`${field} w-full`} value={comment} onChange={(e) => setComment(e.target.value)} />
                  </label>
                  <button
                    data-testid="btn-china-forecast-save"
                    onClick={save}
                    disabled={isSaving}
                    className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-bold text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"
                  >
                    {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    Сохранить прогноз
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* b. Сохранённые прогнозы */}
          <div className="space-y-2">
            <h3 className="font-bold text-sm">Сохранённые прогнозы</h3>
            {savedForecasts.length === 0 && <p className="text-sm text-slate-400">Прогнозов пока нет.</p>}
            {savedForecasts.map((f) => {
              const isOpenF = openForecastId === f.id;
              const costTypical = f.result.totals ? f.result.totals.costRubTypical : 0;
              // Item 83b: a forecast with both an order number and a ship date enters the
              // pipeline as 'Китай прогноз' rows — until a real batch of the same order arrives,
              // when the batch replaces them (one order ships as one batch).
              const hasBatchOfOrder = !!f.orderNo && batches.some((b) => b.orderNo === f.orderNo);
              const pipelineStatus = forecastPipelineStatus({ orderNo: f.orderNo, expectedShipAt: f.expectedShipAt }, hasBatchOfOrder);
              return (
                <div key={f.id} className="border border-slate-100 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setOpenForecastId(isOpenF ? '' : f.id)}
                    className="w-full flex items-center gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50"
                  >
                    {isOpenF ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
                    <span className="font-bold">{f.orderNo ? `заказ №${f.orderNo}` : '(без номера заказа)'}</span>
                    <span className="text-slate-400">{f.createdAt}</span>
                    <span className="text-slate-400">{f.lines.length} артикулов</span>
                    {f.expectedShipAt && <span className="text-slate-400">отгрузка {f.expectedShipAt}</span>}
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                        pipelineStatus === 'inPipeline' ? 'bg-sky-50 text-sky-700' :
                        pipelineStatus === 'replaced' ? 'bg-slate-100 text-slate-500' : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {forecastPipelineStatusLabel(pipelineStatus)}
                    </span>
                    <span className="grow" />
                    <span className="font-bold">{money0(costTypical, '₽')}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); askDelete(f); }}
                      className="text-slate-300 hover:text-red-500"
                    >
                      <Trash2 size={15} />
                    </button>
                  </button>
                  {isOpenF && (
                    <div className="border-t border-slate-100 p-3 overflow-x-auto">
                      {f.comment && <p className="text-xs text-slate-500 mb-2">{f.comment}</p>}
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-[11px] uppercase text-slate-400 text-left border-b border-slate-100">
                            <th className="py-1.5 pr-3">Артикул</th>
                            <th className="py-1.5 pr-3">Штук</th>
                            <th className="py-1.5 pr-3">Вес, кг</th>
                            <th className="py-1.5 pr-3">Перевозка $</th>
                            <th className="py-1.5 pr-3">₽ за штуку</th>
                          </tr>
                        </thead>
                        <tbody>
                          {f.fact.map((row) => (
                            <tr key={row.article} className="border-b border-slate-50">
                              <td className="py-1.5 pr-3 font-bold">{row.article}</td>
                              <td className="py-1.5 pr-3">{factCell(row.pieces, 'шт')}</td>
                              <td className="py-1.5 pr-3">{factCell(row.kg, 'кг')}</td>
                              <td className="py-1.5 pr-3">{factCell(row.freightUsd, '$')}</td>
                              <td className="py-1.5 pr-3">{factCell(row.costPerPiece, '₽')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* c. Тарифы карго */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setTariffsOpen((v) => !v)}
              className="flex items-center gap-2 font-bold text-sm hover:text-indigo-600"
            >
              {tariffsOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              Тарифы карго ({forecastData.tariffs.length})
            </button>
            {tariffsOpen && (
              <div className="space-y-3">
                {chart && (
                  <div className="bg-slate-50 rounded-lg p-3">
                    <svg width={chart.W} height={chart.H} className="block">
                      {tariffSummary && tariffSummary.switchDensity !== null && (
                        <line
                          x1={chart.xOf(tariffSummary.switchDensity)} x2={chart.xOf(tariffSummary.switchDensity)}
                          y1={chart.PAD} y2={chart.H - chart.PAD}
                          stroke="#94a3b8" strokeDasharray="4 4"
                        />
                      )}
                      {chart.kgBills.map((t) => (
                        <circle key={t.code} cx={chart.xOf(t.densityKgM3)} cy={chart.yOf(t.rate)} r={chart.rOf(t.weightKg)}
                          fill="#6366f1" fillOpacity={0.6} />
                      ))}
                      {chart.m3Bills.map((t) => (
                        <rect key={t.code} x={chart.xOf(t.densityKgM3) - 3} y={chart.H - chart.PAD - 6} width={6} height={6}
                          fill="#f59e0b" />
                      ))}
                    </svg>
                    <p className="text-xs text-slate-500 mt-1">
                      круг — тариф по весу ($/кг), размер по весу партии; квадрат — партия, тарифицированная по объёму (м³)
                      {tariffSummary && tariffSummary.switchDensity !== null && <> · пунктир — граница {money(tariffSummary.switchDensity, 'кг/м³')}</>}
                    </p>
                  </div>
                )}
                <p className="text-sm text-slate-500">
                  {tariffSummary && tariffSummary.transitDays !== null && <>медиана в пути {tariffSummary.transitDays} дн. </>}
                  {tariffSummary && <>· медиана надбавки {money(tariffSummary.extrasPct, '%')} (по {tariffSummary.n} партиям) </>}
                  {tariffSummary && tariffSummary.switchDensity !== null && <>· ниже ~{money(tariffSummary.switchDensity, 'кг/м³')} карго считает по объёму</>}
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[11px] uppercase text-slate-400 text-left border-b border-slate-100">
                        <th className="py-1.5 pr-3">Код</th>
                        <th className="py-1.5 pr-3">Заказ</th>
                        <th className="py-1.5 pr-3">Отгружена</th>
                        <th className="py-1.5 pr-3">Дней в пути</th>
                        <th className="py-1.5 pr-3">Тариф</th>
                        <th className="py-1.5 pr-3">Вес, кг</th>
                        <th className="py-1.5 pr-3">Объём, м³</th>
                        <th className="py-1.5 pr-3">Плотность</th>
                        <th className="py-1.5 pr-3">Надбавка</th>
                        <th className="py-1.5 pr-3">Реально $/кг</th>
                      </tr>
                    </thead>
                    <tbody>
                      {forecastData.tariffs.map((t) => (
                        <tr key={t.code} className="border-b border-slate-50">
                          <td className="py-1.5 pr-3 font-bold">{t.code}</td>
                          <td className="py-1.5 pr-3">{t.orderNo || '—'}</td>
                          <td className="py-1.5 pr-3">{t.shippedAt}</td>
                          <td className="py-1.5 pr-3">{t.transitDays === null ? '—' : t.transitDays}</td>
                          <td className="py-1.5 pr-3">{money(t.rate, `$/${t.basis}`)}</td>
                          <td className="py-1.5 pr-3">{t.weightKg}</td>
                          <td className="py-1.5 pr-3">{t.volumeM3}</td>
                          <td className="py-1.5 pr-3">{t.densityKgM3}</td>
                          <td className="py-1.5 pr-3">{money(t.extrasPct, '%')}</td>
                          <td className="py-1.5 pr-3">{money(t.realPerKgUsd, '$')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* d. Справочник коробок */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setBoxesOpen((v) => !v)}
              className="flex items-center gap-2 font-bold text-sm hover:text-indigo-600"
            >
              {boxesOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              Справочник коробок ({boxOptions.length})
            </button>
            {boxesOpen && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase text-slate-400 text-left border-b border-slate-100">
                      <th className="py-1.5 pr-3">Артикул</th>
                      <th className="py-1.5 pr-3">Название</th>
                      <th className="py-1.5 pr-3">Коробка Д×Ш×В, м</th>
                      <th className="py-1.5 pr-3">Кг/коробка</th>
                      <th className="py-1.5 pr-3">Шт в коробке</th>
                      <th className="py-1.5 pr-3">Кг/шт</th>
                      <th className="py-1.5 pr-3">Плотность</th>
                      <th className="py-1.5 pr-3">Цена фабрики</th>
                      <th className="py-1.5 pr-3">Партий</th>
                    </tr>
                  </thead>
                  <tbody>
                    {boxOptions.map((a) => {
                      const box = forecastData.boxes[a];
                      return (
                        <tr key={a} className="border-b border-slate-50">
                          <td className="py-1.5 pr-3 font-bold">
                            {a}
                            {box.changed && <span className="ml-2 text-[10px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">коробка менялась</span>}
                          </td>
                          <td className="py-1.5 pr-3">{box.name}</td>
                          <td className="py-1.5 pr-3">{box.boxLengthM}×{box.boxWidthM}×{box.boxHeightM}</td>
                          <td className="py-1.5 pr-3">{box.boxKg}</td>
                          <td className="py-1.5 pr-3">{box.pcsPerBox}</td>
                          <td className="py-1.5 pr-3">{box.kgPerPiece}</td>
                          <td className="py-1.5 pr-3">{box.densityKgM3}</td>
                          <td className="py-1.5 pr-3">{money(box.priceCny, '¥')} <span className="text-[10px] text-slate-400">цена фабрики</span></td>
                          <td className="py-1.5 pr-3">{box.batches}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
