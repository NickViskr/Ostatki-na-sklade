import React, { useState, useMemo } from 'react';
import { 
  FileText, 
  Upload, 
  Zap, 
  Loader2,
  Plus,
  ChevronDown,
  ChevronUp,
  Settings2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { useUIStore } from '../store/useUIStore';
import { useSettingsStore } from '../store/useSettingsStore';

export const UploadTab: React.FC = () => {
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

  const destinations = useSettingsStore((state) => state.destinations);
  const addDestination = useSettingsStore((state) => state.addDestination);
  const customPrompt = useSettingsStore((state) => state.customPrompt);
  const setCustomPrompt = useSettingsStore((state) => state.setCustomPrompt);

  const stock = useWarehouseStore((state) => state.stock);
  const skus = useWarehouseStore((state) => state.skus);

  const [isAddingDest, setIsAddingDest] = useState(false);
  const [newDest, setNewDest] = useState('');
  const [isPromptExpanded, setIsPromptExpanded] = useState(false);

  const articlesList = useMemo(() => {
    const set = new Set<string>();
    stock.forEach(s => set.add(s.article));
    skus.forEach(s => set.add(s.sku));
    return Array.from(set);
  }, [stock, skus]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    let combinedText = rawText ? rawText + '\n\n' : '';

    const readPromises = Array.from(files).map((file: File) => {
      return new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (evt) => {
          try {
            const bstr = evt.target?.result;
            const wb = XLSX.read(bstr, { type: 'binary' });
            const wsname = wb.SheetNames[0];
            const ws = wb.Sheets[wsname];
            const data = XLSX.utils.sheet_to_csv(ws);
            resolve(`--- Файл: ${file.name} ---\n${data}`);
          } catch (err) {
            console.error(`Ошибка чтения ${file.name}:`, err);
            resolve(`--- Ошибка чтения: ${file.name} ---`);
          }
        };
        reader.onerror = () => resolve(`--- Ошибка чтения: ${file.name} ---`);
        reader.readAsBinaryString(file);
      });
    });

    const results = await Promise.all(readPromises);
    combinedText += results.join('\n\n');
    setRawText(combinedText);
    
    // Reset input so the same files can be selected again if needed
    e.target.value = '';
  };

  const handleAddDest = () => {
    if (newDest.trim()) {
      addDestination(newDest.trim());
      setUploadDestination(newDest.trim());
      setNewDest('');
      setIsAddingDest(false);
    }
  };

  return (
    <motion.div 
      key="upload"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="max-w-4xl mx-auto space-y-8"
    >
      <div className="text-center space-y-2">
        <h2 className="text-3xl font-bold">Загрузка накладной</h2>
        <p className="text-slate-500">Используйте ИИ для автоматического распознавания товаров</p>
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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-bold text-slate-500 uppercase">Текст накладной</label>
              <label className="cursor-pointer flex items-center gap-2 text-indigo-600 hover:text-indigo-700 font-bold text-sm">
                <Upload size={16} />
                Загрузить Excel/PDF
                <input type="file" className="hidden" accept=".xlsx,.xls,.csv,.pdf" multiple onChange={handleFileUpload} />
              </label>
            </div>
            <textarea 
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              className="w-full h-80 p-6 rounded-3xl border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-500 transition-all resize-none font-mono text-sm"
              placeholder="Вставьте текст накладной или перетащите файл сюда..."
            />
          </div>

          <div className="flex flex-col justify-center space-y-6 bg-slate-50/50 p-8 rounded-3xl border border-dashed border-slate-200">
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
              <FileText className="text-indigo-500 mb-2" size={32} />
              <h4 className="font-bold">Как это работает?</h4>
              <p className="text-sm text-slate-500 mt-1">Вставьте текст из накладной, и Gemini автоматически определит артикулы, количество и цены.</p>
            </div>
            
            <button 
              onClick={() => handleProcessInvoice()}
              disabled={isProcessing || !rawText.trim()}
              className="w-full bg-slate-900 text-white py-5 rounded-2xl font-bold text-lg hover:bg-slate-800 disabled:opacity-50 transition-all shadow-lg flex items-center justify-center gap-3"
            >
              {isProcessing ? <Loader2 className="animate-spin" /> : <Zap size={24} className="text-amber-400 fill-amber-400" />}
              {isProcessing ? 'Распознавание...' : 'Распознать через Gemini'}
            </button>
            
            <p className="text-[10px] text-center text-slate-400 uppercase font-bold tracking-widest">
              Powered by Google Gemini Pro
            </p>
          </div>
        </div>

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
          
          <AnimatePresence>
            {isPromptExpanded && (
              <motion.div 
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
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
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
};
