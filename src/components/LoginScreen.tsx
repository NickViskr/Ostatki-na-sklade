import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Package, Lock, User, Loader2, Eye, EyeOff } from 'lucide-react';
import { useWarehouseStore } from '../store/useWarehouseStore';

export const LoginScreen: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  
  const handleLogin = useWarehouseStore((state) => state.handleLogin);
  const isProcessing = useWarehouseStore((state) => state.isProcessing);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;
    await handleLogin(username, password);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 relative">

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
            Склад AI Mercurius
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
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-12 pr-12 py-4 rounded-2xl border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all font-medium"
                placeholder="Введите пароль"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-4 flex items-center text-slate-400 hover:text-indigo-600 transition-colors"
                tabIndex={-1}
                title={showPassword ? "Скрыть пароль" : "Показать пароль"}
              >
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
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
    </div>
  );
};
