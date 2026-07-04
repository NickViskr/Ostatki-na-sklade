import React, { useState, useEffect } from 'react';
import { useWarehouseStore } from '../store/useWarehouseStore';

interface KitModalProps {
  kitSku: string;
  onClose: () => void;
}

export function KitModal({ kitSku, onClose }: KitModalProps) {
  const [components, setComponents] = useState<{ componentSku: string; quantity: number }[]>([]);
  const [kitType, setKitType] = useState<'legacy' | 'virtual'>('legacy');
  
  const kits = useWarehouseStore(state => state.kits);
  const allSkus = useWarehouseStore(state => state.skus);
  const stock = useWarehouseStore(state => state.stock);
  const handleSaveKit = useWarehouseStore(state => state.handleSaveKit);
  const handleDeleteKit = useWarehouseStore(state => state.handleDeleteKit);
  const isProcessing = useWarehouseStore(state => state.isProcessing);

  useEffect(() => {
    const existing = kits.find(k => k.kitSku === kitSku);
    setComponents(
      existing?.components ? existing.components.map(c => ({ ...c })) : []
    );
    setKitType(existing?.type || 'legacy');
  }, [kitSku, kits]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const getAvailableSkus = (currentIndex: number) => {
    const taken = components
      .map((c, i) => (i !== currentIndex ? c.componentSku : null))
      .filter(Boolean);
    return allSkus.filter(s => s.sku !== kitSku && !taken.includes(s.sku));
  };

  const isValid =
    components.length > 0 &&
    components.every(c => c.componentSku !== '' && c.quantity > 0) &&
    new Set(components.map(c => c.componentSku)).size === components.length;

  return (
    <div
      className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-3xl p-6 w-full max-w-lg shadow-2xl flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xl font-bold text-slate-900">Состав комплекта</h3>
            <p className="text-sm text-slate-500 mt-0.5">
              Основной артикул:
              <span className="font-mono font-bold text-violet-600 ml-1">{kitSku}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-xl text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500"
          >
            ✕
          </button>
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            Тип комплекта
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setKitType('legacy')}
              className={`px-3 py-2.5 rounded-xl border text-xs text-left font-medium transition-all focus:outline-none ${
                kitType === 'legacy'
                  ? 'border-violet-600 bg-violet-50 text-violet-700 font-bold ring-2 ring-violet-600/25'
                  : 'border-slate-200 hover:bg-slate-50 text-slate-600'
              }`}
            >
              <div className="font-semibold text-sm">Складской</div>
              <div className="text-[10px] text-slate-400 mt-0.5 font-normal">Артикул списывается сам + компоненты</div>
            </button>
            <button
              type="button"
              onClick={() => setKitType('virtual')}
              className={`px-3 py-2.5 rounded-xl border text-xs text-left font-medium transition-all focus:outline-none ${
                kitType === 'virtual'
                  ? 'border-violet-600 bg-violet-50 text-violet-700 font-bold ring-2 ring-violet-600/25'
                  : 'border-slate-200 hover:bg-slate-50 text-slate-600'
              }`}
            >
              <div className="font-semibold text-sm">Виртуальный</div>
              <div className="text-[10px] text-slate-400 mt-0.5 font-normal">Списываются только компоненты</div>
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            Дополнительные артикулы
          </label>
          {components.map((comp, index) => (
            <div key={index} className="flex gap-2 items-center">
              <div className="relative flex-1">
                <select
                  value={comp.componentSku}
                  onChange={e => {
                    setComponents(cs =>
                      cs.map((c, i) => (i === index ? { ...c, componentSku: e.target.value } : c))
                    );
                  }}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-violet-500 bg-white appearance-none"
                >
                  <option value="" disabled>Выберите артикул</option>
                  {getAvailableSkus(index).map(s => (
                    <option key={s.sku} value={s.sku}>
                      {s.sku}
                    </option>
                  ))}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-400">
                  ▼
                </div>
              </div>
              <input
                type="number"
                min={1}
                value={comp.quantity || ''}
                onChange={e =>
                  setComponents(cs =>
                    cs.map((c, i) =>
                      i === index
                        ? { ...c, quantity: Math.max(1, Number(e.target.value)) }
                        : c
                    )
                  )
                }
                className="w-20 px-3 py-2 rounded-xl border border-slate-200 text-sm text-center outline-none focus:ring-2 focus:ring-violet-500"
              />
              <span className="text-xs text-slate-400 shrink-0">шт.</span>
              <button
                onClick={() => setComponents(cs => cs.filter((_, i) => i !== index))}
                className="p-1.5 hover:bg-red-50 text-slate-300 hover:text-red-400 rounded-lg transition-colors focus:outline-none"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            onClick={() => setComponents(cs => [...cs, { componentSku: '', quantity: 1 }])}
            className="w-full py-2 border-2 border-dashed border-slate-200 rounded-xl text-sm text-slate-400 hover:border-violet-300 hover:text-violet-500 transition-colors focus:outline-none"
          >
            + Добавить артикул
          </button>
        </div>

        {components.some(c => c.componentSku) && (
          <div className="bg-violet-50 rounded-2xl p-4 space-y-2">
            <p className="text-[10px] font-bold text-violet-600 uppercase tracking-widest">
              При отгрузке 1 шт. {kitSku} будет списано:
            </p>
            {components
              .filter(c => c.componentSku)
              .map(comp => {
                const stockItem = stock.find(s => s.article === comp.componentSku);
                const available = stockItem?.quantity ?? 0;
                const ok = available >= comp.quantity;
                return (
                  <div
                    key={comp.componentSku}
                    className={`flex items-center justify-between text-sm px-3 py-2 rounded-xl bg-white ${
                      !ok ? 'border border-red-200' : ''
                    }`}
                  >
                    <span className="font-mono font-medium text-slate-800">
                      {comp.componentSku}
                    </span>
                    <span className="text-slate-500">{comp.quantity} шт.</span>
                    <span
                      className={`text-xs ${
                        ok ? 'text-slate-400' : 'text-red-500 font-bold'
                      }`}
                    >
                      склад: {available} шт.
                    </span>
                    <span>{ok ? '✅' : '❌'}</span>
                  </div>
                );
              })}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          {kits.some(k => k.kitSku === kitSku) && (
            <button
              onClick={async () => {
                const ok = await handleDeleteKit(kitSku);
                if (ok) onClose();
              }}
              disabled={isProcessing}
              className="text-sm font-bold text-red-500 hover:text-red-600 hover:bg-red-50 px-4 py-2 rounded-xl transition-colors disabled:opacity-50 focus:outline-none"
            >
              Удалить комплект
            </button>
          )}
          <div className="flex gap-2 ml-auto">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-bold focus:outline-none"
            >
              Отмена
            </button>
            <button
              onClick={async () => {
                const ok = await handleSaveKit(kitSku, components, kitType);
                if (ok) onClose();
              }}
              disabled={!isValid || isProcessing}
              className="px-6 py-2 rounded-xl bg-violet-600 text-white text-sm font-bold hover:bg-violet-700 disabled:opacity-50 transition-colors focus:outline-none"
            >
              {isProcessing ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
