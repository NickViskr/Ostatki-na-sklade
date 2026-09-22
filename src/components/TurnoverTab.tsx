import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Columns3, HelpCircle, RefreshCw, Search, Send, Settings } from 'lucide-react';
import { toast } from 'sonner';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { formatCurrency, formatDateRu } from '../lib/utils';
import { ArticleTurnover, buildTurnover, gmroiTone, GmroiTone, shelfFromStock, TurnoverStatus } from '../lib/turnover';
import { buildTurnoverSnapshot, TURNOVER_PRESETS, TURNOVER_SYSTEM_PROMPT } from '../lib/turnoverPrompt';
import { OzonSettingsModal } from './OzonSettingsModal';

/**
 * Item 78c/78d (2026-09-21): capital turnover of the whole business, Ozon plus the own
 * warehouse, and an AI window that reads the same figures. The arithmetic is in
 * src/lib/turnover.ts; the model's context in src/lib/turnoverPrompt.ts.
 */

const STATUS_LABEL: Record<TurnoverStatus, string> = { fast: 'лидер', normal: 'норма', slow: 'медленно', component: 'компонент набора' };
const GMROI_CLASS: Record<GmroiTone, string> = { green: 'text-emerald-600 font-bold', yellow: 'text-amber-600 font-bold', red: 'text-red-600 font-bold', none: 'text-slate-400' };
const STATUS_CLASS: Record<TurnoverStatus, string> = {
  fast: 'bg-emerald-100 text-emerald-700',
  normal: 'bg-slate-100 text-slate-600',
  slow: 'bg-red-100 text-red-700',
  component: 'bg-amber-50 text-amber-700',
};

type Filter = 'all' | TurnoverStatus;

// Owner 2026-09-22: this table has its own «Колонки» picker, independent of the one on «Склад».
// The choice is remembered per user in the browser under its own key.
const TURNOVER_COLS: { key: string; label: string; title: string }[] = [
  { key: 'turns', label: 'Оборот, раз', title: 'Себестоимость продаж ÷ средний капитал за период' },
  { key: 'daysPerTurn', label: 'Дн. на оборот', title: 'Период ÷ оборот' },
  { key: 'gmroi', label: 'GMROI', title: 'Валовая прибыль ÷ средний капитал' },
  { key: 'cover', label: 'Покрытие, дн.', title: '(склад + Ozon, шт) ÷ выкупов в день' },
  { key: 'age', label: 'Возраст, дн.', title: 'Дней с последней продажи на Ozon; без продаж — с последнего прихода' },
  { key: 'shelf', label: 'Склад', title: 'Остаток на складе × себестоимость (резерв входит)' },
  { key: 'ozon', label: 'Ozon', title: 'Остаток на Ozon по себестоимости + в доставке + возвраты' },
  { key: 'avgCapital', label: 'Средний капитал', title: 'Средний за период капитал: склад + Ozon' },
  { key: 'sold', label: 'Продано', title: 'Выкуплено за период, шт' },
];
const TURNOVER_COLS_KEY = (user: string) => `turnoverCols_${user}`;

interface ChatMessage { role: 'user' | 'model'; text: string }

const num = (v: number | null, suffix = '') => (v === null ? '—' : `${v}${suffix}`);
const money = (v: number) => `${formatCurrency(v)} ₽`;

export const TurnoverTab: React.FC = () => {
  const stock = useWarehouseStore((s) => s.stock);
  const kits = useWarehouseStore((s) => s.kits);
  const skus = useWarehouseStore((s) => s.skus);
  const transactions = useWarehouseStore((s) => s.transactions);
  const ozonSettings = useWarehouseStore((s) => s.ozonSettings);
  const ozonRefsLoaded = useWarehouseStore((s) => s.ozonRefsLoaded);
  const fetchOzonInitialData = useWarehouseStore((s) => s.fetchOzonInitialData);
  const turnoverData = useWarehouseStore((s) => s.turnoverData);
  const fetchTurnoverData = useWarehouseStore((s) => s.fetchTurnoverData);
  const runKanPullNow = useWarehouseStore((s) => s.runKanPullNow);
  const isProcessing = useWarehouseStore((s) => s.isProcessing);
  const sessionToken = useWarehouseStore((s) => s.sessionToken);
  const currentUser = useWarehouseStore((s) => s.currentUser);
  const geminiModel = useSettingsStore((s) => s.geminiModel);
  const isAdmin = currentUser?.role?.toLowerCase() === 'admin' || ['admin', 'админ', 'администратор'].includes(currentUser?.username?.toLowerCase() || '');

  const periodDays = Math.max(1, Number(ozonSettings.turnoverPeriodDays) || 90);
  const slowDays = Number(ozonSettings.turnoverSlowDays) || 45;
  const fastDays = Number(ozonSettings.turnoverFastDays) || 20;
  const gmroiGreen = Number(ozonSettings.gmroiGreenPct ?? 100);
  const gmroiRed = Number(ozonSettings.gmroiRedPct ?? 30);

  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const [hiddenCols, setHiddenCols] = useState<string[]>([]);
  const [showColsMenu, setShowColsMenu] = useState(false);
  useEffect(() => {
    if (!currentUser?.username) return;
    try {
      const saved = localStorage.getItem(TURNOVER_COLS_KEY(currentUser.username));
      setHiddenCols(saved ? JSON.parse(saved) : []);
    } catch (e) {
      setHiddenCols([]);
    }
  }, [currentUser?.username]);
  const isColVisible = (key: string) => !hiddenCols.includes(key);
  const toggleCol = (key: string) => {
    setHiddenCols((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      if (currentUser?.username) {
        try { localStorage.setItem(TURNOVER_COLS_KEY(currentUser.username), JSON.stringify(next)); } catch (e) {}
      }
      return next;
    });
  };
  const visibleColsCount = 1 + TURNOVER_COLS.filter((c) => isColVisible(c.key)).length;

  useEffect(() => {
    if (!ozonRefsLoaded) fetchOzonInitialData();
  }, [ozonRefsLoaded, fetchOzonInitialData]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchTurnoverData(periodDays).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [fetchTurnoverData, periodDays]);

  const result = useMemo(() => {
    if (!turnoverData) return null;
    return buildTurnover({
      kanRows: turnoverData.kanRows,
      snapshots: turnoverData.snapshots,
      shelf: shelfFromStock(stock, kits),
      transactions,
      skus,
      kits,
      settings: { periodDays, slowDays, fastDays },
      latestKanDay: turnoverData.latestKanDay,
    });
  }, [turnoverData, stock, kits, transactions, skus, periodDays, slowDays, fastDays]);

  const rows = useMemo<ArticleTurnover[]>(() => {
    if (!result) return [];
    const q = search.trim().toLowerCase();
    return result.articles.filter((a) => (filter === 'all' || a.status === filter) && (!q || a.article.toLowerCase().includes(q)));
  }, [result, filter, search]);

  const p = result?.portfolio || null;
  const noKan = !!turnoverData && turnoverData.kanRows.length === 0;

  const refreshFromKan = async () => {
    const ok = await runKanPullNow();
    if (ok) await fetchTurnoverData(periodDays);
  };

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q || !result || asking) return;
    const history = messages;
    setMessages([...history, { role: 'user', text: q }]);
    setQuestion('');
    setAsking(true);
    try {
      const response = await fetch('/api/turnover/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionToken,
          system: TURNOVER_SYSTEM_PROMPT,
          snapshot: buildTurnoverSnapshot(result, slowDays, fastDays),
          history,
          question: q,
          modelName: geminiModel || 'gemini-flash-latest',
        }),
      });
      const body = await response.json();
      if (body.status !== 'success') throw new Error(body.message || 'Ошибка запроса к модели');
      setMessages((m) => [...m, { role: 'model', text: String(body.data.answer) }]);
    } catch (e: any) {
      toast.error(e?.message || 'Не удалось получить ответ');
      setMessages(history);
      setQuestion(q);
    } finally {
      setAsking(false);
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Оборачиваемость капитала</h2>
          <p className="text-sm text-slate-500">
            Ozon FBO + свой склад, по себестоимости.{' '}
            {p ? `Период ${periodDays} дн.: ${formatDateRu(p.fromDay)} – ${formatDateRu(p.toDay)}.` : ''}{' '}
            {turnoverData?.latestKanDay ? `Данные KAN по ${formatDateRu(turnoverData.latestKanDay)}.` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button id="btn-turnover-kan-refresh" onClick={refreshFromKan} disabled={isProcessing}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 disabled:opacity-50 cursor-pointer">
              <RefreshCw size={16} className={isProcessing ? 'animate-spin' : ''} /> Обновить из KAN
            </button>
          )}
          <button onClick={() => setShowSettings(true)} title="Период и пороги — в настройках Ozon"
            className="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 cursor-pointer">
            <Settings size={16} /> Пороги
          </button>
        </div>
      </div>

      {noKan && (
        <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-sm text-amber-800">
          Данных KAN ещё нет. Ночная задача заполнит лист «KAN дни» после первого запуска; администратор может нажать «Обновить из KAN» сейчас.
        </div>
      )}

      {p && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
          <Card title="Капитал сейчас" value={money(p.capitalNow)} note={`склад ${money(p.shelfCapital)} · Ozon ${money(p.ozonStockCost)} · в доставке ${money(p.deliveringCost)} · возвраты ${money(p.returningCost)}`} />
          <Card title="Средний капитал" value={money(p.avgCapital)} note={`склад ${money(p.avgWarehouseCapital)} · Ozon ${money(p.avgOzonCapital)}`} />
          <Card title="Оборачиваемость" value={p.turns === null ? '—' : `${p.turns} раза`} note={p.daysPerTurn === null ? 'продаж не было' : `один оборот ≈ ${p.daysPerTurn} дн.`} />
          <Card title="GMROI" value={p.gmroiPct === null ? '—' : `${p.gmroiPct} %`} note={`валовая прибыль ${money(p.grossProfit)} / себестоимость продаж ${money(p.costOfSales)} · зелёный от ${gmroiGreen} %, красный ниже ${gmroiRed} %`} gmroi={gmroiTone(p.gmroiPct, gmroiGreen, gmroiRed)} />
          <Card title="В медленных товарах" value={money(p.slowCapital)} note={`${p.slowSharePct} % капитала · ${p.counts.slow} шт.`} tone="red" />
          <Card title="Лидеры" value={`${p.counts.fast} шт.`} note={`капитал ${money(p.fastCapital)} · только Ozon: ${num(p.ozonOnlyTurns, ' раза')} (как в KAN)`} tone="green" />
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="p-4 flex flex-wrap items-center gap-2 border-b border-slate-100">
            {(['all', 'fast', 'normal', 'slow', 'component'] as Filter[]).map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${filter === f ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                {f === 'all' ? `Все (${result?.articles.length || 0})` : `${STATUS_LABEL[f]} (${p ? p.counts[f] : 0})`}
              </button>
            ))}
            <div className="ml-auto relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Артикул"
                className="pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div className="relative">
              <button type="button" id="btn-turnover-cols" onClick={() => setShowColsMenu((v) => !v)}
                className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50 cursor-pointer">
                <Columns3 size={14} /> Колонки
              </button>
              {showColsMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowColsMenu(false)} />
                  <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-slate-200 rounded-xl shadow-lg p-2 w-60">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2 py-1">Показывать колонки</div>
                    {TURNOVER_COLS.map((col) => (
                      <label key={col.key} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer text-xs text-slate-700">
                        <input type="checkbox" checked={isColVisible(col.key)} onChange={() => toggleCol(col.key)} className="accent-indigo-600" />
                        {col.label}
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Артикул</th>
                  {TURNOVER_COLS.filter((c) => isColVisible(c.key)).map((c) => (
                    <th key={c.key} className="px-3 py-3 text-right" title={c.title}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && !result && (
                  <tr><td colSpan={visibleColsCount} className="px-4 py-8 text-center text-slate-400">Загрузка…</td></tr>
                )}
                {rows.map((a) => (
                  <tr key={a.article} className="border-t border-slate-100 hover:bg-slate-50" data-status={a.status}>
                    <td className="px-4 py-2">
                      <div className="font-semibold text-slate-800">{a.article}{a.isKit && <span className="ml-1 text-[10px] text-slate-400 uppercase">набор</span>}</div>
                      <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${STATUS_CLASS[a.status]}`}>{STATUS_LABEL[a.status]}</span>
                      {a.kitOf.length > 0 && <div className="text-[10px] text-slate-400 mt-1">в составе: {a.kitOf.join(', ')}</div>}
                    </td>
                    {isColVisible('turns') && <td className="px-3 py-2 text-right font-mono">{num(a.turns)}</td>}
                    {isColVisible('daysPerTurn') && <td className={`px-3 py-2 text-right font-mono font-bold ${a.status === 'slow' ? 'text-red-600' : a.status === 'fast' ? 'text-emerald-600' : 'text-slate-700'}`}>{num(a.daysPerTurn)}</td>}
                    {isColVisible('gmroi') && <td className={`px-3 py-2 text-right font-mono ${GMROI_CLASS[gmroiTone(a.gmroiPct, gmroiGreen, gmroiRed)]}`}>{num(a.gmroiPct, ' %')}</td>}
                    {isColVisible('cover') && <td className="px-3 py-2 text-right font-mono">{num(a.coverDays)}</td>}
                    {isColVisible('age') && <td className="px-3 py-2 text-right font-mono" title={a.lastSaleDay ? `последняя продажа ${formatDateRu(a.lastSaleDay)}` : a.lastReceiptDay ? `последний приход ${formatDateRu(a.lastReceiptDay)}` : ''}>{num(a.ageDays)}</td>}
                    {isColVisible('shelf') && <td className="px-3 py-2 text-right whitespace-nowrap" title={`${a.shelfQty} шт`}>{money(a.shelfCapital)}<div className="text-[10px] text-slate-400">{a.shelfQty} шт</div></td>}
                    {isColVisible('ozon') && <td className="px-3 py-2 text-right whitespace-nowrap" title={`остаток ${money(a.ozonStockCost)} · в доставке ${money(a.deliveringCost)} · возвраты ${money(a.returningCost)}`}>
                      {money(a.ozonStockCost + a.deliveringCost + a.returningCost)}<div className="text-[10px] text-slate-400">{a.ozonQty} шт</div>
                    </td>}
                    {isColVisible('avgCapital') && <td className="px-3 py-2 text-right whitespace-nowrap">{money(a.avgCapital)}</td>}
                    {isColVisible('sold') && <td className="px-3 py-2 text-right font-mono">{a.boughtQty}</td>}
                  </tr>
                ))}
                {result && rows.length === 0 && (
                  <tr><td colSpan={visibleColsCount} className="px-4 py-8 text-center text-slate-400">Ничего не найдено</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 flex flex-col min-h-[480px]">
          <div className="p-4 border-b border-slate-100 flex items-center gap-2">
            <Bot size={18} className="text-indigo-600" />
            <div className="font-bold text-slate-800">Анализ с ИИ</div>
            <span title="Модель получает таблицу выше целиком и отвечает по ней. Выберите готовый вопрос или задайте свой."><HelpCircle size={14} className="text-slate-400" /></span>
          </div>
          <div className="p-3 flex flex-wrap gap-2 border-b border-slate-100">
            {TURNOVER_PRESETS.map((preset) => (
              <button key={preset.id} id={`btn-turnover-preset-${preset.id}`} onClick={() => ask(preset.prompt)} disabled={!result || asking}
                className="px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-bold hover:bg-indigo-100 disabled:opacity-50 cursor-pointer">
                {preset.label}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[560px]">
            {messages.length === 0 && <div className="text-sm text-slate-400">Нажмите один из вопросов выше или напишите свой.</div>}
            {messages.map((m, i) => (
              <div key={i} className={`text-sm whitespace-pre-wrap rounded-xl px-3 py-2 ${m.role === 'user' ? 'bg-indigo-600 text-white ml-8' : 'bg-slate-100 text-slate-800 mr-4'}`}>{m.text}</div>
            ))}
            {asking && <div className="text-sm text-slate-400 animate-pulse">Думаю…</div>}
            <div ref={chatEndRef} />
          </div>
          <div className="p-3 border-t border-slate-100 flex gap-2">
            <textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={2} placeholder="Свой вопрос по данным…"
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(question); } }}
              className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
            <button id="btn-turnover-ask" onClick={() => ask(question)} disabled={!result || asking || !question.trim()}
              className="px-3 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 cursor-pointer" title="Отправить">
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>

      <OzonSettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  );
};

const Card: React.FC<{ title: string; value: string; note: string; tone?: 'red' | 'green'; gmroi?: GmroiTone }> = ({ title, value, note, tone, gmroi }) => (
  <div className={`p-4 rounded-2xl border ${tone === 'red' ? 'bg-red-50 border-red-100' : tone === 'green' ? 'bg-emerald-50 border-emerald-100' : 'bg-white border-slate-200'}`}>
    <div className="text-xs font-bold text-slate-400 uppercase truncate" title={title}>{title}</div>
    <div className={`text-xl font-bold mt-1 ${gmroi && gmroi !== 'none' ? GMROI_CLASS[gmroi] : tone === 'red' ? 'text-red-700' : tone === 'green' ? 'text-emerald-700' : 'text-slate-800'}`}>{value}</div>
    <div className="text-[11px] text-slate-500 mt-1" title={note}>{note}</div>
  </div>
);
