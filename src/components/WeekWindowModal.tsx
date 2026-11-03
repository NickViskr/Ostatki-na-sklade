import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { ContractorInvoice, WeekPackagingOperationInfo, WeekPackagingState } from '../types';
import { formatKopecks } from '../lib/contractorInvoice';
import { invoiceWeekOptions, isoWeekLabel } from '../lib/isoWeek';
import {
  invoiceLineIsPackaging, invoicePackagingTotalKop, step1TotalKop, weekArticleSummary, weekPackagingTargets
} from '../lib/weekPackaging';
import { ContractorInvoiceModal } from './ContractorInvoiceModal';

/** Kopecks -> «1 176,00 ₽» (kopeck integers only, no floating point money). */
const kopText = (kop: number): string => {
  const sign = kop < 0 ? '−' : '';
  const abs = Math.abs(kop);
  const rubles = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${sign}${rubles},${String(abs % 100).padStart(2, '0')} ₽`;
};

const overrideKey = (opId: string, article: string) => `${opId}\u0000${article}`;
const inputCls = 'border border-slate-200 rounded-lg px-2 py-1 text-sm text-right';

interface Props {
  /** The week selected in the supplies filter (used as the default when it is a week of the window). */
  initialWeek: string;
  onClose: () => void;
}

/** Item 97 ticket 06: the week window. Step 1 = packaging/stickering per article; step 2 comes in ticket 07. */
export const WeekWindowModal: React.FC<Props> = ({ initialWeek, onClose }) => {
  const getWeekPackaging = useWarehouseStore((s) => s.getWeekPackaging);
  const saveWeekPackaging = useWarehouseStore((s) => s.saveWeekPackaging);
  const setInvoiceLinePackaging = useWarehouseStore((s) => s.setInvoiceLinePackaging);
  const listContractorInvoices = useWarehouseStore((s) => s.listContractorInvoices);
  const role = (useWarehouseStore((s) => s.currentUser?.role) || '').toLowerCase();
  const isAdmin = role === 'admin' || role === 'администратор';

  const weekOptions = useMemo(() => invoiceWeekOptions(Date.now()), []);
  const [week, setWeek] = useState<string>(weekOptions.includes(initialWeek) ? initialWeek : weekOptions[0] || '');
  const [state, setState] = useState<WeekPackagingState | null>(null);
  const [invoices, setInvoices] = useState<ContractorInvoice[]>([]);
  const [loadError, setLoadError] = useState('');
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [invoiceModal, setInvoiceModal] = useState<ContractorInvoice | null>(null);

  const loadInvoices = useCallback(async () => {
    if (week) setInvoices(await listContractorInvoices(week));
  }, [listContractorInvoices, week]);

  // (Re)load the week; prices are prefilled: saved of this week -> latest earlier week -> empty.
  const loadWeek = useCallback(async () => {
    if (!week) return;
    setLoadError('');
    try {
      const [data, inv] = await Promise.all([getWeekPackaging(week), listContractorInvoices(week)]);
      const nextPrices: Record<string, string> = {};
      for (const { article } of weekArticleSummary(data.operations)) {
        const savedPrice = data.saved?.prices.find((p) => p.article === article)?.unit;
        nextPrices[article] = savedPrice ?? data.lastPrices?.[article] ?? '';
      }
      const nextOverrides: Record<string, string> = {};
      for (const o of data.saved?.overrides || []) nextOverrides[overrideKey(o.opId, o.article)] = o.unit;
      setPrices(nextPrices);
      setOverrides(nextOverrides);
      setState(data);
      setInvoices(inv);
    } catch (e) {
      setLoadError((e as Error).message || 'Не удалось загрузить окно недели');
    }
  }, [getWeekPackaging, listContractorInvoices, week]);

  useEffect(() => {
    setState(null); setInvoices([]); setExpanded(new Set());
    loadWeek();
  }, [loadWeek]);

  const operations = state?.operations || [];
  const summary = useMemo(() => weekArticleSummary(operations), [operations]);

  // Empty inputs are not sent: an article without a price is then reported as «missing».
  const priceList = useMemo(
    () => Object.entries(prices).filter(([, unit]) => unit.trim() !== '').map(([article, unit]) => ({ article, unit })),
    [prices]
  );
  const overrideList = useMemo(
    () => Object.entries(overrides).filter(([, unit]) => unit.trim() !== '').map(([key, unit]) => {
      const [opId, article] = key.split('\u0000');
      return { opId, article, unit };
    }),
    [overrides]
  );
  const targets = useMemo(() => weekPackagingTargets(operations, priceList, overrideList), [operations, priceList, overrideList]);
  const articleSumKop = (article: string): number | null => {
    const rows = targets.rows.filter((r) => r.article === article);
    const articleQty = summary.find((s) => s.article === article)?.qty ?? 0;
    return rows.reduce((sum, r) => sum + r.quantity, 0) === articleQty ? step1TotalKop(rows) : null;
  };

  const step1Kop = step1TotalKop(targets.rows);
  const invoiceKop = useMemo(() => invoicePackagingTotalKop(invoices.map((inv) => ({
    lines: inv.lines.map((l) => ({ name: l.name, sum: formatKopecks(Math.round(l.sum * 100)), packaging: l.packaging }))
  }))), [invoices]);

  const conflictOps = operations.filter((op) => op.weekConflict && op.weekConflict.length > 0);
  const lockedForUser = !isAdmin && !!state?.saved;
  const problems: string[] = [];
  if (targets.missing.length > 0) problems.push(`Нет цены: ${targets.missing.join(', ')}`);
  if (targets.invalid.length > 0) problems.push(`Неверная цена: ${targets.invalid.join(', ')}`);
  if (conflictOps.length > 0) problems.push('Есть поставки, которые попали в разные недели — поставьте «Неделю вручную»');
  const canSave = !!state && operations.length > 0 && problems.length === 0 && !saving && !lockedForUser;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const res = await saveWeekPackaging({ week, prices: priceList, overrides: overrideList });
      if (res.status !== 'success') { toast.error(res.message || 'Не удалось сохранить упаковку'); return; }
      const d = res.data || {};
      if (d.costJournalError) toast.error(String(d.costJournalError));
      toast.success(`Упаковка недели сохранена, изменено строк: ${d.changedRows || 0}`);
      await loadWeek();
    } finally {
      setSaving(false);
    }
  };

  const handleLineMark = async (inv: ContractorInvoice, lineNo: number, packaging: boolean) => {
    const res = await setInvoiceLinePackaging({ invoiceId: inv.id, lineNo, packaging });
    if (res.status !== 'success') toast.error(res.message || 'Не удалось изменить отметку');
    await loadInvoices();
  };

  const toggleExpanded = (article: string) =>
    setExpanded((prev) => { const next = new Set(prev); if (next.has(article)) next.delete(article); else next.add(article); return next; });

  const operationsOf = (article: string): WeekPackagingOperationInfo[] =>
    operations.filter((op) => op.rows.some((r) => !r.isComponent && r.article === article));
  const opArticleQty = (op: WeekPackagingOperationInfo, article: string) =>
    op.rows.filter((r) => !r.isComponent && r.article === article).reduce((sum, r) => sum + r.quantity, 0);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-2 sm:p-4">
      <div className="bg-white rounded-2xl w-full max-w-5xl h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <span className="font-bold text-slate-800">Окно недели</span>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-800 font-bold cursor-pointer">Закрыть</button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-5">
          <label className="flex items-center gap-2 text-sm">
            <span className="font-bold text-slate-500">Неделя</span>
            <select
              value={week}
              onChange={(e) => setWeek(e.target.value)}
              className="px-3 py-2 rounded-xl text-sm font-bold border border-slate-200 bg-white text-slate-600"
            >
              {weekOptions.map((w) => <option key={w} value={w}>{isoWeekLabel(w)}</option>)}
            </select>
          </label>

          {loadError && <div className="text-sm text-red-600">{loadError}</div>}

          <section className="space-y-1">
            <div className="text-sm font-bold text-slate-500">Счета недели</div>
            {invoices.length === 0 ? (
              <div className="text-sm text-slate-400">Счетов нет</div>
            ) : invoices.map((inv) => (
              <div key={inv.id} className="border border-slate-100 rounded-xl p-2 space-y-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="font-bold text-slate-700">№ {inv.number} от {inv.date}</span>
                  <span className="text-slate-400">{inv.supplier}</span>
                  <span className="font-bold text-slate-700">{kopText(Math.round(Number(inv.total) * 100))}</span>
                  <button onClick={() => setInvoiceModal(inv)} className="text-indigo-600 font-bold hover:underline cursor-pointer">Открыть</button>
                </div>
                {inv.lines.map((l) => (
                  <label key={l.n} className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={invoiceLineIsPackaging(l)}
                      onChange={(e) => handleLineMark(inv, l.n, e.target.checked)}
                    />
                    <span className="flex-1 min-w-0 break-words">{l.name}</span>
                    <span className="font-bold text-slate-700">{kopText(Math.round(l.sum * 100))}</span>
                    <span className="text-xs text-slate-400">упаковка</span>
                  </label>
                ))}
              </div>
            ))}
          </section>

          <section className="space-y-2">
            <div className="text-sm font-bold text-slate-500">Шаг 1 — упаковка/стикеровка</div>
            {state && operations.length === 0 && <div className="text-sm text-slate-400">В этой неделе нет списанных поставок</div>}
            {!state && !loadError && <div className="text-sm text-slate-400">Загружаю…</div>}

            {conflictOps.map((op) => (
              <div key={op.opId} className="text-sm text-red-600">
                {op.cabinet} {op.orderNumbers.join(', ') || op.opId}: поставка попала в разные недели ({op.weekConflict!.join(', ')}) — поставьте «Неделю вручную»
              </div>
            ))}

            {summary.length > 0 && (
              <div className="space-y-1">
                <div className="hidden sm:grid grid-cols-[1fr_6rem_8rem_9rem_5rem] gap-2 text-xs font-bold text-slate-500">
                  <span>Артикул</span><span className="text-right">шт за неделю</span><span className="text-right">₽/шт</span><span className="text-right">Сумма</span><span />
                </div>
                {summary.map(({ article, qty }) => {
                  const sumKop = articleSumKop(article);
                  const isOpen = expanded.has(article);
                  return (
                    <div key={article} className="border-b border-slate-100 pb-1">
                      <div className="grid grid-cols-2 sm:grid-cols-[1fr_6rem_8rem_9rem_5rem] gap-2 items-center text-sm">
                        <span className="font-bold text-slate-700 break-all">{article}</span>
                        <span className="text-right text-slate-600">{qty}</span>
                        <input
                          className={inputCls}
                          placeholder="₽/шт"
                          disabled={lockedForUser}
                          value={prices[article] ?? ''}
                          onChange={(e) => setPrices((p) => ({ ...p, [article]: e.target.value }))}
                        />
                        <span className="text-right font-bold text-slate-700">{sumKop === null ? '—' : kopText(sumKop)}</span>
                        <button onClick={() => toggleExpanded(article)} className="text-indigo-600 font-bold hover:underline cursor-pointer text-left">
                          {isOpen ? 'Свернуть' : 'По поставкам'}
                        </button>
                      </div>
                      {isOpen && (
                        <div className="mt-1 ml-3 space-y-1">
                          {operationsOf(article).map((op) => (
                            <div key={op.opId} className="space-y-0.5">
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600">
                                <span>{op.cabinet}</span>
                                <span>{op.orderNumbers.length > 0 ? op.orderNumbers.join(', ') : op.opId}</span>
                                <span className="text-slate-400">{op.auto ? 'авто' : 'вручную'}</span>
                                <span className="font-bold">{opArticleQty(op, article)} шт</span>
                                <input
                                  className={`${inputCls} w-28`}
                                  placeholder="своя цена"
                                  disabled={lockedForUser}
                                  value={overrides[overrideKey(op.opId, article)] ?? ''}
                                  onChange={(e) => setOverrides((o) => ({ ...o, [overrideKey(op.opId, article)]: e.target.value }))}
                                />
                              </div>
                              {op.weekConflict && op.weekConflict.length > 0 && (
                                <div className="text-xs text-red-600">Поставка в разных неделях ({op.weekConflict.join(', ')}) — поставьте «Неделю вручную»</div>
                              )}
                              {op.textPackaging > 0 && (
                                <div className="text-xs text-amber-600">упаковка из списания {kopText(Math.round(op.textPackaging * 100))} будет заменена</div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="text-sm space-y-0.5">
              <div className="text-slate-700">Итог шага 1: <span className="font-bold">{kopText(step1Kop)}</span></div>
              <div className="text-slate-700">Упаковка в счетах: <span className="font-bold">{kopText(invoiceKop)}</span></div>
              <div className="text-slate-700">Разница: <span className="font-bold">{kopText(step1Kop - invoiceKop)}</span></div>
              {problems.map((m, i) => <div key={i} className="text-red-600">{m}</div>)}
              {lockedForUser && <div className="text-slate-500">Изменить сохранённую упаковку может только администратор</div>}
              {state?.saved && <div className="text-xs text-slate-400">Сохранено: {state.saved.savedBy}, {state.saved.savedAt}</div>}
            </div>
            <button
              onClick={handleSave}
              disabled={!canSave}
              className={`px-4 py-2 rounded-xl font-bold ${canSave ? 'bg-indigo-600 text-white hover:bg-indigo-700 cursor-pointer' : 'bg-slate-100 text-slate-400'}`}
            >
              {saving ? 'Сохраняю…' : 'Сохранить'}
            </button>
          </section>

          <section className="space-y-1">
            <div className="text-sm font-bold text-slate-500">Шаг 2 — распределение счёта</div>
            <div className="text-sm text-slate-400">будет в следующем обновлении</div>
          </section>
        </div>
      </div>
      {invoiceModal && (
        <ContractorInvoiceModal
          week={invoiceModal.week}
          file={null}
          saved={invoiceModal}
          onClose={() => setInvoiceModal(null)}
          onSaved={loadWeek}
        />
      )}
    </div>
  );
};
