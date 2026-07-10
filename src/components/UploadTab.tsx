import React, { useState, useMemo, useCallback } from 'react';
import { 
  Upload, 
  Zap, 
  Loader2,
  Plus,
  ChevronDown,
  ChevronUp,
  Settings2,
  History,
  X,
  Trash2
} from 'lucide-react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { useUIStore } from '../store/useUIStore';
import { useSettingsStore } from '../store/useSettingsStore';

export const UploadTab: React.FC = React.memo(() => {
  const isProcessing = useWarehouseStore((state) => state.isProcessing);
  const handleProcessInvoice = useWarehouseStore((state) => state.handleProcessInvoice);
  
  const opType = useUIStore((state) => state.opType);
  const setOpType = useUIStore((state) => state.setOpType);
  const rawText = useUIStore((state) => state.rawText);
  const setRawText = useUIStore((state) => state.setRawText);
  const uploadDestination = useUIStore((state) => state.uploadDestination);
  const setUploadDestination = useUIStore((state) => state.setUploadDestination);
  const aiFeedback = useUIStore((state) => state.aiFeedback);
  const setAiFeedback = useUIStore((state) => state.setAiFeedback);
  const filesInfo = useUIStore((state) => state.filesInfo);
  const recognitionHistory = useUIStore((state) => state.recognitionHistory);
  const clearRecognitionData = useUIStore((state) => state.clearRecognitionData);
  const askConfirmation = useUIStore((state) => state.askConfirmation);

  const destinations = useSettingsStore((state) => state.destinations);
  const addDestination = useSettingsStore((state) => state.addDestination);
  const customPrompt = useSettingsStore((state) => state.customPrompt);
  const setCustomPrompt = useSettingsStore((state) => state.setCustomPrompt);

  const stock = useWarehouseStore((state) => state.stock);
  const skus = useWarehouseStore((state) => state.skus);

  const [isAddingDest, setIsAddingDest] = useState(false);
  const [newDest, setNewDest] = useState('');
  const [isPromptExpanded, setIsPromptExpanded] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const setFilesInfo = useUIStore((state) => state.setFilesInfo);

  const processFiles = async (files: FileList | File[]) => {
    let combinedText = '';
    const fileNames: string[] = [];
    
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
            const buffer = await file.arrayBuffer();
            const workbook = XLSX.read(buffer, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const text = XLSX.utils.sheet_to_txt(worksheet);
            
            combinedText += `${file.name}:\n${text}\n\n`;
            fileNames.push(file.name);
        } catch (err) {
            toast.error(`Ошибка при чтении файла ${file.name}`);
        }
    }
    
    if (combinedText) {
        setRawText(combinedText);
        setFilesInfo(fileNames);
    }
  };

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await processFiles(e.dataTransfer.files);
    }
  }, [setRawText, setFilesInfo]);

  const articlesList = useMemo(() => {
    const set = new Set<string>();
    stock.forEach(s => set.add(s.article));
    skus.forEach(s => set.add(s.sku));
    return Array.from(set);
  }, [stock, skus]);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    await processFiles(files);
    if (e.target) e.target.value = ''; // Reset file input
  }, [setRawText, setFilesInfo]);

  const handleAddDest = useCallback(() => {
    if (newDest.trim() && !destinations.includes(newDest.trim())) {
      addDestination(newDest.trim());
      setUploadDestination(newDest.trim());
      setNewDest('');
      setIsAddingDest(false);
    }
  }, [newDest, destinations, addDestination, setUploadDestination]);

  return (
    <div 
      key="upload"
      className="max-w-4xl mx-auto space-y-8 tab-enter"
    >
      <div className="text-center space-y-2">
        <h2 className="text-3xl font-bold">Ручная загрузка накладной</h2>
        <p className="text-slate-500">Используйте ИИ для автоматического распознавания товаров или подключите автоматический импорт</p>
      </div>



      <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-xl space-y-8">
        <div className="flex items-center gap-4 bg-slate-50 p-2 rounded-2xl border border-slate-100">
          <button 
            onClick={() => setOpType('Приход')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold transition-all ${opType === 'Приход' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
          >
            <Zap size={18} /> Приход товара
          </button>
          <button 
            onClick={() => setOpType('Расход')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold transition-all ${opType === 'Расход' ? 'bg-white shadow-sm text-red-600' : 'text-slate-400 hover:text-slate-600'}`}
          >
            <Zap size={18} /> Расход / Отгрузка
          </button>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-bold text-slate-500 uppercase">Объект (откуда / куда)</label>
          {isAddingDest ? (
            <div className="flex gap-2">
              <input 
                type="text"
                value={newDest}
                onChange={(e) => setNewDest(e.target.value)}
                placeholder="Введите название объекта..."
                className="flex-1 px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-500"
                autoFocus
              />
              <button 
                onClick={handleAddDest}
                className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all"
              >
                Сохранить
              </button>
              <button 
                onClick={() => setIsAddingDest(false)}
                className="px-6 py-3 bg-slate-200 text-slate-700 rounded-xl font-bold hover:bg-slate-300 transition-all"
              >
                Отмена
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <select 
                value={uploadDestination}
                onChange={(e) => setUploadDestination(e.target.value)}
                className="flex-1 px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {destinations.map((dest, idx) => (
                  <option key={idx} value={dest}>{dest}</option>
                ))}
              </select>
              <button 
                onClick={() => setIsAddingDest(true)}
                className="px-4 py-3 bg-slate-100 text-slate-600 rounded-xl font-bold hover:bg-slate-200 transition-all flex items-center gap-2"
              >
                <Plus size={18} /> Добавить
              </button>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-sm font-bold text-slate-500 uppercase">Текст накладной</label>
            <label className="cursor-pointer flex items-center gap-2 text-indigo-600 hover:text-indigo-700 font-bold text-sm">
              <Upload size={16} />
              Загрузить Excel/PDF
              <input type="file" className="hidden" accept=".xlsx,.xls,.csv,.pdf" multiple onChange={handleFileUpload} />
            </label>
          </div>
          <div 
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`relative rounded-3xl border transition-all ${isDragging ? 'border-indigo-500 bg-indigo-50/50 scale-[1.02] shadow-lg shadow-indigo-100' : 'border-transparent'}`}
          >
            {isDragging && (
              <div className="absolute inset-0 z-10 flex items-center justify-center rounded-3xl bg-indigo-50/90 backdrop-blur-sm pointer-events-none border-2 border-dashed border-indigo-400">
                <div className="flex flex-col items-center gap-3 text-indigo-600">
                  <Upload size={32} className="animate-bounce" />
                  <span className="font-bold text-lg">Отпустите файл здесь</span>
                </div>
              </div>
            )}
            <div className="relative">
              <textarea 
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                className="w-full h-32 p-4 rounded-3xl border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-500 transition-all resize-none font-mono text-sm pr-12"
                placeholder="Вставьте текст накладной или перетащите файл сюда..."
              />
              {rawText && (
                <button 
                  onClick={() => {
                    setRawText('');
                    useUIStore.getState().setFilesInfo([]);
                  }}
                  className="absolute top-3 right-3 p-1.5 text-slate-400 hover:text-red-500 hover:bg-slate-100 rounded-lg transition-colors"
                  title="Очистить текст"
                >
                  <X size={18} />
                </button>
              )}
            </div>
            {filesInfo.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-4 px-1">
                {filesInfo.map((f, i) => (
                  <span key={i} className="text-xs font-medium bg-indigo-50 text-indigo-600 px-2.5 py-1 rounded-lg border border-indigo-100">
                    Загружено: {f}
                  </span>
                ))}
              </div>
            )}
          </div>
          <button 
            onClick={() => handleProcessInvoice()}
            disabled={isProcessing || !rawText.trim()}
            className="w-full bg-slate-900 text-white py-4 rounded-2xl font-bold text-lg hover:bg-slate-800 disabled:opacity-50 transition-all shadow-lg flex items-center justify-center gap-3 mt-6"
          >
            {isProcessing ? <Loader2 className="animate-spin" /> : <Zap size={24} className="text-amber-400 fill-amber-400" />}
            {isProcessing ? 'Распознавание...' : 'Распознать через ИИ'}
          </button>
        </div>

        {(rawText || recognitionHistory.length > 0) && (
          <div className="border-t border-slate-100 pt-6 mt-6">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h3 className="text-sm font-bold text-slate-500 uppercase flex items-center gap-2">
                <History size={16} /> Последние распознавания
              </h3>
              <button
                onClick={() => {
                  askConfirmation(
                    "Очистить накладные?",
                    "Загруженный текст и история распознаваний будут удалены",
                    () => {
                      clearRecognitionData();
                      toast.success("Данные успешно очищены");
                    }
                  );
                }}
                className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-xl hover:bg-red-100 transition-all font-bold text-sm border border-red-100 shadow-sm"
              >
                <Trash2 size={16} />
                Очистить накладные
              </button>
            </div>
            {recognitionHistory.length > 0 ? (
              <div className="grid gap-3">
                {recognitionHistory.map((historyItem) => (
                  <div key={historyItem.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100">
                    <div className="flex flex-col">
                      <span className="font-bold text-slate-700 text-sm">{new Date(historyItem.timestamp).toLocaleString('ru-RU')}</span>
                      <span className="text-xs text-slate-500 mt-1">
                        {historyItem.opType} • {historyItem.items.length} позиций • {historyItem.uploadDestination}
                      </span>
                    </div>
                    <button 
                      onClick={() => {
                          useUIStore.getState().setRawText(historyItem.rawText);
                          useUIStore.getState().setOpType(historyItem.opType);
                          useUIStore.getState().setUploadDestination(historyItem.uploadDestination);
                          useUIStore.getState().setParsedItems(historyItem.items);
                          useUIStore.getState().setShowConfirmModal(true);
                      }}
                      className="text-sm font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 px-4 py-2 rounded-lg transition-colors"
                    >
                      Восстановить
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400 italic">История распознаваний пуста. Загруженный текст накладной готов к распознаванию.</p>
            )}
          </div>
        )}

        {/* Expandable Prompts Section */}
        <div className="border-t border-slate-100 pt-6">
          <button 
            onClick={() => setIsPromptExpanded(!isPromptExpanded)}
            className="flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-indigo-600 transition-colors uppercase"
          >
            <Settings2 size={16} />
            Настройки промтов Gemini
            {isPromptExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          
          {isPromptExpanded && (
            <div className="overflow-hidden fade-in">
              <div className="pt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-500 uppercase">Основной системный промт</label>
                    <textarea 
                      value={customPrompt}
                      onChange={(e) => setCustomPrompt(e.target.value)}
                      className="w-full h-64 p-4 rounded-2xl border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-500 transition-all resize-none font-mono text-xs text-slate-600"
                      placeholder="Введите основной промт для Gemini..."
                    />
                    <p className="text-[10px] text-slate-400">
                      Используйте <code className="bg-slate-100 px-1 rounded">{"{{REFERENCE_ARTICLES}}"}</code> для вставки списка артикулов.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-500 uppercase">Дополнительные инструкции (разовые)</label>
                    <textarea 
                      value={aiFeedback}
                      onChange={(e) => setAiFeedback(e.target.value)}
                      className="w-full h-64 p-4 rounded-2xl border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-500 transition-all resize-none font-mono text-xs text-slate-600"
                      placeholder="Например: Игнорируй товары со словом 'Услуга' или 'Доставка'..."
                    />
                    <p className="text-[10px] text-slate-400">
                      Эти инструкции будут добавлены в конец основного промта при текущем запросе.
                    </p>
                  </div>
                  
                  <div className="col-span-1 md:col-span-2 mt-2 p-4 bg-indigo-50 rounded-xl border border-indigo-100">
                    <h5 className="text-xs font-bold text-indigo-800 uppercase mb-2">Автоматически подставляемые артикулы ({articlesList.length} шт):</h5>
                    <p className="text-xs text-indigo-600 font-mono break-words">
                      {articlesList.length > 0 ? articlesList.join(', ') : 'Нет данных (добавьте товары в SKU базу)'}
                    </p>
                    <p className="text-[10px] text-indigo-400 mt-2">
                      Эти артикулы берутся из базы SKU и текущих остатков. Они автоматически заменяют переменную <code className="bg-indigo-100 px-1 rounded font-bold">{"{{REFERENCE_ARTICLES}}"}</code> в промте перед отправкой к ИИ.
                    </p>
                  </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
