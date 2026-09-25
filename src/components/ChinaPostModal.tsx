import React, { useRef, useState } from 'react';
import { X, Loader2, PackageCheck } from 'lucide-react';
import { useChinaStore } from '../store/useChinaStore';
import { ChinaBatch } from '../types';
import { chinaPostPricePerUnit, chinaPostQtyError, chinaRubText } from '../lib/chinaBatchForm';
import { newOperationId } from '../lib/utils';

interface ChinaPostModalProps {
  batch: ChinaBatch;
  onClose: () => void;
}

/**
 * Item 84 (stage 2): the confirmation window of «Оприходовать» — one row per article of
 * `batch.postingPreview`, an editable quantity (default the ordered one), and the provisional
 * price per unit (display only, the server computes the real cost). `opId` is generated ONCE
 * when the window opens (useRef, not state — a re-render must not mint a new one) so a double
 * click on «Оприходовать» cannot post the batch twice.
 */
export const ChinaPostModal: React.FC<ChinaPostModalProps> = ({ batch, onClose }) => {
  const postChinaBatch = useChinaStore((s) => s.postChinaBatch);
  const isSaving = useChinaStore((s) => s.isSaving);
  const opIdRef = useRef(newOperationId());
  const preview = batch.postingPreview || [];
  const [qty, setQty] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    preview.forEach((p) => { initial[p.article] = String(p.qty); });
    return initial;
  });

  const errors: Record<string, string | null> = {};
  preview.forEach((p) => { errors[p.article] = chinaPostQtyError(qty[p.article] ?? ''); });
  const hasErrors = Object.values(errors).some((e) => e !== null);

  const handleConfirm = async () => {
    if (hasErrors) return;
    const lines = preview.map((p) => ({ article: p.article, qty: Number(qty[p.article]) }));
    const ok = await postChinaBatch({ id: batch.id, opId: opIdRef.current, lines });
    if (ok) onClose();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <h2 className="text-lg font-bold">Оприходовать партию {batch.code}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto grow">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase text-slate-400 text-left border-b border-slate-100">
                <th className="py-2 pr-3">Артикул</th>
                <th className="py-2 pr-3">Заказано</th>
                <th className="py-2 pr-3">Оприходовать, шт</th>
                <th className="py-2 pr-3 whitespace-nowrap">Себестоимость ₽</th>
                <th className="py-2 pr-3 whitespace-nowrap">₽/шт (предварительная)</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((p) => {
                const error = errors[p.article];
                const qtyNum = Number(qty[p.article]);
                const pricePerUnit = error ? 0 : chinaPostPricePerUnit(p.costRub, qtyNum);
                return (
                  <tr key={p.article} className="border-b border-slate-50">
                    <td className="py-2 pr-3 font-mono font-bold">{p.article}</td>
                    <td className="py-2 pr-3">{p.qty}</td>
                    <td className="py-2 pr-3">
                      <input
                        data-testid={`input-post-qty-${p.article}`}
                        className={`px-2 py-1 border rounded text-sm w-24 ${error ? 'border-red-300' : 'border-slate-200'}`}
                        value={qty[p.article] ?? ''}
                        onChange={(e) => setQty((prev) => ({ ...prev, [p.article]: e.target.value }))}
                      />
                      {error && <span className="block text-[11px] text-red-600 mt-0.5">{error}</span>}
                    </td>
                    <td className="py-2 pr-3">{chinaRubText(p.costRub)} ₽</td>
                    <td className="py-2 pr-3 font-bold">{error ? '—' : `${chinaRubText(pricePerUnit)} ₽`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            Товар встанет на «Мой склад» по предварительной цене; когда заказ будет закрыт в отчёте
            китайцев, цена доведётся автоматически.
          </p>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-slate-500 hover:text-slate-700">Отмена</button>
          <button
            data-testid="btn-confirm-china-post"
            onClick={handleConfirm}
            disabled={isSaving || hasErrors}
            className="flex items-center gap-2 px-5 py-2 bg-indigo-600 text-white text-sm font-bold rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            {isSaving ? <Loader2 size={16} className="animate-spin" /> : <PackageCheck size={16} />}
            Оприходовать
          </button>
        </div>
      </div>
    </div>
  );
};
