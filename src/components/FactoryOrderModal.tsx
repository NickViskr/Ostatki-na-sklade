import React, { useEffect, useState } from 'react';
import { X, Save, Loader2, PackageCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { useUIStore } from '../store/useUIStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { FactoryOrder } from '../types';

interface FactoryOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  article: string;
  productName?: string;
  /** Расчётный объём заказа из сигнала «Заказ на фабрике», шт. */
  suggestedQty: number;
  pcsPerBox: number;
  leadTimeDays: number;
  /** Активный заказ по этому артикулу или null, если заказа ещё нет. */
  order: FactoryOrder | null;
}

const toIsoDate = (d: Date) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const FactoryOrderModal: React.FC<FactoryOrderModalProps> = ({
  isOpen,
  onClose,
  article,
  productName,
  suggestedQty,
  pcsPerBox,
  leadTimeDays,
  order,
}) => {
  const saveFactoryOrder = useWarehouseStore((state) => state.saveFactoryOrder);
  const setFactoryOrderReceived = useWarehouseStore((state) => state.setFactoryOrderReceived);
  const isProcessing = useWarehouseStore((state) => state.isProcessing);

  const setActiveTab = useUIStore((state) => state.setActiveTab);
  const setOpType = useUIStore((state) => state.setOpType);
  const setUploadDestination = useUIStore((state) => state.setUploadDestination);
  const setRawText = useUIStore((state) => state.setRawText);
  const destinations = useSettingsStore((state) => state.destinations);
  const addDestination = useSettingsStore((state) => state.addDestination);

  const [qty, setQty] = useState(0);
  const [expectedAt, setExpectedAt] = useState('');
  const [comment, setComment] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    const box = pcsPerBox > 0 ? pcsPerBox : 1;
    const defaultQty = order ? order.qty : Math.ceil(Math.max(0, suggestedQty) / box) * box;
    const eta = new Date();
    eta.setDate(eta.getDate() + (Number(leadTimeDays) || 0));
    setQty(defaultQty);
    setExpectedAt(order && order.expectedAt ? order.expectedAt : toIsoDate(eta));
    setComment(order ? order.comment : '');
  }, [isOpen, order, suggestedQty, pcsPerBox, leadTimeDays]);

  if (!isOpen) return null;

  const box = pcsPerBox > 0 ? pcsPerBox : 1;
  const boxes = Math.ceil((Number(qty) || 0) / box);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await saveFactoryOrder({
      id: order ? order.id : undefined,
      article,
      qty: Number(qty) || 0,
      expectedAt,
      comment,
    });
    if (ok) onClose();
  };

  const handleReceived = async () => {
    if (!order) return;
    const ok = await setFactoryOrderReceived(order.id);
    if (!ok) return;

    // Приход проводится существующим маршрутом «Загрузка» → распознавание → подтверждение.
    // Здесь только предзаполняем форму: тип операции, объект и текст накладной.
    if (!destinations.includes('Склад')) addDestination('Склад');
    setOpType('Приход');
    setUploadDestination('Склад');
    setRawText(`Приход партии с фабрики\n${article}  количество ${order.qty} шт`);
    setActiveTab('upload');
    onClose();
    toast.info('Заказ закрыт. Оформи приход партии — себестоимость укажешь на шаге подтверждения.', { duration: 8000 });
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4 fade-in">
      <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-md overflow-hidden modal-enter">
        <div className="p-6 border-b border-slate-100 flex justify-between items-start bg-slate-50/50">
          <div>
            <h3 className="text-xl font-bold text-slate-800">
              {order ? 'Заказ на фабрике' : 'Отметить заказ на фабрике'}
            </h3>
            <div className="text-xs text-slate-500 mt-1">
              <span className="font-mono font-bold text-slate-700">{article}</span>
              {productName ? ` · ${productName}` : ''}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 hover:bg-white rounded-xl transition-all border border-transparent hover:border-slate-200"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-5">
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase">Количество, шт</label>
            <input
              type="number"
              min="1"
              max="9999999"
              required
              value={qty === 0 ? '' : qty}
              onChange={(e) => setQty(e.target.value === '' ? 0 : Math.max(0, parseInt(e.target.value, 10) || 0))}
              className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-500 font-semibold"
            />
            <div className="text-[11px] text-slate-400">
              {boxes > 0 ? `${boxes} кор по ${box} шт` : 'Укажи количество'}
              {!order && suggestedQty > 0 ? ` · расчёт предлагает ${Math.ceil(suggestedQty)} шт` : ''}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase">Ожидаемое прибытие</label>
            <input
              type="date"
              required
              value={expectedAt}
              onChange={(e) => setExpectedAt(e.target.value)}
              className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-500 font-semibold"
            />
            <div className="text-[11px] text-slate-400">
              По умолчанию: сегодня + срок поставки из SKU Базы ({Number(leadTimeDays) || 0} дн.)
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase">Комментарий</label>
            <input
              type="text"
              maxLength={200}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Необязательно: фабрика, номер заказа"
              className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
            />
          </div>

          <div className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-2xl p-3 leading-snug">
            Отметка не меняет остатки и себестоимость: заказанный товар пока не лежит ни на складах Ozon, ни на твоём складе. Она гасит красный сигнал «Заказ на фабрике» до ожидаемой даты прибытия.
            <span className="block mt-2">
              Когда партия приедет, нажми «Партия пришла»: заказ закроется и откроется вкладка «Загрузка» с предзаполненным приходом на склад. Остатки поднимутся после обычного подтверждения прихода.
            </span>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-3 rounded-2xl font-bold text-slate-500 hover:bg-slate-50 transition-all border border-slate-200"
              >
                Отмена
              </button>
              <button
                type="submit"
                disabled={isProcessing}
                className="flex-1 bg-slate-900 text-white py-3 rounded-2xl font-bold hover:bg-slate-800 disabled:opacity-50 transition-all shadow-lg flex items-center justify-center gap-2"
              >
                {isProcessing ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                Сохранить
              </button>
            </div>
            {order && (
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={handleReceived}
                  disabled={isProcessing}
                  className="w-full py-3 rounded-2xl font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                >
                  <PackageCheck size={18} />
                  Партия пришла
                </button>
                <span className="text-[10px] text-slate-400 text-center">
                  Закроет заказ и откроет «Загрузка» с приходом {order.qty} шт на склад
                </span>
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};
