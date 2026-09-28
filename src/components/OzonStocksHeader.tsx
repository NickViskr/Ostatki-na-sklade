// Item 88, ticket 05: the title bar and its buttons (manual mode, fullscreen, columns menu,
// settings, cost export, refresh) — moved out of OzonStocksTab.tsx verbatim. Draws only; every
// value and handler comes from the screen.
import React from 'react';
import { Columns3, FileDown, Maximize2, PackagePlus, RefreshCw, Settings } from 'lucide-react';
import { User } from '../types';
import { canEditOzonSettings } from '../lib/ozonSettingsFields';
import { OZON_TOGGLEABLE_COLS } from './ozonStocksFormat';

interface OzonStocksHeaderProps {
  maxUpdatedAt: string;
  manualMode: boolean;
  setManualMode: (value: boolean) => void;
  exitManualMode: () => void;
  onFullscreen: () => void;
  showColsMenu: boolean;
  onToggleColsMenu: () => void;
  isColVisible: (key: string) => boolean;
  onToggleCol: (key: string) => void;
  currentUser: User | null | undefined;
  onOpenSettings: () => void;
  isProcessing: boolean;
  onExportKanCost: () => void;
  onRefresh: () => void;
}

export const OzonStocksHeader: React.FC<OzonStocksHeaderProps> = ({
  maxUpdatedAt, manualMode, setManualMode, exitManualMode, onFullscreen, showColsMenu, onToggleColsMenu,
  isColVisible, onToggleCol, currentUser, onOpenSettings, isProcessing, onExportKanCost, onRefresh,
}) => (
  <div
    className="flex justify-between items-center"
    id="ozon-stocks-header"
  >
    <div className="flex items-center gap-3">
      <h3 className="text-xl font-bold text-slate-800">Остатки на складах Ozon</h3>
      {maxUpdatedAt && (
        <span className="text-xs text-slate-400 font-medium">
          Обновлено: {maxUpdatedAt}
        </span>
      )}
    </div>
    <div className="flex items-center gap-2">
      {/* Пункт 63. Вход в режим ручного выбора. Пока он выключен, таблица работает как раньше. */}
      <button
        type="button"
        id="btn-ozon-manual-supply"
        onClick={() => (manualMode ? exitManualMode() : setManualMode(true))}
        className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl transition-all shadow-xs border ${
          manualMode
            ? 'text-white bg-indigo-600 border-indigo-600 hover:bg-indigo-700'
            : 'text-indigo-600 bg-white border-slate-200 hover:border-slate-300 hover:text-indigo-700'
        }`}
      >
        <PackagePlus size={14} />
        {manualMode ? 'Отменить выбор' : 'Оформить поставку'}
      </button>
      <button
        type="button"
        id="btn-ozon-fullscreen"
        onClick={onFullscreen}
        className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-700 bg-white border border-slate-200 hover:border-slate-300 px-3 py-1.5 rounded-xl transition-all shadow-xs"
      >
        <Maximize2 size={14} />
        Развернуть
      </button>
      <div className="relative">
        <button
          type="button"
          id="btn-ozon-columns"
          onClick={onToggleColsMenu}
          className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-700 bg-white border border-slate-200 hover:border-slate-300 px-3 py-1.5 rounded-xl transition-all shadow-xs"
        >
          <Columns3 size={14} />
          Колонки
        </button>
        {showColsMenu && (
          <div className="absolute right-0 mt-2 z-20 bg-white border border-slate-200 rounded-2xl shadow-lg p-3 w-56 max-h-80 overflow-y-auto" id="ozon-columns-menu">
            <div className="text-[10px] uppercase tracking-wide font-bold text-slate-400 mb-2">Показывать колонки</div>
            {OZON_TOGGLEABLE_COLS.map((col) => (
              <label key={col.key} className="flex items-center gap-2 py-1 cursor-pointer text-xs text-slate-700 hover:text-slate-900">
                <input
                  type="checkbox"
                  checked={isColVisible(col.key)}
                  onChange={() => onToggleCol(col.key)}
                  className="rounded border-slate-300"
                />
                {col.label}
              </label>
            ))}
          </div>
        )}
      </div>
      {canEditOzonSettings(currentUser) && (
        <button
          type="button"
          id="btn-ozon-settings"
          onClick={onOpenSettings}
          className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-700 bg-white border border-slate-200 hover:border-slate-300 px-3 py-1.5 rounded-xl transition-all shadow-xs"
        >
          <Settings size={14} />
          Настройки
        </button>
      )}
      <button
        type="button"
        id="btn-kan-cost-export"
        title="Собрать файл себестоимости для загрузки в КАН"
        disabled={isProcessing}
        onClick={onExportKanCost}
        className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-700 bg-white border border-slate-200 hover:border-slate-300 px-3 py-1.5 rounded-xl transition-all shadow-xs disabled:opacity-50"
      >
        <FileDown size={14} />
        Себестоимость КАН
      </button>
      <button
        type="button"
        id="btn-refresh-ozon-stocks"
        disabled={isProcessing}
        onClick={onRefresh}
        className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-700 bg-white border border-slate-200 hover:border-slate-300 px-3 py-1.5 rounded-xl transition-all shadow-xs disabled:opacity-50"
      >
        <RefreshCw size={14} className={`transition-transform ${isProcessing ? 'animate-spin' : ''}`} />
        Обновить
      </button>
    </div>
  </div>
);
