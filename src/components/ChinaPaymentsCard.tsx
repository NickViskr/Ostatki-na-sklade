import React, { useMemo, useState } from 'react';
import { Wallet, Loader2, Trash2, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { useChinaStore } from '../store/useChinaStore';
import { ChinaBatch, ChinaPayment } from '../types';
import { chinaNumber } from '../lib/chinaBatchForm';
import { parseChinaPaymentText } from '../lib/chinaPaymentText';

const PURPOSES = ['Товар', 'Перевозка'];

const money = (value: number, currency: string): string =>
  `${(Number(value) || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

interface ChinaPaymentsCardProps {
  batches: ChinaBatch[];
}

/**
 * Item 81d: the payments the owner made and the rate they set.
 *
 * He writes the sentence he would write anyway — «сегодня оплатил 100000 руб по курсу 12,4» —
 * and the fields below fill themselves; the yuan, or the rate, whichever he left out, is
 * worked out by the script. Putting a payment against an order is what gives the batches of
 * that order their ₽/¥ rate.
 */
export const ChinaPaymentsCard: React.FC<ChinaPaymentsCardProps> = ({ batches }) => {
  const payments = useChinaStore((s) => s.payments);
  const isSaving = useChinaStore((s) => s.isSaving);
  const savePayment = useChinaStore((s) => s.saveChinaPayment);
  const deletePayment = useChinaStore((s) => s.deleteChinaPayment);

  const [text, setText] = useState('');
  const [date, setDate] = useState('');
  const [amountRub, setAmountRub] = useState('');
  const [rate, setRate] = useState('');
  const [amountCny, setAmountCny] = useState('');
  const [purpose, setPurpose] = useState(PURPOSES[0]);
  const [orderNo, setOrderNo] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [comment, setComment] = useState('');

  const orders = useMemo(() => {
    const seen: Record<string, boolean> = {};
    const out: string[] = [];
    batches.forEach((b) => {
      const no = String(b.orderNo || '').trim();
      if (!no || seen[no]) return;
      seen[no] = true;
      out.push(no);
    });
    return out.sort((a, b) => Number(a) - Number(b));
  }, [batches]);

  const wallet = useMemo(() => {
    let rub = 0;
    let cny = 0;
    payments.forEach((p) => { rub += Number(p.amountRub) || 0; cny += Number(p.amountCny) || 0; });
    return { rub, cny, rate: cny > 0 ? Math.round((rub / cny) * 10000) / 10000 : 0 };
  }, [payments]);

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
    setAmountCny(parsed.amountCny ? String(parsed.amountCny) : '');
    toast.success('Разобрал сообщение — проверьте поля и добавьте оплату');
  };

  const add = async () => {
    const ok = await savePayment({
      date: date.trim(),
      amountRub: chinaNumber(amountRub),
      rate: chinaNumber(rate),
      amountCny: chinaNumber(amountCny),
      purpose,
      orderNo: orderNo.trim(),
      confirmed,
      comment: comment.trim()
    });
    if (ok) {
      setText(''); setDate(''); setAmountRub(''); setRate(''); setAmountCny(''); setComment(''); setConfirmed(false);
    }
  };

  // The owner's own order of events: he pays, and only later does the report of the Chinese
  // side say which order the money went to. The payment is then put against that order in
  // place — the script re-costs the batches of the order it lands on and of the one it left.
  const reassign = (p: ChinaPayment, patch: { orderNo?: string; confirmed?: boolean }) => savePayment({
    id: p.id,
    date: p.date,
    amountRub: p.amountRub,
    rate: p.rate,
    amountCny: p.amountCny,
    purpose: p.purpose,
    orderNo: patch.orderNo !== undefined ? patch.orderNo : p.orderNo,
    confirmed: patch.confirmed !== undefined ? patch.confirmed : p.confirmed,
    comment: p.comment
  });

  const field = 'block px-3 py-2 border border-slate-200 rounded-lg text-sm';

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="flex items-center gap-2 font-bold">
          <Wallet size={18} className="text-indigo-600" /> Оплаты фабрике и карго
        </h2>
        <p className="text-sm text-slate-500">
          Всего {money(wallet.rub, '₽')} → {money(wallet.cny, '¥')}
          {wallet.rate > 0 && <> · средний курс {wallet.rate} ₽/¥</>}
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
        <label className="block">
          <span className="text-[11px] font-bold text-slate-500 uppercase">Куплено ¥</span>
          <input className={`${field} w-28`} value={amountCny} onChange={(e) => setAmountCny(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-[11px] font-bold text-slate-500 uppercase">За что</span>
          <select className={field} value={purpose} onChange={(e) => setPurpose(e.target.value)}>
            {PURPOSES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-[11px] font-bold text-slate-500 uppercase">Заказ</span>
          <select data-testid="select-china-payment-order" className={field} value={orderNo} onChange={(e) => setOrderNo(e.target.value)}>
            <option value="">— не привязана —</option>
            {orders.map((no) => <option key={no} value={no}>№{no}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-600 pb-2">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          Подтверждено отчётом
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
        Курс ₽/¥ партии считается по оплатам её заказа: два транша по разным курсам дают
        средневзвешенный. Оплата без заказа в себестоимость не попадает — привяжите её к заказу,
        когда отчёт китайцев подтвердит приход денег.
      </p>

      {payments.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase text-slate-400 text-left border-b border-slate-100">
                <th className="py-2 pr-3">Дата</th>
                <th className="py-2 pr-3">Сумма ₽</th>
                <th className="py-2 pr-3">Курс ₽/¥</th>
                <th className="py-2 pr-3">Куплено ¥</th>
                <th className="py-2 pr-3">За что</th>
                <th className="py-2 pr-3">Заказ</th>
                <th className="py-2 pr-3">Отчёт</th>
                <th className="py-2 pr-3">Комментарий</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-b border-slate-50">
                  <td className="py-2 pr-3">{p.date}</td>
                  <td className="py-2 pr-3">{money(p.amountRub, '₽')}</td>
                  <td className="py-2 pr-3">{p.rate}</td>
                  <td className="py-2 pr-3">{money(p.amountCny, '¥')}</td>
                  <td className="py-2 pr-3">{p.purpose}</td>
                  <td className="py-2 pr-3">
                    <select
                      data-testid="select-china-payment-reassign"
                      className={`px-2 py-1 border rounded text-sm ${p.orderNo ? 'border-slate-200' : 'border-amber-300 text-amber-700'}`}
                      value={p.orderNo}
                      disabled={isSaving}
                      onChange={(e) => reassign(p, { orderNo: e.target.value })}
                    >
                      <option value="">— не привязана —</option>
                      {(p.orderNo && orders.indexOf(p.orderNo) === -1 ? [p.orderNo].concat(orders) : orders).map((no) => (
                        <option key={no} value={no}>№{no}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 pr-3">
                    <label className="flex items-center gap-1 text-sm">
                      <input
                        type="checkbox"
                        checked={p.confirmed}
                        disabled={isSaving}
                        onChange={(e) => reassign(p, { confirmed: e.target.checked })}
                      />
                      {p.confirmed ? 'подтверждена' : 'нет'}
                    </label>
                  </td>
                  <td className="py-2 pr-3 text-slate-500">{p.comment}</td>
                  <td className="py-2 text-right">
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
    </div>
  );
};
