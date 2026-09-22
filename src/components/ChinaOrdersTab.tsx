import React, { useEffect, useMemo, useState } from 'react';
import {
  Plus, RefreshCw, Loader2, Trash2, Pencil, ChevronDown, ChevronRight, AlertTriangle, Save
} from 'lucide-react';
import { toast } from 'sonner';
import { useChinaStore } from '../store/useChinaStore';
import { useUIStore } from '../store/useUIStore';
import { ChinaBatch, ChinaBatchLine } from '../types';
import { ChinaBatchModal } from './ChinaBatchModal';
import {
  CHINA_COST_TYPES, chinaBatchToForm, chinaFormToPayload, chinaGroupLabel, chinaLevelledGroups
} from '../lib/chinaBatchForm';

const money = (value: number, currency: string): string =>
  `${(Number(value) || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

const statusColour = (status: string): string => {
  if (status === 'Прибыла') return 'bg-emerald-50 text-emerald-700';
  if (status === 'В пути') return 'bg-amber-50 text-amber-700';
  return 'bg-slate-100 text-slate-600';
};

/** The article and the same-product marker are edited in place, one batch at a time. */
interface LabelDraft { article: string; group: string }

export const ChinaOrdersTab: React.FC = () => {
  const batches = useChinaStore((s) => s.batches);
  const isLoading = useChinaStore((s) => s.isLoading);
  const isSaving = useChinaStore((s) => s.isSaving);
  const loaded = useChinaStore((s) => s.loaded);
  const error = useChinaStore((s) => s.error);
  const fetchChinaBatches = useChinaStore((s) => s.fetchChinaBatches);
  const setupChinaSpreadsheet = useChinaStore((s) => s.setupChinaSpreadsheet);
  const saveChinaBatch = useChinaStore((s) => s.saveChinaBatch);
  const deleteChinaBatch = useChinaStore((s) => s.deleteChinaBatch);
  const saveChinaCost = useChinaStore((s) => s.saveChinaCost);
  const deleteChinaCost = useChinaStore((s) => s.deleteChinaCost);
  const setConfirmDialog = useUIStore((s) => s.setConfirmDialog);

  const [openId, setOpenId] = useState<string>('');
  const [editing, setEditing] = useState<ChinaBatch | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [labels, setLabels] = useState<Record<string, LabelDraft>>({});
  const [costKind, setCostKind] = useState(CHINA_COST_TYPES[0]);
  const [costAmount, setCostAmount] = useState('');
  const [costComment, setCostComment] = useState('');

  useEffect(() => { fetchChinaBatches(); }, [fetchChinaBatches]);

  const open = useMemo(() => batches.find((b) => b.id === openId) || null, [batches, openId]);

  const labelOf = (line: ChinaBatchLine): LabelDraft =>
    labels[line.id] || { article: line.article, group: line.group };

  const setLabel = (line: ChinaBatchLine, patch: Partial<LabelDraft>) =>
    setLabels((prev) => ({ ...prev, [line.id]: { ...labelOf(line), ...patch } }));

  const labelsChanged = (batch: ChinaBatch): boolean =>
    batch.lines.some((l) => {
      const draft = labels[l.id];
      return !!draft && (draft.article !== l.article || draft.group !== l.group);
    });

  // Saving the articles is saving the batch: the script recomputes it, because the article
  // and the marker decide which lines are costed as one product.
  const saveLabels = async (batch: ChinaBatch) => {
    const form = chinaBatchToForm(batch);
    form.lines = form.lines.map((line, i) => {
      const draft = labels[batch.lines[i].id];
      return draft ? { ...line, article: draft.article, group: draft.group } : line;
    });
    const ok = await saveChinaBatch(chinaFormToPayload(form));
    if (ok) {
      setLabels((prev) => {
        const next = { ...prev };
        batch.lines.forEach((l) => delete next[l.id]);
        return next;
      });
    }
  };

  const addCost = async (batch: ChinaBatch) => {
    const amount = Number(String(costAmount).replace(',', '.'));
    if (!(amount > 0)) {
      toast.error('Сумма расхода должна быть больше нуля');
      return;
    }
    const ok = await saveChinaCost({
      batchId: batch.id, kind: costKind, amountRub: amount, comment: costComment.trim()
    });
    if (ok) { setCostAmount(''); setCostComment(''); }
  };

  const askDeleteBatch = (batch: ChinaBatch) => {
    setConfirmDialog({
      show: true,
      title: 'Удалить партию?',
      message: `Партия ${batch.code} будет удалена вместе со строками товара и расходами. Отменить это нельзя.`,
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

      {loaded && batches.length === 0 && !error && (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-500">
          Партий пока нет. Нажмите «Новая партия» и внесите данные из файла китайцев.
        </div>
      )}

      <div className="space-y-3">
        {batches.map((batch) => {
          const isOpen = batch.id === openId;
          const groups = chinaLevelledGroups(batch.lines);
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
                    {batch.orderNo && <span className="text-sm text-slate-400">заказ №{batch.orderNo}</span>}
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${statusColour(batch.status)}`}>{batch.status}</span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {batch.shippedAt && <>отгружена {batch.shippedAt} </>}
                    {batch.arrivedAt && <>· прибыла {batch.arrivedAt} </>}
                    · {batch.lines.length} строк · {batch.weightKg} кг
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold">{money(batch.totalRub, '₽')}</div>
                  <div className="text-xs text-slate-400">себестоимость партии</div>
                </div>
              </button>

              {isOpen && open && (
                <div className="border-t border-slate-100 p-5 space-y-6">
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 text-sm">
                    <div><div className="text-xs text-slate-400 uppercase font-bold">Товар</div>{money(batch.goodsCny, '¥')}</div>
                    <div><div className="text-xs text-slate-400 uppercase font-bold">Доставка по Китаю</div>{money(batch.chinaDeliveryCny, '¥')}</div>
                    <div><div className="text-xs text-slate-400 uppercase font-bold">Перевозка</div>{money(batch.freightUsd, '$')} → {money(batch.freightCny, '¥')}</div>
                    <div><div className="text-xs text-slate-400 uppercase font-bold">Расходы РФ</div>{money(batch.rubCosts, '₽')}</div>
                    <div><div className="text-xs text-slate-400 uppercase font-bold">Курс ₽/¥</div>{batch.rubRate || '—'}</div>
                    <div>
                      <div className="text-xs text-slate-400 uppercase font-bold">Коэффициент веса</div>
                      {batch.weightFactor === null ? '—' : batch.weightFactor}
                    </div>
                  </div>

                  {batch.weightFactor !== null && (batch.weightFactor < 0.8 || batch.weightFactor > 1.25) && (
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
                          <th className="py-2 pr-3">Перевозка ¥</th>
                          <th className="py-2 pr-3">Расходы РФ ₽</th>
                          <th className="py-2 pr-3">Себестоимость ₽</th>
                          <th className="py-2 pr-3">₽ за штуку</th>
                          <th className="py-2 pr-3">Наш артикул</th>
                          <th className="py-2 pr-3">Один товар</th>
                        </tr>
                      </thead>
                      <tbody>
                        {batch.lines.map((line) => {
                          const draft = labelOf(line);
                          const key = chinaGroupLabel(line).toLowerCase();
                          const levelled = !!groups[key];
                          return (
                            <tr key={line.id} className="border-b border-slate-50">
                              <td className="py-2 pr-3 font-bold">
                                {line.marking}
                                {levelled && <span className="ml-2 text-[10px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">общая себестоимость</span>}
                              </td>
                              <td className="py-2 pr-3">{line.boxes}</td>
                              <td className="py-2 pr-3">{line.qty}</td>
                              <td className="py-2 pr-3">{line.priceCny}</td>
                              <td className="py-2 pr-3">{money(line.sumCny, '¥')}</td>
                              <td className="py-2 pr-3">
                                {line.weightKg}
                                <span className="block text-[10px] text-slate-400">{line.weightSource}</span>
                              </td>
                              <td className="py-2 pr-3">{money(line.freightShareCny, '¥')}</td>
                              <td className="py-2 pr-3">{money(line.rubShare, '₽')}</td>
                              <td className="py-2 pr-3">{money(line.costRub, '₽')}</td>
                              <td className="py-2 pr-3 font-bold">{money(line.unitRub, '₽')}</td>
                              <td className="py-2 pr-3">
                                <input
                                  className="px-2 py-1 border border-slate-200 rounded text-sm w-28"
                                  value={draft.article}
                                  onChange={(e) => setLabel(line, { article: e.target.value })}
                                  placeholder="артикул"
                                />
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
                      disabled={isSaving || !labelsChanged(batch)}
                      className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 disabled:opacity-40"
                    >
                      {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                      Сохранить артикулы и пересчитать
                    </button>
                  </div>

                  <div className="bg-slate-50 rounded-xl p-4 space-y-3">
                    <h3 className="font-bold text-sm">Расходы в рублях — делятся по коробкам</h3>
                    {batch.costs.length > 0 && (
                      <table className="w-full text-sm">
                        <tbody>
                          {batch.costs.map((cost) => (
                            <tr key={cost.id} className="border-b border-slate-200 last:border-0">
                              <td className="py-1.5 pr-3">{cost.date}</td>
                              <td className="py-1.5 pr-3">{cost.kind}</td>
                              <td className="py-1.5 pr-3">{money(cost.amountRub, '₽')}</td>
                              <td className="py-1.5 pr-3 text-slate-500">{cost.comment}</td>
                              <td className="py-1.5 text-right">
                                <button onClick={() => deleteChinaCost(cost.id)} className="text-slate-300 hover:text-red-500">
                                  <Trash2 size={15} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    <div className="flex items-end gap-2 flex-wrap">
                      <label className="block">
                        <span className="text-[11px] font-bold text-slate-500 uppercase">Тип</span>
                        <select className="block px-3 py-2 border border-slate-200 rounded-lg text-sm" value={costKind} onChange={(e) => setCostKind(e.target.value)}>
                          {CHINA_COST_TYPES.map((k) => <option key={k} value={k}>{k}</option>)}
                        </select>
                      </label>
                      <label className="block">
                        <span className="text-[11px] font-bold text-slate-500 uppercase">Сумма, ₽</span>
                        <input className="block px-3 py-2 border border-slate-200 rounded-lg text-sm w-32" value={costAmount} onChange={(e) => setCostAmount(e.target.value)} />
                      </label>
                      <label className="block grow">
                        <span className="text-[11px] font-bold text-slate-500 uppercase">Комментарий</span>
                        <input className="block w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" value={costComment} onChange={(e) => setCostComment(e.target.value)} />
                      </label>
                      <button
                        data-testid="btn-add-china-cost"
                        onClick={() => addCost(batch)}
                        disabled={isSaving}
                        className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-bold text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"
                      >
                        Добавить расход
                      </button>
                    </div>
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
        <ChinaBatchModal batch={editing} onClose={() => { setShowModal(false); setEditing(null); }} />
      )}
    </div>
  );
};
