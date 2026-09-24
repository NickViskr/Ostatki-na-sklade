import React, { useEffect, useState } from 'react';
import { Wallet, Loader2, Trash2, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { useChinaStore } from '../store/useChinaStore';
import { chinaNumber } from '../lib/chinaBatchForm';
import { parseChinaPaymentText } from '../lib/chinaPaymentText';

const money = (value: number, currency: string): string =>
  `${(Number(value) || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

/** «2026-09-16» → «16.09» — the short form the owner writes by hand. */
const shortDate = (iso: string): string => {
  const m = String(iso || '').match(/^\d{4}-(\d{2})-(\d{2})$/);
  return m ? `${m[2]}.${m[1]}` : iso;
};

/**
 * Item 81g: payments distributed by the Chinese financial report.
 *
 * A payment no longer names an order or a purpose — the owner writes the sentence he would
 * write anyway («сегодня оплатил 100000 руб по курсу 12,4»), and it sits «не распределена» until
 * the report confirms which receipt of the goods log or the freight settlement it bought;
 * matching it is what feeds an order's rate. All money here is the script's own figure, never
 * computed in the browser.
 */
export const ChinaPaymentsCard: React.FC = () => {
  const money_ = useChinaStore((s) => s.money);
  const isSaving = useChinaStore((s) => s.isSaving);
  const savePayment = useChinaStore((s) => s.saveChinaPayment);
  const deletePayment = useChinaStore((s) => s.deleteChinaPayment);
  const matchPayment = useChinaStore((s) => s.matchChinaPayment);
  const unmatchPayment = useChinaStore((s) => s.unmatchChinaPayment);
  const fetchChinaMoney = useChinaStore((s) => s.fetchChinaMoney);

  const [text, setText] = useState('');
  const [date, setDate] = useState('');
  const [amountRub, setAmountRub] = useState('');
  const [rate, setRate] = useState('');
  const [comment, setComment] = useState('');
  const [picked, setPicked] = useState<Record<string, string>>({});

  useEffect(() => { fetchChinaMoney(); }, [fetchChinaMoney]);

  const readText = () => {
    const parsed = parseChinaPaymentText(text);
    if (!parsed.matched) {
      toast.error('Не понял сообщение. Нужны сумма в рублях и курс — или сумма в юанях, которую подтвердили китайцы');
      return;
    }
    // The date of THIS sentence, or none: kept from the payment before, it would quietly date a
    // payment made today with the day of the last one.
    setDate(parsed.date);
    setAmountRub(String(parsed.amountRub));
    setRate(parsed.rate ? String(parsed.rate) : '');
    toast.success('Разобрал сообщение — проверьте поля и добавьте оплату');
  };

  const add = async () => {
    const ok = await savePayment({
      date: date.trim(),
      amountRub: chinaNumber(amountRub),
      rate: chinaNumber(rate),
      comment: comment.trim()
    });
    if (ok) { setText(''); setDate(''); setAmountRub(''); setRate(''); setComment(''); }
  };

  const match = async (paymentId: string) => {
    const receiptId = picked[paymentId];
    if (!receiptId) {
      toast.error('Выберите поступление из отчёта');
      return;
    }
    const ok = await matchPayment(paymentId, receiptId);
    if (ok) setPicked((prev) => ({ ...prev, [paymentId]: '' }));
  };

  if (!money_) return null;

  const { payments, receipts, orders, pool, reports } = money_;
  const pending = payments.filter((p) => p.status === 'не распределена');
  const allocated = payments.filter((p) => p.status === 'распределена');
  const awaitingPayment = receipts.filter((r) => r.status === 'ждёт оплату');
  const receiptOf = (id: string) => receipts.find((r) => r.id === id) || null;

  const field = 'block px-3 py-2 border border-slate-200 rounded-lg text-sm';

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="flex items-center gap-2 font-bold">
          <Wallet size={18} className="text-indigo-600" /> Оплаты фабрике и карго
        </h2>
        <p className="text-sm text-slate-500">
          У китайцев: {money(pool.cny, '¥')}, из них известно по курсу {money(pool.knownCny, '¥')}
          {' '}({money(pool.knownRub, '₽')}){pool.pendingCny > 0 && <>, не распределено по заказам {money(pool.pendingCny, '¥')}</>}
          {pool.historyCny > 0 && <>, история без курса {money(pool.historyCny, '¥')}</>}
        </p>
      </div>

      <div className="flex items-end gap-2 flex-wrap">
        <label className="block grow">
          <span className="text-[11px] font-bold text-slate-500 uppercase">Сообщение об оплате</span>
          <input
            data-testid="input-china-payment-text"
            className={`${field} w-full`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="сегодня оплатил 100000 руб по курсу 12,4"
          />
        </label>
        <button
          data-testid="btn-china-payment-parse"
          onClick={readText}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-bold text-slate-600 hover:text-indigo-600"
        >
          <Wand2 size={16} /> Разобрать
        </button>
      </div>

      <div className="flex items-end gap-2 flex-wrap">
        <label className="block">
          <span className="text-[11px] font-bold text-slate-500 uppercase">Дата</span>
          <input type="date" className={field} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-[11px] font-bold text-slate-500 uppercase">Сумма ₽</span>
          <input className={`${field} w-32`} value={amountRub} onChange={(e) => setAmountRub(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-[11px] font-bold text-slate-500 uppercase">Курс ₽/¥</span>
          <input className={`${field} w-24`} value={rate} onChange={(e) => setRate(e.target.value)} />
        </label>
        <label className="block grow">
          <span className="text-[11px] font-bold text-slate-500 uppercase">Комментарий</span>
          <input className={`${field} w-full`} value={comment} onChange={(e) => setComment(e.target.value)} />
        </label>
        <button
          data-testid="btn-china-payment-add"
          onClick={add}
          disabled={isSaving}
          className="px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 disabled:opacity-50"
        >
          {isSaving ? <Loader2 size={16} className="animate-spin" /> : 'Добавить оплату'}
        </button>
      </div>

      <p className="text-xs text-slate-500">
        Оплата ложится в «нераспределённые» до отчёта китайцев — только он говорит, какое
        поступление она купила и по какому заказу. Юани переводятся без комиссии, сумма может
        отличаться на округление.
      </p>

      {pending.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-bold text-sm">Нераспределённые оплаты</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase text-slate-400 text-left border-b border-slate-100">
                <th className="py-2 pr-3">Дата</th>
                <th className="py-2 pr-3">Сумма ₽</th>
                <th className="py-2 pr-3">Курс</th>
                <th className="py-2 pr-3">Комментарий</th>
                <th className="py-2 pr-3">Это поступление от…</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {pending.map((p) => (
                <tr key={p.id} className="border-b border-slate-50">
                  <td className="py-2 pr-3">{p.date}</td>
                  <td className="py-2 pr-3">{money(p.amountRub, '₽')}</td>
                  <td className="py-2 pr-3">{p.rate}</td>
                  <td className="py-2 pr-3 text-slate-500">{p.comment}</td>
                  <td className="py-2 pr-3">
                    {awaitingPayment.length > 0 ? (
                      <select
                        data-testid="select-china-payment-match"
                        className="px-2 py-1 border border-slate-200 rounded text-sm min-w-[260px]"
                        value={picked[p.id] || ''}
                        onChange={(e) => setPicked((prev) => ({ ...prev, [p.id]: e.target.value }))}
                      >
                        <option value="">— выберите поступление —</option>
                        {awaitingPayment.map((r) => (
                          <option key={r.id} value={r.id}>
                            {`это поступление от ${shortDate(r.date)} на ${r.totalCny} ¥` +
                              (r.goodsCny > 0 || r.freightCny > 0 ? ` (товар ${r.goodsCny} + доставка ${r.freightCny})` : '')}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-slate-400">в отчёте нет свободных поступлений</span>
                    )}
                  </td>
                  <td className="py-2 text-right flex items-center gap-2 justify-end">
                    <button
                      data-testid="btn-china-payment-match"
                      onClick={() => match(p.id)}
                      disabled={isSaving || !picked[p.id]}
                      className="px-3 py-1 bg-indigo-600 text-white rounded text-xs font-bold hover:bg-indigo-700 disabled:opacity-40"
                    >
                      Сопоставить
                    </button>
                    <button onClick={() => deletePayment(p.id)} className="text-slate-300 hover:text-red-500">
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {allocated.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-bold text-sm">Распределённые оплаты</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase text-slate-400 text-left border-b border-slate-100">
                <th className="py-2 pr-3">Дата</th>
                <th className="py-2 pr-3">Сумма ₽</th>
                <th className="py-2 pr-3">По отчёту, ¥</th>
                <th className="py-2 pr-3">Фактический курс</th>
                <th className="py-2 pr-3">Товар / доставка, ₽</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {allocated.map((p) => {
                const receipt = receiptOf(p.receiptId);
                return (
                  <tr key={p.id} className="border-b border-slate-50">
                    <td className="py-2 pr-3">{p.date}</td>
                    <td className="py-2 pr-3">{money(p.amountRub, '₽')}</td>
                    <td className="py-2 pr-3">{money(p.reportCny, '¥')}</td>
                    <td className="py-2 pr-3">{p.actualRate}</td>
                    <td className="py-2 pr-3">
                      {receipt ? `${money(receipt.rubGoods, '₽')} / ${money(receipt.rubFreight, '₽')}` : '—'}
                    </td>
                    <td className="py-2 text-right">
                      <button
                        data-testid="btn-china-payment-unmatch"
                        onClick={() => unmatchPayment(p.id)}
                        disabled={isSaving}
                        className="px-3 py-1 bg-white border border-slate-200 rounded text-xs font-bold text-slate-600 hover:text-red-600 disabled:opacity-40"
                      >
                        отменить сопоставление
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {awaitingPayment.length > 0 && (
        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-1">
          {awaitingPayment.map((r) => (
            <p key={r.id}>
              {`в отчёте есть поступление от ${shortDate(r.date)} на ${r.totalCny} ¥, а оплаты в приложении нет`}
            </p>
          ))}
        </div>
      )}

      {orders.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-bold text-sm">Заказы</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase text-slate-400 text-left border-b border-slate-100">
                <th className="py-2 pr-3">Заказ</th>
                <th className="py-2 pr-3">Получено ¥</th>
                <th className="py-2 pr-3">По курсу ¥ / ₽</th>
                <th className="py-2 pr-3">Не распределено</th>
                <th className="py-2 pr-3">История</th>
                <th className="py-2 pr-3">Средний курс</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.orderNo} className="border-b border-slate-50">
                  <td className="py-2 pr-3 font-bold">№{o.orderNo}</td>
                  <td className="py-2 pr-3">{money(o.receivedCny, '¥')}</td>
                  <td className="py-2 pr-3">{money(o.knownCny, '¥')} / {money(o.knownRub, '₽')}</td>
                  <td className="py-2 pr-3">{o.pendingCny > 0 ? money(o.pendingCny, '¥') : '—'}</td>
                  <td className="py-2 pr-3">{o.historyCny > 0 ? money(o.historyCny, '¥') : '—'}</td>
                  <td className="py-2 pr-3">
                    {o.rate || '—'}
                    {o.advanceWarning && <span className="block text-[10px] text-amber-600">аванс меньше 30 %</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {reports.length > 0 && (
        <p className="text-xs text-slate-400">
          Загруженные отчёты: {reports.slice(-3).map((r) => `${r.reportDate} (${r.source})`).join(', ')}
        </p>
      )}
    </div>
  );
};
