// Item 88, ticket 05: formatting helpers and column constants shared by every part of the
// «Остатки Озон» screen. Pure display code, no calculation — moved out of OzonStocksTab.tsx
// verbatim so every part can format the tab model's output the same way.
import React from 'react';
import { HelpCircle } from 'lucide-react';
import type { CoverageTone, SalesTrend } from '../lib/ozonCoverage';
import type { useWarehouseStore } from '../store/useWarehouseStore';

export const OZON_TOGGLEABLE_COLS: { key: string; label: string }[] = [
  { key: 'sold', label: 'Продано' },
  { key: 'speed', label: 'Скорость' },
  { key: 'trend', label: 'Тренд' },
  { key: 'share', label: 'Доля' },
  { key: 'available', label: 'Доступно' },
  { key: 'preparing', label: 'Готовим' },
  { key: 'requested', label: 'В заявках' },
  { key: 'transit', label: 'В пути' },
  { key: 'excess', label: 'Излишки' },
  { key: 'returns', label: 'Возвраты' },
  { key: 'other', label: 'Прочее' },
  { key: 'estimated', label: 'Расчётный' },
  { key: 'coverage', label: 'Покрытие' },
  { key: 'pending', label: 'Едет' },
  { key: 'myStock', label: 'Мой склад' },
  { key: 'recommendation', label: 'Рекомендация' },
  { key: 'factory', label: 'Заказ на фабрике' },
  { key: 'orderCost', label: 'Стоимость заказа, ₽' },
];

/** The settings the supply modals and the recommendations panel need — the store's own type. */
export type OzonSupplySettingsShape = ReturnType<typeof useWarehouseStore.getState>['ozonSupplySettings'];

export const ColHint: React.FC<{ text: string }> = ({ text }) => (
  <span className="relative inline-flex group align-middle ml-1">
    <HelpCircle size={12} className="text-slate-300 hover:text-indigo-500 cursor-help" />
    <span className="pointer-events-none absolute right-0 top-full mt-2 z-30 hidden group-hover:block w-64 bg-slate-800 text-white text-[11px] font-normal normal-case text-left rounded-xl px-3 py-2 shadow-lg leading-snug whitespace-normal">
      {text}
    </span>
  </span>
);

export const fmtInt = (v: number | null | undefined) => Math.round(Number(v) || 0).toLocaleString('ru-RU');

export const fmtSpeed = (v: number | null | undefined) => (Number(v) || 0).toFixed(2);

// Пункт 38. Множитель тренда — как остальные дробные величины в интерфейсе, с запятой вместо точки.
export const fmtTrend = (v: number | null | undefined) => (Number(v) || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const TREND_REASON_SHORT: Record<string, string> = {
  shortWindow: 'мало данных',
  correction: 'скорость скорректирована',
  zeroWeek: 'нулевые недели',
  fewSales: 'мелкая выборка',
  deficit: 'распродан',
  clamped: 'упёрся в предел',
  lookback: 'товара долго не было',
};

export const TREND_REASON_LONG: Record<string, (t: SalesTrend) => string> = {
  shortWindow: () => 'В окне меньше шести недель с данными — тренд считать не на чем.',
  correction: () => 'Скорость уже поднята коррекцией из-за распродажи товара. Тренд поверх неё не применяется: оба механизма поднимают скорость одним и тем же способом.',
  zeroWeek: (t) => `В окне ${t.zeroWeeks} нед. с нулевыми продажами. Это чаще старт продаж или отсутствие товара, а не спрос.`,
  fewSales: (t) => `За окно продано ${fmtInt(t.windowQty)} шт — меньше порога в 50 шт. На такой выборке наклон это шум.`,
  deficit: () => 'Товар распродан. Понижающий тренд не применяется: падение продаж неотличимо от отсутствия товара.',
  clamped: () => 'Множитель ограничен диапазоном 0,7…1,5.',
  // Item 86, step D: a long-absent article has too few in-stock days to trust a trend line.
  lookback: () => 'Товара долго не было — тренд не применяется.',
};

export const fmtDays = (v: number | null | undefined, estimated: number) => {
  if (v === null || v === undefined) return estimated > 0 ? '∞' : '—';
  return `${Math.round(v)}`;
};

// Item 85, step 1.8: the colour comes from coverageTone — the thresholds of the recommendation.
export const TONE_CLASS: Record<CoverageTone, string> = {
  none: 'text-slate-400',
  red: 'text-red-600 font-bold',
  amber: 'text-amber-600 font-semibold',
  green: 'text-emerald-600 font-semibold',
};

export const fmtDateShort = (iso: string) => (iso && iso.length >= 10 ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}` : '');
export const fmtDateFull = (iso: string) => (iso && iso.length >= 10 ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '—');
