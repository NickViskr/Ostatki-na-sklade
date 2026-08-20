import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, 
  FileUp, 
  Settings2, 
  History, 
  BookOpen, 
  Database,
  Truck,
  Users,
  LogOut,
  Trash2,
  Book,
  ChevronLeft,
  ChevronRight,
  Package,
  Warehouse,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { useUIStore } from '../store/useUIStore';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: any) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab }) => {
  const currentUser = useWarehouseStore((state) => state.currentUser);
  const handleLogout = useWarehouseStore((state) => state.handleLogout);
  const isSidebarCollapsed = useUIStore((state) => state.isSidebarCollapsed);
  const setIsSidebarCollapsed = useUIStore((state) => state.setIsSidebarCollapsed);
  const gasError = useWarehouseStore((state) => state.gasError);
  const ozonSyncStatus = useWarehouseStore((state) => state.ozonSyncStatus);
  const fetchOzonSyncStatus = useWarehouseStore((state) => state.fetchOzonSyncStatus);

  const [isStatusExpanded, setIsStatusExpanded] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  useEffect(() => {
    fetchOzonSyncStatus();
    const interval = setInterval(() => {
      fetchOzonSyncStatus();
    }, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchOzonSyncStatus]);

  const lastRun = ozonSyncStatus?.lastRun;
  // Порог свежести 26 часов: плановые прогоны идут раз в 12 часов, но триггер Apps Script
  // плавает внутри часового окна, поэтому разрыв доходит до 13 часов. 26 часов дают запас
  // ровно на один пропущенный прогон и убирают ложные тревоги.
  const lastRunFresh = !!lastRun && (Date.now() - new Date(lastRun.time).getTime()) < 26 * 60 * 60 * 1000;
  const syncEnabled = ozonSyncStatus?.enabled === true;

  // Сколько шагов прогона упало. Разовые причины (429 от Ozon, ошибка кабинета code:2)
  // лечатся автоповтором, поэтому одна осечка — это предупреждение, а не сбой.
  const failedSteps = [
    lastRun?.ok === false,
    lastRun?.stocksOk === false,
    lastRun?.salesOk === false,
    lastRun?.clustersOk === false
  ].filter(Boolean).length;

  // Красный оставляем за настоящими поломками: автоопрос выключен, прогонов нет,
  // данные устарели, либо легли сразу все основные шаги.
  const allMainStepsFailed = lastRun?.ok === false && lastRun?.stocksOk === false && lastRun?.salesOk === false;
  const syncBroken = !!ozonSyncStatus && (!syncEnabled || !lastRun || !lastRunFresh || allMainStepsFailed);
  const syncWarning = !syncBroken && failedSteps > 0;
  const syncHealthy = !syncBroken && !syncWarning;

  const allOk = !gasError && (!ozonSyncStatus || syncHealthy);
  const statusLevel = gasError || syncBroken ? 'error' : (syncWarning ? 'warning' : 'ok');
  const statusLabel = statusLevel === 'ok'
    ? 'Система в норме'
    : (gasError ? 'Ошибка GAS' : (statusLevel === 'warning' ? 'Синхронизация с осечкой' : 'Сбой синхронизации Ozon'));
  const syncStatusReason = !syncEnabled ? 'Автоопрос выключен' : !lastRun ? 'Ещё не запускался' : !lastRunFresh ? 'Данные устарели (нет прогона > 26 ч)' : (syncWarning ? 'Часть данных не обновилась, подробности в журнале прогонов' : '');

  // Журнал прогонов приходит из бэкенда в хронологическом порядке — показываем свежие сверху.
  // slice() перед reverse() обязателен: reverse мутирует массив, а он лежит в сторе.
  const syncHistoryRaw = ozonSyncStatus?.history;
  const syncHistory: any[] = Array.isArray(syncHistoryRaw) ? syncHistoryRaw.slice().reverse() : [];



  const isCurrentUserAdmin = currentUser?.role?.toLowerCase() === 'admin' || 
    ['admin', 'админ', 'администратор'].includes(currentUser?.username?.toLowerCase() || '');
  const archivedItems = useWarehouseStore((state) => state.archivedItems);

  const rawText = useUIStore((state) => state.rawText);
  const setRawText = useUIStore((state) => state.setRawText);
  const askConfirmation = useUIStore((state) => state.askConfirmation);

  const handleTabClick = (tabId: string) => {
    if (activeTab === 'upload' && tabId !== 'upload' && rawText.trim() !== '') {
      askConfirmation(
        'Внимание',
        'На вкладке Загрузка есть несохраненные данные. Очистить их и перейти?',
        () => {
          setRawText('');
          setActiveTab(tabId);
        }
      );
    } else {
      setActiveTab(tabId);
    }
  };

  const menuItems = [
    { id: 'dashboard', label: 'Склад', icon: LayoutDashboard },
    { id: 'upload', label: 'Ручная загрузка', icon: FileUp },
    { id: 'manual', label: 'Списание', icon: Database },
    { id: 'shipment', label: 'Отгрузка', icon: Truck },
    { id: 'history', label: 'История', icon: History },
    { id: 'skus', label: 'SKU База', icon: BookOpen },
    { id: 'directory', label: 'Справочник', icon: Book },
    ...(isCurrentUserAdmin ? [
      { id: 'ozon', label: 'Поставки Озон', icon: Package },
      { id: 'ozonStocks', label: 'Остатки Озон', icon: Warehouse },
      { id: 'users', label: 'Пользователи', icon: Users },
      { id: 'deleted', label: 'Удаленное', icon: Trash2 },
      { id: 'settings', label: 'Настройки', icon: Settings2 }
    ] : []),
  ];

  return (
    <aside className={`
      ${isSidebarCollapsed ? 'md:w-20' : 'md:w-72'} 
      fixed bottom-0 left-0 right-0 w-full z-50 md:relative md:z-auto
      bg-white border-t md:border-t-0 md:border-r border-slate-200 
      flex flex-row md:flex-col md:h-screen transition-all duration-300 md:sticky top-0
    `}>
      <button
        onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        className="hidden md:flex absolute -right-3 top-10 items-center justify-center w-6 h-6 bg-white border border-slate-200 rounded-full shadow-sm text-slate-500 hover:text-indigo-600 hover:border-indigo-200 transition-colors z-20"
      >
        {isSidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>
      
      <div className={`p-2 flex-row w-full flex overflow-x-auto md:overflow-visible items-center md:items-stretch md:flex-col ${isSidebarCollapsed ? 'md:px-4' : 'md:p-8'} gap-2 md:gap-0`}>
        <div className={`hidden md:flex items-center gap-3 mb-8 ${isSidebarCollapsed ? 'justify-center' : ''}`}>
          <div className="w-10 h-10 shrink-0 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-200">
            <LayoutDashboard className="text-white shrink-0" size={24} />
          </div>
          {!isSidebarCollapsed && (
            <div className="overflow-hidden whitespace-nowrap">
              <h1 className="text-xl font-bold tracking-tight">Mercurius AI</h1>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Smart Inventory</p>
            </div>
          )}
        </div>

        <nav className="flex flex-row md:flex-col gap-1 w-full shrink-0 items-center md:items-stretch h-[60px] md:h-auto">
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => handleTabClick(item.id)}
              title={isSidebarCollapsed ? item.label : undefined}
              className={`flex-shrink-0 md:w-full flex items-center justify-center gap-0 md:gap-3 p-2 md:py-3 rounded-xl transition-all relative flex-col md:flex-row ${
                isSidebarCollapsed ? 'md:justify-center md:px-0' : 'md:justify-start md:px-4'
              } ${
                activeTab === item.id 
                  ? 'text-indigo-700 font-medium' 
                  : 'text-slate-500 md:hover:bg-slate-50'
              } ${
                activeTab === item.id && 'md:bg-indigo-50'
              }`}
            >
              <item.icon size={20} className={`shrink-0 ${activeTab === item.id && 'text-indigo-600 md:text-indigo-700'} mb-1 md:mb-0`} />
              {/* Every utility is named EXACTLY once — see rule 11.10 in the technical brief.
                  The collapsed menu used to emit «hidden md:hidden» and «hidden md:inline» at
                  the same time, and Tailwind places md:inline after md:hidden in the
                  stylesheet, so the label stayed visible and spilled out of the narrow panel.
                  Mobile visibility (label only on the active tab) and desktop visibility
                  (label hidden while collapsed) are now separate classes that cannot fight. */}
              <span className={`text-[10px] md:text-base whitespace-nowrap ${activeTab === item.id ? '' : 'hidden'} ${isSidebarCollapsed ? 'md:hidden' : 'md:inline'}`}>{item.label}</span>
              {item.id === 'deleted' && archivedItems.length > 0 && (
                <div className={`absolute bg-red-500 border-2 border-white rounded-full z-10 md:hidden right-1 top-1 w-2.5 h-2.5`} />
              )}
              {item.id === 'deleted' && archivedItems.length > 0 && (
                <div className={`hidden md:block absolute bg-red-500 border-2 border-white rounded-full z-10 ${isSidebarCollapsed ? 'right-2 shadow-sm' : 'left-6'} top-2.5 w-2.5 h-2.5`} />
              )}
              {activeTab === item.id && !isSidebarCollapsed && (
                <div className="hidden md:block ml-auto w-1.5 h-1.5 shrink-0 bg-indigo-600 rounded-full" />
              )}
            </button>
          ))}
          {currentUser && (
            <button
              key="logout"
              onClick={() => 
                askConfirmation(
                  'Выход из системы',
                  'Вы уверены, что хотите выйти? Несохраненные изменения будут потеряны.',
                  handleLogout
                )
              }
              title={`Выйти (${currentUser.username})`}
              className="md:hidden flex-shrink-0 flex items-center justify-center gap-0 p-2 rounded-xl transition-all relative flex-col text-slate-500"
            >
              <LogOut size={20} className="shrink-0 mb-1" />
              <span className="text-[10px] whitespace-nowrap hidden md:inline">Выйти</span>
            </button>
          )}
        </nav>
      </div>

      <div className={`hidden md:block mt-auto space-y-4 ${isSidebarCollapsed ? 'p-4' : 'p-8'}`}>
        {currentUser && (
          <div className={`flex items-center ${isSidebarCollapsed ? 'justify-center p-2' : 'justify-between p-4'} bg-indigo-50 rounded-2xl border border-indigo-100`}>
            <div className="flex items-center gap-3">

              <div 
                className={`flex shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white font-bold text-xs ${isSidebarCollapsed ? 'w-10 h-10 shadow-sm relative group cursor-pointer' : 'w-8 h-8'}`}
                title={isSidebarCollapsed ? `Выйти (${currentUser.username})` : undefined}
                onClick={isSidebarCollapsed ? () => 
                  askConfirmation(
                    'Выход из системы',
                    'Вы уверены, что хотите выйти? Несохраненные изменения будут потеряны.',
                    handleLogout
                  ) : undefined}
              >
                {currentUser.username.charAt(0).toUpperCase()}
                {isSidebarCollapsed && (
                  <div className="absolute inset-0 bg-rose-600 rounded-full opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white">
                    <LogOut size={14} />
                  </div>
                )}
              </div>
              {!isSidebarCollapsed && (
                <div className="flex flex-col overflow-hidden whitespace-nowrap">
                  <span className="text-sm font-bold text-slate-900 truncate">{currentUser.username}</span>
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider">
                    {isCurrentUserAdmin ? 'Админ' : (currentUser.role === 'user' ? 'Пользователь' : currentUser.role || 'Пользователь')}
                  </span>
                </div>
              )}
            </div>
            {!isSidebarCollapsed && (
              <button 
                onClick={() => 
                  askConfirmation(
                    'Выход из системы',
                    'Вы уверены, что хотите выйти? Несохраненные изменения будут потеряны.',
                    handleLogout
                  )
                }
                className="p-2 shrink-0 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors"
                title="Выйти"
              >
                <LogOut size={16} />
              </button>
            )}
          </div>
        )}
        <div 
          className={`bg-slate-50 border border-slate-100 flex ${isSidebarCollapsed ? 'p-3 justify-center rounded-2xl cursor-help' : 'p-4 rounded-2xl flex-col'}`} 
          title={isSidebarCollapsed ? "Статус системы: " + statusLabel : undefined}
        >
          {!isSidebarCollapsed && (
            <>
              <p className="text-xs text-slate-500 mb-2">Статус системы</p>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 overflow-hidden">
                  <div className={`w-2 h-2 shrink-0 rounded-full ${statusLevel === 'ok' ? 'bg-emerald-500 animate-pulse' : (statusLevel === 'warning' ? 'bg-amber-500' : 'bg-red-500')}`} />
                  <span className={`text-xs font-bold whitespace-nowrap ${statusLevel === 'ok' ? 'text-slate-700' : (statusLevel === 'warning' ? 'text-amber-600' : 'text-red-600')}`}>
                    {statusLabel}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsStatusExpanded(!isStatusExpanded)}
                  className="p-1 text-slate-400 hover:text-slate-600 rounded transition-colors"
                  title={isStatusExpanded ? "Свернуть" : "Подробнее"}
                >
                  {isStatusExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
              </div>

              {isStatusExpanded && (
                <div className="mt-3 pt-3 border-t border-slate-200/60 space-y-1.5">
                  {/* a) Связь с GAS */}
                  <div className="flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${gasError ? 'bg-red-500' : 'bg-emerald-500'}`} />
                    <span className={`text-xs ${gasError ? 'text-red-600 font-medium' : 'text-slate-600'}`}>
                      {gasError ? 'Ошибка GAS' : 'Связь с GAS'}
                    </span>
                  </div>

                  {/* b) Заявки Ozon */}
                  <div className="flex items-center gap-2" title={lastRun?.ok === false ? (lastRun?.message || 'Ошибка') : undefined}>
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${lastRun?.ok === true ? 'bg-emerald-500' : lastRun?.ok === false ? 'bg-red-500' : 'bg-slate-300'}`} />
                    <span className={`text-xs ${lastRun?.ok === true ? 'text-slate-600' : lastRun?.ok === false ? 'text-red-600 font-medium' : 'text-slate-500'}`}>
                      Заявки Ozon{lastRun?.ok === undefined ? ': нет данных' : ''}
                    </span>
                  </div>

                  {/* c) Остатки Ozon */}
                  <div className="flex items-center gap-2" title={lastRun?.stocksOk === false ? (lastRun?.stocksMessage || 'Ошибка') : undefined}>
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${lastRun?.stocksOk === true ? 'bg-emerald-500' : lastRun?.stocksOk === false ? 'bg-red-500' : 'bg-slate-300'}`} />
                    <span className={`text-xs ${lastRun?.stocksOk === true ? 'text-slate-600' : lastRun?.stocksOk === false ? 'text-red-600 font-medium' : 'text-slate-500'}`}>
                      Остатки Ozon{lastRun?.stocksOk === undefined ? ': нет данных' : ''}
                    </span>
                  </div>

                  {/* d) Продажи Ozon */}
                  <div className="flex items-center gap-2" title={lastRun?.salesOk === false ? (lastRun?.salesMessage || 'Ошибка') : undefined}>
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${lastRun?.salesOk === true ? 'bg-emerald-500' : lastRun?.salesOk === false ? 'bg-red-500' : 'bg-slate-300'}`} />
                    <span className={`text-xs ${lastRun?.salesOk === true ? 'text-slate-600' : lastRun?.salesOk === false ? 'text-red-600 font-medium' : 'text-slate-500'}`}>
                      Продажи Ozon{lastRun?.salesOk === undefined ? ': нет данных' : ''}
                    </span>
                  </div>

                  {lastRun?.time && (
                    <div className="text-slate-400 font-mono text-[10px] pt-1">
                      {new Date(lastRun.time).toLocaleString('ru-RU')}
                    </div>
                  )}

                  {syncStatusReason && (
                    <div className="text-red-600 text-[10px] pt-0.5 break-words">
                      {syncStatusReason}
                    </div>
                  )}

                  {syncHistory.length > 0 && (
                    <div className="pt-1.5 border-t border-slate-200/60 mt-1.5">
                      <button
                        type="button"
                        onClick={() => setIsHistoryOpen(!isHistoryOpen)}
                        className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-700 transition-colors"
                      >
                        {isHistoryOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                        Журнал прогонов ({syncHistory.length})
                      </button>

                      {isHistoryOpen && (
                        <div className="mt-1.5 space-y-1.5 max-h-48 overflow-y-auto pr-1">
                          {syncHistory.map((run, runIdx) => {
                            const runOk = run?.ok === true && run?.stocksOk !== false && run?.salesOk !== false && run?.clustersOk !== false;
                            const runErrors: any[] = Array.isArray(run?.errors) ? run.errors : [];
                            return (
                              <div key={`${run?.time || 'run'}-${runIdx}`} className="flex items-start gap-1.5">
                                <div className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1 ${runOk ? 'bg-emerald-500' : 'bg-red-500'}`} />
                                <div className="min-w-0 flex-1">
                                  <div className="text-[10px] font-mono text-slate-500">
                                    {run?.time ? new Date(run.time).toLocaleString('ru-RU') : '—'}
                                    {run?.target === 'test' ? ' · тест' : ''}
                                  </div>
                                  {runErrors.map((errText, errIdx) => (
                                    <div key={errIdx} className="text-[10px] text-red-600 break-words leading-snug">
                                      {String(errText)}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {isSidebarCollapsed && (
            <div className={`w-2 h-2 shrink-0 rounded-full ${statusLevel === 'ok' ? 'bg-emerald-500 animate-pulse' : (statusLevel === 'warning' ? 'bg-amber-500' : 'bg-red-500')}`} />
          )}
        </div>

        {/* Метка версии сборки: обновляется при каждой сборке, показывает, что именно задеплоено */}
        {!isSidebarCollapsed && (
          <div
            className="mt-2 text-[10px] text-slate-400 font-mono text-center"
            title={`Версия сборки: ${__APP_BUILD__}`}
          >
            Сборка {__APP_BUILD__}
          </div>
        )}
      </div>

    </aside>
  );
};
