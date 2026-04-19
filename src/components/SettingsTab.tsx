import React from 'react';
import { 
  Settings, 
  Database, 
  Mail, 
  Key, 
  Cpu, 
  CheckCircle2, 
  Loader2
} from 'lucide-react';
import { motion } from 'motion/react';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { useSettingsStore } from '../store/useSettingsStore';

export const SettingsTab: React.FC = () => {
  const isSyncing = useWarehouseStore((state) => state.isSyncing);
  const handleSetupDatabase = useWarehouseStore((state) => state.handleSetupDatabase);
  const currentUser = useWarehouseStore((state) => state.currentUser);
  
  const gasUrl = useSettingsStore((state) => state.gasUrl);
  const setGasUrl = useSettingsStore((state) => state.setGasUrl);
  const geminiModel = useSettingsStore((state) => state.geminiModel);
  const setGeminiModel = useSettingsStore((state) => state.setGeminiModel);
  const geminiKey = useSettingsStore((state) => state.geminiKey);
  const setGeminiKey = useSettingsStore((state) => state.setGeminiKey);
  const notificationEmail = useSettingsStore((state) => state.notificationEmail);
  const setNotificationEmail = useSettingsStore((state) => state.setNotificationEmail);

  return (
    <motion.div 
      key="settings"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="max-w-4xl mx-auto space-y-8"
    >
      <div className="text-center space-y-2">
        <h2 className="text-3xl font-bold">Настройки системы</h2>
        <p className="text-slate-500">Конфигурация API и уведомлений</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Google Sheets Config */}
        <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-xl space-y-6">
          <div className="flex items-center gap-3 text-indigo-600">
            <Database size={24} />
            <h3 className="text-xl font-bold">Google Таблицы</h3>
          </div>
          
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-500 uppercase">GAS Web App URL</label>
              <div className="relative">
                <input 
                  type="text"
                  value={gasUrl}
                  onChange={(e) => setGasUrl(e.target.value)}
                  placeholder="https://script.google.com/macros/s/..."
                  className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <Settings className="absolute left-3 top-3.5 text-slate-400" size={18} />
              </div>
            </div>

            <button 
              onClick={handleSetupDatabase}
              disabled={isSyncing || !gasUrl}
              className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-bold hover:bg-indigo-700 disabled:opacity-50 transition-all shadow-lg shadow-indigo-100 flex items-center justify-center gap-2"
            >
              {isSyncing ? <Loader2 className="animate-spin" /> : <CheckCircle2 size={20} />}
              Инициализировать базу данных
            </button>
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
              <label className="text-sm font-bold text-slate-500 uppercase">Модель Gemini</label>
              <select 
                value={geminiModel}
                onChange={(e) => setGeminiModel(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="gemini-3-flash-preview">Gemini 3 Flash (Быстрая)</option>
                <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro (Мощная)</option>
              </select>
            </div>

            {currentUser?.role === 'admin' ? (
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-500 uppercase">Gemini API Key</label>
                <div className="relative">
                  <input 
                    type="password"
                    value={geminiKey}
                    onChange={(e) => setGeminiKey(e.target.value)}
                    placeholder="Ваш API ключ Gemini..."
                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <Key className="absolute left-3 top-3.5 text-slate-400" size={18} />
                </div>
                <p className="text-[10px] text-emerald-600 font-medium">Безопасное хранение активно. Ключ надежно сохранен.</p>
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
                <p className="text-[10px] text-amber-600 font-medium">Изменять ключ может только администратор.</p>
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
    </motion.div>
  );
};
