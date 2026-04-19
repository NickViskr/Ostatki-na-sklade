import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Package, Lock, User, Loader2, Settings2, X, Link as LinkIcon } from 'lucide-react';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { useSettingsStore } from '../store/useSettingsStore';

export const LoginScreen: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  
  const handleLogin = useWarehouseStore((state) => state.handleLogin);
  const isProcessing = useWarehouseStore((state) => state.isProcessing);
  
  const gasUrl = useSettingsStore((state) => state.gasUrl);
  const setGasUrl = useSettingsStore((state) => state.setGasUrl);
  const [tempUrl, setTempUrl] = useState(gasUrl);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;
    await handleLogin(username, password);
  };

  const saveSettings = () => {
    setGasUrl(tempUrl);
    setShowSettings(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 relative">
      <button 
        onClick={() => {
          setTempUrl(gasUrl);
          setShowSettings(true);
        }}
        className="absolute top-6 right-6 p-3 bg-white text-slate-400 hover:text-indigo-600 rounded-2xl shadow-sm border border-slate-200 transition-colors"
        title="Настройки подключения"
      >
        <Settings2 size={24} />
      </button>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white p-8 sm:p-12 rounded-[2.5rem] shadow-2xl w-full max-w-md border border-slate-100"
      >
        <div className="flex flex-col items-center mb-10">
          <div className="w-20 h-20 bg-indigo-600 rounded-3xl flex items-center justify-center shadow-xl shadow-indigo-200 mb-6 rotate-3">
            <Package size={40} className="text-white -rotate-3" />
          </div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight text-center">
            Складской<br/>Mercurius AI
          </h1>
          <p className="text-slate-500 mt-3 font-medium">Войдите в систему для продолжения</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest ml-1">Логин</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400">
                <User size={20} />
              </div>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full pl-12 pr-4 py-4 rounded-2xl border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all font-medium"
                placeholder="Введите логин"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest ml-1">Пароль</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400">
                <Lock size={20} />
              </div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-12 pr-4 py-4 rounded-2xl border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all font-medium"
                placeholder="Введите пароль"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isProcessing || !username || !password}
            className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-bold hover:bg-indigo-700 disabled:opacity-50 transition-all shadow-xl shadow-indigo-200 flex items-center justify-center gap-2 mt-4"
          >
            {isProcessing ? <Loader2 className="animate-spin" size={20} /> : 'Войти'}
          </button>
        </form>
      </motion.div>

      <AnimatePresence>
        {showSettings && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl"
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-slate-900">Настройки подключения</h3>
                <button 
                  onClick={() => setShowSettings(false)}
                  className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              
              <div className="space-y-4 mb-8">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-widest ml-1">GAS URL</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400">
                      <LinkIcon size={20} />
                    </div>
                    <input
                      type="text"
                      value={tempUrl}
                      onChange={(e) => setTempUrl(e.target.value)}
                      className="w-full pl-12 pr-4 py-4 rounded-2xl border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all font-medium"
                      placeholder="https://script.google.com/macros/s/.../exec"
                    />
                  </div>
                  <p className="text-[10px] text-slate-400 ml-1 mt-2">
                    Укажите URL веб-приложения Google Apps Script
                  </p>
                </div>
              </div>

              <button
                onClick={saveSettings}
                className="w-full bg-slate-900 text-white py-4 rounded-2xl font-bold hover:bg-slate-800 transition-colors"
              >
                Сохранить
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
