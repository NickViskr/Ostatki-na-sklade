import React, { useState, useEffect } from 'react';
import { 
  Settings, 
  Database, 
  Mail, 
  Key, 
  Cpu, 
  CheckCircle2, 
  Loader2,
  Save
} from 'lucide-react';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { toast } from 'sonner';
import { ConfirmDialog } from './ConfirmDialog';

export const SettingsTab: React.FC = React.memo(() => {
  const isSyncing = useWarehouseStore((state) => state.isSyncing);
  const handleSetupDatabase = useWarehouseStore((state) => state.handleSetupDatabase);
  const fetchGas = useWarehouseStore((state) => state.fetchGas);
  const currentUser = useWarehouseStore((state) => state.currentUser);
  
  const setGasUrl = useSettingsStore((state) => state.setGasUrl);
  const geminiModel = useSettingsStore((state) => state.geminiModel);
  const setGeminiModel = useSettingsStore((state) => state.setGeminiModel);
  const geminiKey = useSettingsStore((state) => state.geminiKey);
  const setGeminiKey = useSettingsStore((state) => state.setGeminiKey);
  const notificationEmail = useSettingsStore((state) => state.notificationEmail);
  const setNotificationEmail = useSettingsStore((state) => state.setNotificationEmail);
  const ozonClientId = useSettingsStore((state) => state.ozonClientId);
  const setOzonClientId = useSettingsStore((state) => state.setOzonClientId);
  const ozonApiKey = useSettingsStore((state) => state.ozonApiKey);
  const setOzonApiKey = useSettingsStore((state) => state.setOzonApiKey);

  const [availableModels, setAvailableModels] = useState<string[]>(['gemini-1.5-flash']);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [isSavingGlobal, setIsSavingGlobal] = useState(false);
  const [isSavingOzon, setIsSavingOzon] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isCreatingTestDb, setIsCreatingTestDb] = useState(false);
  const [showTestDbConfirm, setShowTestDbConfirm] = useState(false);

  const isAdmin = currentUser?.role?.toLowerCase() === 'admin' || 
    ['admin', 'админ', 'администратор'].includes(currentUser?.username?.toLowerCase() || '');

  // Fetch models when opened/on mount
  useEffect(() => {
    if (!isAdmin) return;
    
    const timeoutId = setTimeout(async () => {
      setIsLoadingModels(true);
      try {
        const res = await fetch("/api/models", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey: geminiKey || undefined })
        });
        const result = await res.json();
        if (result.status === "success" && result.data?.length > 0) {
          setAvailableModels(result.data);
          // If current model isn't in the new list, pick the first
          if (!result.data.includes(geminiModel)) {
            setGeminiModel(result.data[0]);
          }
        }
      } catch (err) {
        console.error("Failed to load models", err);
      } finally {
        setIsLoadingModels(false);
      }
    }, 800); // 800ms debounce
    
    return () => clearTimeout(timeoutId);
  }, [geminiKey, currentUser?.role]);

  const handleSaveGlobalAi = async () => {
    setIsSavingGlobal(true);
    try {
      const currentOrder = useSettingsStore.getState().serviceOrderIds;
      const res = await fetchGas('saveGlobalSettings', { 
        data: { 
          geminiKey, 
          geminiModel, 
          serviceOrder: currentOrder && currentOrder.length > 0 ? JSON.stringify(currentOrder) : undefined
        } 
      });
      if (res?.status === 'success') toast.success('Настройки AI применены для всех пользователей');
      else toast.error(res?.message || 'Ошибка сохранения глобальных настроек');
    } catch (e) {
      toast.error('Сбой сети при сохранении настроек');
    } finally {
      setIsSavingGlobal(false);
    }
  };

  const handleSaveOzonKeys = async () => {
    setIsSavingOzon(true);
    try {
      const res = await fetchGas('saveGlobalSettings', { 
        data: { 
          ozonClientId, 
          ozonApiKey 
        } 
      });
      if (res?.status === 'success') {
        toast.success('Ключи Ozon успешно сохранены');
      } else {
        toast.error(res?.message || 'Ошибка сохранения ключей Ozon');
      }
    } catch (e) {
      toast.error('Сбой сети при сохранении ключей Ozon');
    } finally {
      setIsSavingOzon(false);
    }
  };

  const handleBackup = async () => {
    setIsBackingUp(true);
    try {
      const res = await fetchGas('backupDatabase');
      if (res?.status === 'success') {
        toast.success(`Резервная копия создана: ${res.data.name}`);
      } else {
        toast.error(res?.message || 'Ошибка создания резервной копии');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Сбой сети при создании резервной копии');
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleCreateTestDb = async () => {
    setIsCreatingTestDb(true);
    try {
      const res = await fetchGas('createOrUpdateTestDatabase');
      if (res?.status === 'success') {
        toast.success(`Тестовая БД готова: ${res.data.name}`);
      } else {
        toast.error(res?.message || 'Ошибка создания тестовой БД');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Сбой сети при создании тестовой БД');
    } finally {
      setIsCreatingTestDb(false);
    }
  };

  return (
    <div 
      key="settings"
      className="max-w-4xl mx-auto space-y-8 tab-enter"
    >
      <div className="text-center space-y-2">
        <h2 className="text-3xl font-bold">Настройки системы</h2>
        <p className="text-slate-500">Конфигурация API и уведомлений</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Google Sheets Config */}
        <div className="space-y-8">
          <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-xl space-y-6">
            <div className="flex items-center gap-3 text-indigo-600">
              <Database size={24} />
              <h3 className="text-xl font-bold">Google Таблицы</h3>
            </div>
            
            <div className="space-y-4">
              <button 
                onClick={handleSetupDatabase}
                disabled={isSyncing}
                className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-bold hover:bg-indigo-700 disabled:opacity-50 transition-all shadow-lg shadow-indigo-100 flex items-center justify-center gap-2"
              >
                {isSyncing ? <Loader2 className="animate-spin" /> : <CheckCircle2 size={20} />}
                Инициализировать базу данных
              </button>

              {isAdmin && (
                <div className="space-y-2 pt-2 border-t border-slate-100">
                  <button 
                    onClick={handleBackup}
                    disabled={isBackingUp}
                    className="w-full bg-emerald-600 text-white py-4 rounded-2xl font-bold hover:bg-emerald-700 disabled:opacity-50 transition-all shadow-lg shadow-emerald-100 flex items-center justify-center gap-2"
                  >
                    {isBackingUp ? <Loader2 className="animate-spin" /> : <Database size={20} />}
                    Резервная копия БД
                  </button>
                  <p className="text-[11px] text-slate-500 text-center leading-normal">
                    Полная копия таблицы сохраняется в папку "Резервные копии БД Склад" на Google Диске
                  </p>

                  <button 
                    onClick={() => setShowTestDbConfirm(true)}
                    disabled={isCreatingTestDb}
                    className="w-full bg-amber-600 text-white py-4 rounded-2xl font-bold hover:bg-amber-700 disabled:opacity-50 transition-all shadow-lg shadow-amber-100 flex items-center justify-center gap-2 mt-2"
                  >
                    {isCreatingTestDb ? <Loader2 className="animate-spin" /> : <Database size={20} />}
                    Создать/обновить тестовую БД
                  </button>
                  <p className="text-[11px] text-slate-500 text-center leading-normal">
                    Копия боевой БД для режима разработки. Листы "Пользователи" и "Сессии" очищаются. Файл — в папке "Тестовая БД Склад" на Google Диске
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Ozon Seller API Config */}
          <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-xl space-y-6">
            <div className="flex items-center gap-3 text-sky-600">
              <Key size={24} />
              <h3 className="text-xl font-bold">Интеграция Ozon Seller</h3>
            </div>

            <div className="space-y-4">
              {isAdmin ? (
                <>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-500 uppercase">Ozon Client-Id</label>
                    <input 
                      type="password"
                      value={ozonClientId}
                      onChange={(e) => setOzonClientId(e.target.value)}
                      placeholder="Ваш Client-Id Ozon..."
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-sky-500"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-500 uppercase">Ozon Api-Key</label>
                    <input 
                      type="password"
                      value={ozonApiKey}
                      onChange={(e) => setOzonApiKey(e.target.value)}
                      placeholder="Ваш API-Key Ozon..."
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-sky-500"
                    />
                  </div>

                  <button
                    onClick={handleSaveOzonKeys}
                    disabled={isSavingOzon || !ozonClientId || !ozonApiKey}
                    className="w-full mt-2 bg-sky-500 text-white py-3 rounded-xl font-bold hover:bg-sky-600 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                  >
                    {isSavingOzon ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                    Сохранить ключи Ozon
                  </button>
                </>
              ) : (
                <>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-500 uppercase">Ozon Client-Id</label>
                    <input 
                      type="password"
                      value="••••••••••••••••"
                      disabled
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-100 text-slate-400 outline-none cursor-not-allowed"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-500 uppercase">Ozon Api-Key</label>
                    <input 
                      type="password"
                      value="••••••••••••••••"
                      disabled
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-100 text-slate-400 outline-none cursor-not-allowed"
                    />
                  </div>
                  <p className="text-[10px] text-sky-600 font-medium">Изменять ключи Ozon может только администратор.</p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Gemini & Notifications */}
        <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-xl space-y-6">
          <div className="flex items-center gap-3 text-amber-600">
            <Cpu size={24} />
            <h3 className="text-xl font-bold">Интеллект и Уведомления</h3>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-500 uppercase flex justify-between items-center">
                <span>Модель Gemini (Глобальная)</span>
                {isLoadingModels && <Loader2 size={14} className="animate-spin text-amber-500" />}
              </label>
              <select 
                value={geminiModel}
                onChange={(e) => setGeminiModel(e.target.value)}
                disabled={!isAdmin}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {!availableModels.includes(geminiModel) && geminiModel !== '' && (
                   <option value={geminiModel}>{geminiModel}</option>
                )}
                {availableModels.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            {isAdmin ? (
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-500 uppercase">Gemini API Key</label>
                <div className="relative">
                  <input 
                    type="password"
                    value={geminiKey}
                    onChange={(e) => setGeminiKey(e.target.value)}
                    placeholder="Ваш API ключ Gemini..."
                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  <Key className="absolute left-3 top-3.5 text-slate-400" size={18} />
                </div>
                
                <button
                  onClick={handleSaveGlobalAi}
                  disabled={isSavingGlobal || !geminiKey}
                  className="w-full mt-2 bg-amber-500 text-white py-3 rounded-xl font-bold hover:bg-amber-600 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                >
                  {isSavingGlobal ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                  Применить для всех
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-500 uppercase">Gemini API Key</label>
                <div className="relative">
                  <input 
                    type="password"
                    value="••••••••••••••••"
                    disabled
                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 bg-slate-100 text-slate-400 outline-none cursor-not-allowed"
                  />
                  <Key className="absolute left-3 top-3.5 text-slate-400" size={18} />
                </div>
                <p className="text-[10px] text-amber-600 font-medium">Изменять ключ и модель может только администратор.</p>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-500 uppercase">Email для уведомлений</label>
              <div className="relative">
                <input 
                  type="email"
                  value={notificationEmail}
                  onChange={(e) => setNotificationEmail(e.target.value)}
                  placeholder="manager@example.com"
                  className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <Mail className="absolute left-3 top-3.5 text-slate-400" size={18} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        show={showTestDbConfirm}
        title="Создать/обновить тестовую БД?"
        message='Будет создана свежая тестовая копия боевой БД. Старая тестовая БД (если есть) будет перемещена в корзину Google Диска. Листы "Пользователи" и "Сессии" в копии будут очищены.'
        confirmLabel="Создать"
        cancelLabel="Отмена"
        onConfirm={handleCreateTestDb}
        onCancel={() => setShowTestDbConfirm(false)}
      />
    </div>
  );
});
