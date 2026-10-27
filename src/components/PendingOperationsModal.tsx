import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useWarehouseStore } from '../store/useWarehouseStore';
import type { PendingOperation } from '../types';

/**
 * Item 97 / 96.10 (C2). «Операция не завершена»: shown at EVERY app start, to EVERY user, while the server still
 * holds the memo of an operation an earlier failure left half-done. Only the admin gets the buttons (the server
 * refuses everyone else too); the others read what is stuck and are told to turn to the administrator.
 * «Позже» hides the popup until the next app start — kept in this component's memory only, never in a storage.
 */

const STAGE_TEXT: Record<Exclude<PendingOperation['stage'], 'conflict'>, string> = {
  stock: 'Операция прервалась до записи остатков — ничего не записано.',
  history: 'Остаток уже изменён, но строки в «Истории» не записаны.',
  journal: 'Операция записана, но строка журнала «Себестоимость Озон» (для КАН) не дописана.',
  done: 'Операция записана полностью — осталась только служебная памятка.'
};
const CONFLICT_TEXT = (articles: string) =>
  `Остаток товаров ${articles} изменился после обрыва — довести или отменить автоматически нельзя. `
  + 'Сверьте их остаток вручную, исправьте и нажмите «Разобрано, убрать уведомление».';
// An operation another module started: the text has to agree with the buttons — «отмените» only when «Отменить операцию» exists.
const OTHER_ORIGIN_CANCEL_TEXT =
  'Операция проведена не кнопкой «Провести» (например, «Заказы в Китае» или возврат) — отмените её и повторите действие там.';
const OTHER_ORIGIN_CHECK_TEXT =
  'Операция проведена не кнопкой «Провести» (например, «Заказы в Китае» или возврат). Проверьте вручную, что действие отмечено там, '
  + 'где оно проводилось (например, партия в «Заказах в Китае» отмечена оприходованной), и нажмите «Разобрано, убрать уведомление».';
const DAMAGED_TEXT = 'Памятка этой операции повреждена, прочитать её нельзя. Проверьте остатки вручную и уберите уведомление.';

/** When the operation started, in the user's own time zone: ДД.ММ.ГГГГ ЧЧ:ММ. An unreadable value is shown as it came. */
const whenText = (startedAt: string): string => {
  const d = new Date(startedAt);
  if (!startedAt || Number.isNaN(d.getTime())) return startedAt || '';
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(d.getDate())}.${two(d.getMonth() + 1)}.${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}`;
};

export const PendingOperationsModal: React.FC = () => {
  const pendingOperations = useWarehouseStore((state) => state.pendingOperations);
  const currentUser = useWarehouseStore((state) => state.currentUser);
  const isProcessing = useWarehouseStore((state) => state.isProcessing);
  const resolvePendingOperation = useWarehouseStore((state) => state.resolvePendingOperation);
  const [later, setLater] = useState(false);

  if (later || !pendingOperations || pendingOperations.length === 0) return null;

  // Same test as the server's isAdminRole; the server is the one that really decides.
  const role = String(currentUser?.role || '').trim().toLowerCase();
  const isAdmin = role === 'admin' || role === 'администратор';

  const buttonBase = 'flex-1 min-w-[10rem] py-3 px-4 rounded-2xl font-bold text-sm transition-all disabled:opacity-50';

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[110] flex items-center justify-center p-4 fade-in">
      <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-2xl overflow-hidden modal-enter flex flex-col max-h-[90vh]">
        <div className="p-8 border-b border-slate-100 flex items-center gap-4 bg-amber-50 shrink-0">
          <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center text-amber-600 shrink-0">
            <AlertTriangle size={24} />
          </div>
          <h3 className="text-2xl font-bold text-slate-900">Операция не завершена</h3>
        </div>

        <div className="p-8 space-y-4 overflow-y-auto grow">
          {!isAdmin && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-6 py-4 text-sm text-amber-800">
              Обратитесь к администратору: только он может довести операцию до конца, отменить её или убрать это уведомление.
            </div>
          )}

          {pendingOperations.map((op) => {
            const damaged = op.damaged === true;
            const articleNames = op.articles.map((a) => a.article).join(', ');
            const explanation = damaged ? DAMAGED_TEXT : (op.stage === 'conflict' ? CONFLICT_TEXT(articleNames) : STAGE_TEXT[op.stage]);
            const originText = op.canCancel ? OTHER_ORIGIN_CANCEL_TEXT : OTHER_ORIGIN_CHECK_TEXT;
            // Neither finishing nor cancelling is possible: the admin's only way out is to confirm it was sorted out by hand.
            const deadEnd = !op.canComplete && !op.canCancel;
            return (
              <div key={op.opId} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-5 space-y-3">
                <div className="flex justify-between gap-3 text-xs text-slate-500">
                  <span className="font-mono break-all">{op.opId}</span>
                  <span className="shrink-0">{whenText(op.startedAt)}</span>
                </div>

                {!damaged && (
                  <div className="text-sm font-semibold text-slate-700">
                    {[op.type, op.destination].filter(Boolean).join(' · ')}
                    {op.user && <span className="font-normal text-slate-500"> — {op.user}</span>}
                  </div>
                )}

                {op.articles.length > 0 && (
                  <div className="space-y-1">
                    {op.articles.map((a) => (
                      <div key={a.article} className="flex justify-between gap-3 text-xs text-slate-600">
                        <span>{a.article}</span>
                        <span>{a.quantity} шт.</span>
                      </div>
                    ))}
                  </div>
                )}

                <p className="text-sm text-slate-700">{explanation}</p>
                {!damaged && op.origin === 'other' && <p className="text-sm text-slate-700">{originText}</p>}

                {isAdmin && (
                  <div className="flex flex-wrap gap-3 pt-1">
                    {op.canComplete && (
                      <button
                        onClick={() => resolvePendingOperation(op.opId, 'complete')}
                        disabled={isProcessing}
                        className={`${buttonBase} bg-slate-900 text-white hover:bg-slate-800 shadow-xl`}
                      >
                        Довести до конца
                      </button>
                    )}
                    {op.canCancel && (
                      <button
                        onClick={() => resolvePendingOperation(op.opId, 'cancel')}
                        disabled={isProcessing}
                        className={`${buttonBase} bg-white text-red-600 border border-red-200 hover:bg-red-50`}
                      >
                        Отменить операцию
                      </button>
                    )}
                    {deadEnd && (
                      <button
                        onClick={() => resolvePendingOperation(op.opId, 'dismiss')}
                        disabled={isProcessing}
                        className={`${buttonBase} bg-amber-500 text-white hover:bg-amber-600 shadow-md`}
                      >
                        Разобрано, убрать уведомление
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="p-8 bg-slate-50 border-t border-slate-100 flex shrink-0">
          <button
            onClick={() => setLater(true)}
            className="flex-1 py-4 rounded-2xl font-bold text-slate-500 hover:bg-white transition-all border border-transparent hover:border-slate-200"
          >
            Позже
          </button>
        </div>
      </div>
    </div>
  );
};
