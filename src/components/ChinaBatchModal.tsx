import React, { useState } from 'react';
import { X, Save, Loader2, Plus, Trash2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useChinaStore } from '../store/useChinaStore';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { chinaArticleOptions } from '../lib/chinaArticles';
import { ChinaBatch } from '../types';
import {
  ChinaBatchForm, ChinaLineForm, CHINA_STATUSES, chinaBatchToForm, chinaFilledLines,
  chinaFormCounts, chinaFormToPayload, chinaMarkingMatches, emptyChinaBatchForm, emptyChinaLine,
  validateChinaBatchForm
} from '../lib/chinaBatchForm';
import { ChinaSheets } from '../lib/chinaFileParse';
import { ChinaAiKind, ChinaAiParsed, chinaAiParse, chinaAiRead, chinaAiVerifyMark, chinaCompareParsed } from '../lib/chinaAiRead';

interface ChinaBatchModalProps {
  /** The batch being edited, or null for a new one. */
  batch: ChinaBatch | null;
  /** Item 81c: a form already filled from the files of the Chinese side. */
  initialForm?: ChinaBatchForm | null;
  /** Where the imported fields came from — for the owner to check, not to trust. */
  notes?: string[];
  /** What does not add up in the file itself. */
  warnings?: string[];
  /** Item 81g, step 7: present only when the script itself found nothing to complain about —
   * the owner can still press «Проверить ИИ» to have a model read the same grid a second time. */
  aiCheck?: { kind: ChinaAiKind; sheets: ChinaSheets; scriptParsed: ChinaAiParsed } | null;
  onClose: () => void;
}

const field = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200';
const cell = 'px-2 py-1 border border-slate-200 rounded text-sm w-full';

export const ChinaBatchModal: React.FC<ChinaBatchModalProps> = ({ batch, initialForm, notes, warnings, aiCheck, onClose }) => {
  const saveChinaBatch = useChinaStore((s) => s.saveChinaBatch);
  const isSaving = useChinaStore((s) => s.isSaving);
  const settings = useChinaStore((s) => s.settings);
  const skus = useWarehouseStore((s) => s.skus);
  const sessionToken = useWarehouseStore((s) => s.sessionToken) || '';

  const [form, setForm] = useState<ChinaBatchForm>(() => {
    if (initialForm) return initialForm;
    return batch ? chinaBatchToForm(batch) : emptyChinaBatchForm();
  });
  const [isCheckingAi, setIsCheckingAi] = useState(false);
  const [aiDiffs, setAiDiffs] = useState<string[] | null>(null);

  // Item 81g, step 7: the owner's own re-check of a file the script already accepted — reads
  // the SAME grid a second time through AI and compares it to what the script read, field by
  // field. Two ticks when they agree, a cross with the differences spelled out when they don't;
  // the script's own values in the form are never overwritten, the owner edits them by hand.
  const checkWithAi = async () => {
    if (!aiCheck) return;
    setIsCheckingAi(true);
    try {
      const raw = await chinaAiRead(sessionToken, aiCheck.kind, aiCheck.sheets);
      const aiParsed = chinaAiParse(aiCheck.kind, raw);
      if (!aiParsed) {
        toast.error('ИИ не смог прочитать файл');
        return;
      }
      const diffs = chinaCompareParsed(aiCheck.kind, aiCheck.scriptParsed, aiParsed);
      setAiDiffs(diffs);
      set({ checkMark: chinaAiVerifyMark(diffs), checkNote: diffs.join('; ') });
      if (diffs.length === 0) toast.success('ИИ подтвердил проверку скрипта');
      else toast.warning('ИИ увидел расхождение со скриптом — проверьте перед сохранением');
    } catch (e) {
      toast.error(`Проверка ИИ не выполнена: ${(e as Error).message}`);
    } finally {
      setIsCheckingAi(false);
    }
  };

  const set = (patch: Partial<ChinaBatchForm>) => setForm((f) => ({ ...f, ...patch }));
  const setLine = (index: number, patch: Partial<ChinaLineForm>) => setForm((f) => ({
    ...f,
    lines: f.lines.map((l, i) => (i === index ? { ...l, ...patch } : l))
  }));
  // Item 81f, owner check: an article chosen for one line goes to every line of the SAME
  // marking (case-insensitive, trimmed) — a marking is one product.
  const setLineArticle = (index: number, article: string) => setForm((f) => {
    const indexes = chinaMarkingMatches(f.lines, f.lines[index].marking);
    return { ...f, lines: f.lines.map((l, i) => (indexes.indexOf(i) !== -1 ? { ...l, article } : l)) };
  });
  const addLine = () => setForm((f) => ({ ...f, lines: [...f.lines, emptyChinaLine()] }));
  const removeLine = (index: number) => setForm((f) => ({
    ...f,
    lines: f.lines.length > 1 ? f.lines.filter((_, i) => i !== index) : f.lines
  }));

  const counts = chinaFormCounts(form.lines);
  const cargoRateHint = settings.cargoRateCnyPerUsd;

  const handleSave = async () => {
    const errors = validateChinaBatchForm(form);
    if (errors.length > 0) {
      toast.error(errors[0]);
      return;
    }
    const payload = chinaFormToPayload({ ...form, lines: chinaFilledLines(form.lines) });
    const ok = await saveChinaBatch(payload);
    if (ok) onClose();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-6xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <h2 className="text-lg font-bold">{batch ? `Партия ${batch.code}` : 'Новая партия'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto grow">
          {aiCheck && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 flex items-start justify-between gap-3 flex-wrap">
              <div>
                <p className="text-sm font-bold text-indigo-800">Скрипт прочитал файл без замечаний</p>
                <p className="text-sm text-indigo-700">
                  Можно дополнительно проверить через ИИ — он прочитает тот же файл ещё раз и сверит цифры со скриптом.
                </p>
                {aiDiffs && aiDiffs.length > 0 && (
                  <ul className="mt-1 text-sm text-red-700 list-disc list-inside">
                    {aiDiffs.map((d, i) => <li key={i}>{d}</li>)}
                  </ul>
                )}
                {aiDiffs && aiDiffs.length === 0 && (
                  <p className="mt-1 text-sm text-emerald-700 font-bold">ИИ подтвердил: расхождений не найдено.</p>
                )}
              </div>
              <button
                data-testid="btn-check-china-ai"
                onClick={checkWithAi}
                disabled={isCheckingAi}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-indigo-200 rounded-lg text-sm font-bold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 shrink-0"
              >
                {isCheckingAi ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                Проверить ИИ
              </button>
            </div>
          )}
          {warnings && warnings.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-sm font-bold text-amber-800">В файле не сходятся суммы — проверьте перед сохранением</p>
              <ul className="mt-1 text-sm text-amber-700 list-disc list-inside">
                {warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}
          {notes && notes.length > 0 && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
              <p className="text-sm font-bold text-slate-600">Что заполнено из файлов</p>
              <ul className="mt-1 text-sm text-slate-500 list-disc list-inside">
                {notes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <label className="block">
              <span className="text-xs font-bold text-slate-500 uppercase">Код партии</span>
              <input className={field} value={form.code} onChange={(e) => set({ code: e.target.value })} placeholder="NV-0825-2" />
            </label>
            <label className="block">
              <span className="text-xs font-bold text-slate-500 uppercase">Номер заказа</span>
              <input className={field} value={form.orderNo} onChange={(e) => set({ orderNo: e.target.value })} placeholder="28" />
            </label>
            <label className="block">
              <span className="text-xs font-bold text-slate-500 uppercase">Дата отгрузки</span>
              <input type="date" className={field} value={form.shippedAt} onChange={(e) => set({ shippedAt: e.target.value })} />
            </label>
            <label className="block">
              <span className="text-xs font-bold text-slate-500 uppercase">Дата прибытия</span>
              <input type="date" className={field} value={form.arrivedAt} onChange={(e) => set({ arrivedAt: e.target.value })} />
            </label>
            <label className="block">
              <span className="text-xs font-bold text-slate-500 uppercase">Дата приёмки в Китае</span>
              <input type="date" className={field} value={form.receivedAt} onChange={(e) => set({ receivedAt: e.target.value })} />
            </label>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <label className="block">
              <span className="text-xs font-bold text-slate-500 uppercase">Статус</span>
              <select className={field} value={form.status} onChange={(e) => set({ status: e.target.value })}>
                {CHINA_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-bold text-slate-500 uppercase">Доставка по Китаю, ¥</span>
              <input className={field} value={form.chinaDeliveryCny} onChange={(e) => set({ chinaDeliveryCny: e.target.value })} placeholder="700" />
            </label>
            <label className="block">
              <span className="text-xs font-bold text-slate-500 uppercase">Вес накладной, кг</span>
              <input className={field} value={form.weightKg} onChange={(e) => set({ weightKg: e.target.value })} placeholder="672,5" />
            </label>
            <label className="block">
              <span className="text-xs font-bold text-slate-500 uppercase">Объём, м³</span>
              <input className={field} value={form.volumeM3} onChange={(e) => set({ volumeM3: e.target.value })} placeholder="4,92" />
            </label>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <label className="block">
              <span className="text-xs font-bold text-slate-500 uppercase">Ставка, $/кг</span>
              <input className={field} value={form.ratePerKgUsd} onChange={(e) => set({ ratePerKgUsd: e.target.value })} placeholder="2,3" />
            </label>
            <label className="block">
              <span className="text-xs font-bold text-slate-500 uppercase">Упаковка, $</span>
              <input className={field} value={form.packingUsd} onChange={(e) => set({ packingUsd: e.target.value })} placeholder="90" />
            </label>
            <label className="block">
              <span className="text-xs font-bold text-slate-500 uppercase">Прочее карго, $</span>
              <input className={field} value={form.otherCargoUsd} onChange={(e) => set({ otherCargoUsd: e.target.value })} />
            </label>
            <label className="block">
              <span className="text-xs font-bold text-slate-500 uppercase">Итого перевозка, $</span>
              <input className={field} value={form.freightUsd} onChange={(e) => set({ freightUsd: e.target.value })} placeholder="1636,75" />
              <span className="text-[11px] text-slate-400">Сумма из накладной. Пусто — посчитается по ставке.</span>
            </label>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <label className="block">
              <span className="text-xs font-bold text-slate-500 uppercase">Курс ¥/$</span>
              <input className={field} value={form.cargoRate} onChange={(e) => set({ cargoRate: e.target.value })} placeholder={cargoRateHint ? String(cargoRateHint) : '7'} />
              <span className="text-[11px] text-slate-400">Пусто — возьмётся из справочника{cargoRateHint ? `: ${cargoRateHint}` : ''}.</span>
            </label>
            <label className="block">
              <span className="text-xs font-bold text-slate-500 uppercase">Курс ₽/¥</span>
              <input className={field} value={form.rubRate} onChange={(e) => set({ rubRate: e.target.value })} placeholder="12,4" />
              <span className="text-[11px] text-slate-400">Курс, вписанный вручную. Когда к заказу привязаны оплаты, партия считается по их курсу, а этот остаётся запасным.</span>
            </label>
            <label className="block md:col-span-2">
              <span className="text-xs font-bold text-slate-500 uppercase">Комментарий</span>
              <input className={field} value={form.comment} onChange={(e) => set({ comment: e.target.value })} />
            </label>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-bold">Товар в партии</h3>
              <button onClick={addLine} className="flex items-center gap-1 text-sm text-indigo-600 font-bold hover:text-indigo-700">
                <Plus size={16} /> Строка
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase text-slate-400 text-left">
                    <th className="py-1 pr-2">Маркировка</th>
                    <th className="py-1 pr-2">Название</th>
                    <th className="py-1 pr-2">Коробок</th>
                    <th className="py-1 pr-2">Шт/кор</th>
                    <th className="py-1 pr-2">Количество</th>
                    <th className="py-1 pr-2">Цена ¥</th>
                    <th className="py-1 pr-2">Паллета</th>
                    <th className="py-1 pr-2">Вес паллеты</th>
                    <th className="py-1 pr-2">Вес коробки</th>
                    <th className="py-1 pr-2">Наш артикул</th>
                    <th className="py-1 pr-2">Один товар</th>
                    <th className="py-1 pr-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {form.lines.map((line, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="py-1 pr-2"><input className={cell} value={line.marking} onChange={(e) => setLine(i, { marking: e.target.value })} placeholder="NV-99" /></td>
                      <td className="py-1 pr-2"><input className={cell} value={line.name} onChange={(e) => setLine(i, { name: e.target.value })} /></td>
                      <td className="py-1 pr-2"><input className={cell} value={line.boxes} onChange={(e) => setLine(i, { boxes: e.target.value })} /></td>
                      <td className="py-1 pr-2"><input className={cell} value={line.pcsPerBox} onChange={(e) => setLine(i, { pcsPerBox: e.target.value })} /></td>
                      <td className="py-1 pr-2"><input className={cell} value={line.qty} onChange={(e) => setLine(i, { qty: e.target.value })} /></td>
                      <td className="py-1 pr-2"><input className={cell} value={line.priceCny} onChange={(e) => setLine(i, { priceCny: e.target.value })} /></td>
                      <td className="py-1 pr-2"><input className={cell} value={line.pallet} onChange={(e) => setLine(i, { pallet: e.target.value })} /></td>
                      <td className="py-1 pr-2"><input className={cell} value={line.palletWeightKg} onChange={(e) => setLine(i, { palletWeightKg: e.target.value })} /></td>
                      <td className="py-1 pr-2"><input className={cell} value={line.boxWeightKg} onChange={(e) => setLine(i, { boxWeightKg: e.target.value })} /></td>
                      <td className="py-1 pr-2">
                        <select
                          data-testid="select-china-article"
                          className={`${cell} min-w-[220px]`}
                          value={line.article}
                          onChange={(e) => setLineArticle(i, e.target.value)}
                        >
                          <option value="">— выберите артикул —</option>
                          {chinaArticleOptions(skus, line.article).map((a) => (
                            <option key={a} value={a}>{a}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1 pr-2"><input className={cell} value={line.group} onChange={(e) => setLine(i, { group: e.target.value })} placeholder="одна метка" /></td>
                      <td className="py-1 pr-2 text-right">
                        <button onClick={() => removeLine(i)} className="text-slate-300 hover:text-red-500"><Trash2 size={16} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm text-slate-500 mt-2">
              Итого: {counts.rows} строк, {counts.boxes} коробок, {counts.qty} шт.
              Вес коробки заполняйте, если знаете его точно — он важнее оценки по паллетам.
              Артикул выбирается из нашей базы SKU; одинаковым товарам разных цветов ставьте одну метку «Один товар».
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-slate-500 hover:text-slate-700">Отмена</button>
          <button
            data-testid="btn-save-china-batch"
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 px-5 py-2 bg-indigo-600 text-white text-sm font-bold rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Сохранить и посчитать
          </button>
        </div>
      </div>
    </div>
  );
};
