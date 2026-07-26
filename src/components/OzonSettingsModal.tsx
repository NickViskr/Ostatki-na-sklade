import React, { useState, useEffect } from 'react';
import { X, HelpCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useWarehouseStore } from '../store/useWarehouseStore';

interface OzonSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface OzonSettingsData {
  speedWeeks: number;
  minStockDays: number;
  targetStockDays: number;
  factoryOrderDays: number;
  returnsToSalePct: number;
  salesRetentionWeeks: number;
}

const FieldHint: React.FC<{ text: string; position?: 'top' | 'bottom' }> = ({ text, position = 'top' }) => (
  <span className="relative inline-flex group align-middle ml-1.5">
    <HelpCircle size={14} className="text-slate-400 hover:text-indigo-500 cursor-help" />
    <span
      className={`pointer-events-none absolute left-1/2 -translate-x-1/2 z-10 hidden group-hover:block w-64 bg-slate-800 text-white text-xs font-normal normal-case rounded-xl px-3 py-2 shadow-lg leading-snug whitespace-normal ${
        position === 'bottom' ? 'top-full mt-2' : 'bottom-full mb-2'
      }`}
    >
      {text}
    </span>
  </span>
);

export const OzonSettingsModal: React.FC<OzonSettingsModalProps> = ({ isOpen, onClose }) => {
  const fetchGas = useWarehouseStore((state) => state.fetchGas);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<OzonSettingsData>({
    speedWeeks: 4,
    minStockDays: 7,
    targetStockDays: 30,
    factoryOrderDays: 60,
    returnsToSalePct: 80,
    salesRetentionWeeks: 78,
  });

  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      fetchGas('getOzonSettings')
        .then((res) => {
          if (res?.status === 'success' && res.data) {
            setForm({
              speedWeeks: Number(res.data.speedWeeks) || 4,
              minStockDays: Number(res.data.minStockDays) || 7,
              targetStockDays: Number(res.data.targetStockDays) || 30,
              factoryOrderDays: Number(res.data.factoryOrderDays) || 60,
              returnsToSalePct: Number(res.data.returnsToSalePct) || 80,
              salesRetentionWeeks: Number(res.data.salesRetentionWeeks) || 78,
            });
          } else if (res?.status === 'error') {
            toast.error(res.message || 'Ошибка загрузки настроек Ozon');
          }
        })
        .catch((err) => {
          toast.error(err?.message || 'Ошибка обращения к серверу');
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [isOpen, fetchGas]);

  if (!isOpen) return null;

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: OzonSettingsData = {
        speedWeeks: Math.max(1, parseInt(String(form.speedWeeks), 10) || 1),
        minStockDays: Math.max(0, parseFloat(String(form.minStockDays)) || 0),
        targetStockDays: Math.max(0, parseFloat(String(form.targetStockDays)) || 0),
        factoryOrderDays: Math.max(0, parseFloat(String(form.factoryOrderDays)) || 0),
        returnsToSalePct: Math.min(100, Math.max(0, parseFloat(String(form.returnsToSalePct)) || 0)),
        salesRetentionWeeks: Math.max(1, parseInt(String(form.salesRetentionWeeks), 10) || 1),
      };

      const res = await fetchGas('saveOzonSettings', { data: payload });
      if (res?.status === 'success') {
        toast.success('Настройки Ozon сохранены');
        onClose();
      } else {
        toast.error(res?.message || 'Ошибка сохранения настроек Ozon');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Ошибка сети при сохранении настроек');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 fade-in">
      <div className="bg-white rounded-3xl shadow-xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh] modal-enter">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <h3 className="text-xl font-bold text-slate-900">Настройки Ozon</h3>
          <button
            onClick={onClose}
            type="button"
            className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-500"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          {loading ? (
            <div className="py-12 text-center text-slate-500 font-medium">
              Загрузка…
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Полных недель для скорости продаж
                  <FieldHint position="bottom" text="Сколько последних ПОЛНЫХ недель продаж берётся для расчёта скорости. Текущая незавершённая неделя не учитывается. Например, 4 — скорость = продажи за 4 полные недели ÷ 28 дней. Больше недель — стабильнее оценка, но медленнее реакция на изменение спроса." />
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={form.speedWeeks}
                  onChange={(e) =>
                    setForm({ ...form, speedWeeks: e.target.value === '' ? 0 : parseInt(e.target.value, 10) })
                  }
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm font-semibold text-slate-800 bg-slate-50/50"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Неснижаемый остаток, дней
                  <FieldHint position="bottom" text="Страховой запас в днях продаж, который всегда должен оставаться на складах Ozon. Вычитается при расчёте покрытия: покрытие = (расчётный остаток − скорость × эти дни) ÷ скорость. Чем больше значение, тем раньше появится рекомендация сделать поставку." />
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={form.minStockDays}
                  onChange={(e) =>
                    setForm({ ...form, minStockDays: e.target.value === '' ? 0 : parseFloat(e.target.value) })
                  }
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm font-semibold text-slate-800 bg-slate-50/50"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Целевой запас на Ozon, дней
                  <FieldHint position="bottom" text="На сколько дней продаж пополняется запас при поставке. Рекомендация поставки = скорость × (целевой запас + неснижаемые дни) − расчётный остаток кластера. Чем больше значение, тем крупнее и реже поставки." />
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={form.targetStockDays}
                  onChange={(e) =>
                    setForm({ ...form, targetStockDays: e.target.value === '' ? 0 : parseFloat(e.target.value) })
                  }
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm font-semibold text-slate-800 bg-slate-50/50"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Объём заказа на фабрике, дней
                  <FieldHint text="Размер одного заказа на фабрике в днях продаж: рекомендуемый объём = скорость продаж × это число дней. Сигнал «пора заказывать» появляется, когда общего запаса (Ozon + Мой склад) не хватает на срок поставки товара плюс неснижаемые дни." />
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={form.factoryOrderDays}
                  onChange={(e) =>
                    setForm({ ...form, factoryOrderDays: e.target.value === '' ? 0 : parseFloat(e.target.value) })
                  }
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm font-semibold text-slate-800 bg-slate-50/50"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  % возвратов, возвращающихся в продажу
                  <FieldHint text="Какая доля возвратов реально возвращается в продажу. Возвраты входят в расчётный остаток с этим коэффициентом: расчётный остаток = Доступно + В пути + Возвраты × этот %." />
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="any"
                  value={form.returnsToSalePct}
                  onChange={(e) =>
                    setForm({ ...form, returnsToSalePct: e.target.value === '' ? 0 : parseFloat(e.target.value) })
                  }
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm font-semibold text-slate-800 bg-slate-50/50"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Срок хранения продаж, недель
                  <FieldHint text="Сколько недель истории продаж хранится в листе «Продажи Ozon». Строки старше удаляются автоматически при синхронизации. 78 недель = 18 месяцев — запас для будущего анализа сезонности." />
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={form.salesRetentionWeeks}
                  onChange={(e) =>
                    setForm({ ...form, salesRetentionWeeks: e.target.value === '' ? 0 : parseInt(e.target.value, 10) })
                  }
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm font-semibold text-slate-800 bg-slate-50/50"
                />
              </div>
            </>
          )}
        </div>

        <div className="p-6 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-5 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-bold hover:bg-slate-100 transition-colors"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading}
            className="px-5 py-2.5 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-50"
          >
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  );
};
