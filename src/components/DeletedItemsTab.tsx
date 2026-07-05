import React, { useEffect, useState } from 'react';
import { Trash2, RotateCcw, Box, User, History, Archive, Loader2, Calendar, ChevronDown } from 'lucide-react';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { ConfirmDialog } from './ConfirmDialog';

export const DeletedItemsTab: React.FC = React.memo(() => {
  const archivedItems = useWarehouseStore((state) => state.archivedItems);
  const fetchArchivedItems = useWarehouseStore((state) => state.fetchArchivedItems);
  const handleRestoreArchivedItem = useWarehouseStore((state) => state.handleRestoreArchivedItem);
  const isSyncing = useWarehouseStore((state) => state.isSyncing);
  const isProcessing = useWarehouseStore((state) => state.isProcessing);

  const [itemsToRestore, setItemsToRestore] = useState<string[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [bulkRestoreConfirm, setBulkRestoreConfirm] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  
  const handleHardDeleteArchivedItems = useWarehouseStore((state) => state.handleHardDeleteArchivedItems);
  const handleRestoreMultipleArchivedItems = useWarehouseStore((state) => state.handleRestoreMultipleArchivedItems);

  useEffect(() => {
    fetchArchivedItems();
  }, [fetchArchivedItems]);

  const formatDate = (ts: number) => {
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(ts));
  };

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedIds(new Set(archivedItems.map(t => t.archiveId)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const toggleGroupExpanded = (key: string) => {
    const newSet = new Set(expandedGroups);
    if (newSet.has(key)) {
      newSet.delete(key);
    } else {
      newSet.add(key);
    }
    setExpandedGroups(newSet);
  };

  const isGroupSelected = (allIds: string[]) => {
    return allIds.length > 0 && allIds.every(id => selectedIds.has(id));
  };

  const toggleGroupSelect = (allIds: string[]) => {
    const newSet = new Set(selectedIds);
    const allSelected = allIds.every(id => newSet.has(id));
    if (allSelected) {
      allIds.forEach(id => newSet.delete(id));
    } else {
      allIds.forEach(id => newSet.add(id));
    }
    setSelectedIds(newSet);
  };

  const displayRows = React.useMemo(() => {
    const processedKeys = new Set<string>();
    const rows: {
      id: string;
      type: 'single' | 'group';
      item?: typeof archivedItems[0];
      groupKey?: string;
      mainItem?: typeof archivedItems[0];
      components?: typeof archivedItems[0][];
      allIds?: string[];
    }[] = [];

    archivedItems.forEach((item) => {
      let groupId: string | undefined = undefined;
      if (item.type === 'Transaction') {
        try {
          const parsed = JSON.parse(item.dataJSON);
          if (parsed.groupId) {
            groupId = parsed.groupId;
          }
        } catch (e) {
          // ignore
        }
      }

      if (groupId) {
        const key = `${groupId}_${item.deletedAt}`;
        if (!processedKeys.has(key)) {
          processedKeys.add(key);

          // Find all items in this group
          const groupItems = archivedItems.filter((i) => {
            if (i.type !== 'Transaction') return false;
            try {
              const parsed = JSON.parse(i.dataJSON);
              return parsed.groupId === groupId && i.deletedAt === item.deletedAt;
            } catch {
              return false;
            }
          });

          // Find main item: isComponent is NOT true
          let mainItem = groupItems.find((i) => {
            try {
              const parsed = JSON.parse(i.dataJSON);
              return parsed.isComponent !== true;
            } catch {
              return false;
            }
          });
          if (!mainItem) {
            mainItem = groupItems[0];
          }

          // Components are those where isComponent is true
          const components = groupItems.filter((i) => i.archiveId !== mainItem!.archiveId);

          rows.push({
            id: `group-${key}`,
            type: 'group',
            groupKey: key,
            mainItem,
            components,
            allIds: groupItems.map(i => i.archiveId)
          });
        }
      } else {
        rows.push({
          id: `single-${item.archiveId}`,
          type: 'single',
          item
        });
      }
    });

    return rows;
  }, [archivedItems]);

  const currentSelectionCount = selectedIds.size;
  const isAllSelected = archivedItems.length > 0 && currentSelectionCount === archivedItems.length;

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const success = await handleHardDeleteArchivedItems(Array.from(selectedIds));
    if (success) {
      setSelectedIds(new Set());
    }
    setBulkDeleteConfirm(false);
  };

  const handleBulkRestore = async () => {
    if (selectedIds.size === 0) return;
    const success = await handleRestoreMultipleArchivedItems(Array.from(selectedIds));
    if (success) {
      setSelectedIds(new Set());
    }
    setBulkRestoreConfirm(false);
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'SKU': return <Box size={20} className="text-emerald-500" />;
      case 'User': return <User size={20} className="text-indigo-500" />;
      case 'Transaction': return <History size={20} className="text-amber-500" />;
      default: return <Archive size={20} className="text-slate-500" />;
    }
  };

  const getTypeName = (type: string) => {
    switch (type) {
      case 'SKU': return 'Товар / SKU';
      case 'User': return 'Пользователь';
      case 'Transaction': return 'Операция / Транзакция';
      default: return type;
    }
  };

  const renderDataPreview = (type: string, dataJson: string) => {
    try {
      const parsed = JSON.parse(dataJson);
      if (type === 'SKU') {
        return <span className="font-mono text-sm">{parsed.sku}</span>;
      }
      if (type === 'User') {
        return <span className="font-bold">{parsed.username} <span className="text-xs font-normal text-slate-400">({parsed.role})</span></span>;
      }
      if (type === 'Transaction') {
        return (
          <div className="flex flex-col text-sm">
            <span className="font-bold">{parsed.type} <span className="font-mono font-normal">[{parsed.article}]</span></span>
            <span className="text-xs text-slate-500">{parsed.quantity} шт. {parsed.destination ? `на ${parsed.destination}` : ''}</span>
          </div>
        );
      }
      return <span className="text-xs text-slate-400">Сложные данные</span>;
    } catch (e) {
      return <span className="text-xs text-red-400">Ошибка парсинга</span>;
    }
  };

  return (
    <div 
      className="space-y-6 max-w-6xl mx-auto tab-enter"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-3">
            <Trash2 className="text-rose-500" />
            Удаленное
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Корзина с удаленными данными. Срок хранения объектов: 60 дней.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {currentSelectionCount > 0 && (
            <>
              <button
                onClick={() => setBulkRestoreConfirm(true)}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-700 rounded-xl hover:bg-indigo-100 transition-colors font-bold border border-indigo-100"
              >
                <RotateCcw size={18} />
                Восстановить ({currentSelectionCount})
              </button>
              <button
                onClick={() => setBulkDeleteConfirm(true)}
                className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-xl hover:bg-red-100 transition-colors font-bold border border-red-100"
                title="Очистить выбранные"
              >
                <Trash2 size={18} />
              </button>
            </>
          )}
          <button
            onClick={() => fetchArchivedItems()}
            disabled={isSyncing}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            {isSyncing ? <Loader2 size={18} className="animate-spin" /> : <Archive size={18} />}
            Обновить
          </button>
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden">
        {archivedItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-20 text-slate-400">
            <Archive size={48} className="text-slate-200 mb-4" />
            <p className="text-lg font-medium text-slate-500">Корзина пуста</p>
            <p className="text-sm">Все удаленные данные будут появляться здесь</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-6 py-4 w-12 text-center">
                    <input 
                      type="checkbox" 
                      checked={isAllSelected}
                      onChange={handleSelectAll}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                    />
                  </th>
                  <th className="px-6 py-4 font-bold text-slate-500 uppercase tracking-wider">Тип данных</th>
                  <th className="px-6 py-4 font-bold text-slate-500 uppercase tracking-wider">Содержимое</th>
                  <th className="px-6 py-4 font-bold text-slate-500 uppercase tracking-wider">Кто удалил</th>
                  <th className="px-6 py-4 font-bold text-slate-500 uppercase tracking-wider">Дата удаления</th>
                  <th className="px-6 py-4 font-bold text-slate-500 uppercase tracking-wider text-right">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {displayRows.map((row) => {
                  if (row.type === 'single') {
                    const item = row.item!;
                    return (
                      <tr 
                        key={row.id}
                        className={`hover:bg-slate-50 transition-colors group ${selectedIds.has(item.archiveId) ? 'bg-indigo-50/30' : ''}`}
                      >
                        <td className="px-6 py-4 text-center">
                          <input 
                            type="checkbox" 
                            checked={selectedIds.has(item.archiveId)}
                            onChange={() => toggleSelect(item.archiveId)}
                            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                          />
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center">
                              {getTypeIcon(item.type)}
                            </div>
                            <div>
                              <div className="font-bold text-slate-900">{getTypeName(item.type)}</div>
                              <div className="text-[10px] text-slate-400 font-mono tracking-wider">{item.archiveId.split('-')[0]}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          {renderDataPreview(item.type, item.dataJSON)}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-xs uppercase" title={item.deletedBy || 'Неизвестно'}>
                              {(item.deletedBy || 'u')[0]}
                            </div>
                            <span className="font-medium text-slate-700">{item.deletedBy || 'Неизвестно'}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className="font-medium text-slate-700">{formatDate(item.deletedAt).split(',')[0]}</span>
                            <span className="text-xs text-slate-400">{formatDate(item.deletedAt).split(',')[1]}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={() => setItemsToRestore([item.archiveId])}
                            disabled={isProcessing}
                            className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-indigo-600 font-bold hover:bg-indigo-50 hover:border-indigo-200 transition-all shadow-sm opacity-0 group-hover:opacity-100 disabled:opacity-50 flex items-center justify-end gap-2 ml-auto"
                          >
                            <RotateCcw size={16} />
                            Восстановить
                          </button>
                        </td>
                      </tr>
                    );
                  } else {
                    const mainItem = row.mainItem!;
                    const isExpanded = expandedGroups.has(row.groupKey!);
                    const isSelected = isGroupSelected(row.allIds!);

                    return (
                      <React.Fragment key={row.id}>
                        <tr 
                          className={`hover:bg-slate-50 transition-colors group ${isSelected ? 'bg-indigo-50/30' : ''}`}
                        >
                          <td className="px-6 py-4 text-center">
                            <input 
                              type="checkbox" 
                              checked={isSelected}
                              onChange={() => toggleGroupSelect(row.allIds!)}
                              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                            />
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center justify-center">
                                {getTypeIcon(mainItem.type)}
                              </div>
                              <div>
                                <div className="font-bold text-slate-900">{getTypeName(mainItem.type)}</div>
                                <div className="text-[10px] text-slate-400 font-mono tracking-wider">{mainItem.archiveId.split('-')[0]}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex flex-col items-start">
                              {renderDataPreview(mainItem.type, mainItem.dataJSON)}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleGroupExpanded(row.groupKey!);
                                }}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 mt-1.5 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-150 rounded-full transition-colors cursor-pointer"
                              >
                                <span>комплект: {row.components!.length} компонентов</span>
                                <ChevronDown size={12} className={`transform transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                              </button>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-xs uppercase" title={mainItem.deletedBy || 'Неизвестно'}>
                                {(mainItem.deletedBy || 'u')[0]}
                              </div>
                              <span className="font-medium text-slate-700">{mainItem.deletedBy || 'Неизвестно'}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex flex-col">
                              <span className="font-medium text-slate-700">{formatDate(mainItem.deletedAt).split(',')[0]}</span>
                              <span className="text-xs text-slate-400">{formatDate(mainItem.deletedAt).split(',')[1]}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <button
                              onClick={() => setItemsToRestore(row.allIds!)}
                              disabled={isProcessing}
                              className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-indigo-600 font-bold hover:bg-indigo-50 hover:border-indigo-200 transition-all shadow-sm opacity-0 group-hover:opacity-100 disabled:opacity-50 flex items-center justify-end gap-2 ml-auto"
                            >
                              <RotateCcw size={16} />
                              Восстановить
                            </button>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="bg-slate-50/30">
                            <td colSpan={6} className="px-6 py-3 border-t border-slate-100">
                              <div className="pl-12 pr-6 py-2 border-l-2 border-indigo-200 space-y-2">
                                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Состав комплекта (только для просмотра):</div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                                  {row.components!.map((comp) => {
                                    let parsed: any = {};
                                    try {
                                      parsed = JSON.parse(comp.dataJSON);
                                    } catch (e) {}
                                    return (
                                      <div key={comp.archiveId} className="bg-white p-3 rounded-xl border border-slate-200/60 shadow-sm flex items-center justify-between">
                                        <div className="flex flex-col">
                                          <span className="font-mono text-xs font-semibold text-slate-800">{parsed.article || '—'}</span>
                                          <span className="text-[10px] text-slate-400">Компонент</span>
                                        </div>
                                        <div className="text-right">
                                          <span className="text-xs font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md">{parsed.quantity || 0} шт</span>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  }
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog 
        show={itemsToRestore !== null}
        title="Восстановление данных"
        message="Вы уверены, что хотите восстановить эти данные из архива? Они вернутся в основной раздел."
        onConfirm={async () => {
          if (itemsToRestore) {
            if (itemsToRestore.length === 1) {
              await handleRestoreArchivedItem(itemsToRestore[0]);
            } else {
              await handleRestoreMultipleArchivedItems(itemsToRestore);
            }
            setItemsToRestore(null);
          }
        }}
        onCancel={() => setItemsToRestore(null)}
        confirmLabel="Восстановить"
        cancelLabel="Отмена"
      />

      <ConfirmDialog 
        show={bulkDeleteConfirm}
        title="Безвозвратное удаление"
        message={`Вы действительно хотите навсегда удалить ${currentSelectionCount} элементов из архива? Это действие невозможно отменить.`}
        onConfirm={handleBulkDelete}
        onCancel={() => setBulkDeleteConfirm(false)}
        confirmLabel="Удалить навсегда"
        cancelLabel="Отмена"
      />

      <ConfirmDialog 
        show={bulkRestoreConfirm}
        title="Массовое восстановление"
        message={`Вы действительно хотите восстановить ${currentSelectionCount} элементов из архива? Они вернутся в основной раздел.`}
        onConfirm={handleBulkRestore}
        onCancel={() => setBulkRestoreConfirm(false)}
        confirmLabel="Восстановить все"
        cancelLabel="Отмена"
      />
    </div>
  );
});

