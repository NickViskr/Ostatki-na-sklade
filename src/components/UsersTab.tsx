import React, { useEffect, useState } from 'react';
import { Users, UserPlus, Trash2, Shield, User, Key, Loader2, RefreshCw, Copy, Check, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { ConfirmDialog } from './ConfirmDialog';

export const UsersTab: React.FC = React.memo(() => {
  const usersList = useWarehouseStore((state) => state.usersList);
  const fetchUsersList = useWarehouseStore((state) => state.fetchUsersList);
  const handleAddUser = useWarehouseStore((state) => state.handleAddUser);
  const handleDeleteUser = useWarehouseStore((state) => state.handleDeleteUser);
  const isProcessing = useWarehouseStore((state) => state.isProcessing);
  const isSyncing = useWarehouseStore((state) => state.isSyncing);
  const currentUser = useWarehouseStore((state) => state.currentUser);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'admin' | 'user'>('user');
  const [newlyCreatedUser, setNewlyCreatedUser] = useState<{username: string, password: string} | null>(null);
  const [copied, setCopied] = useState(false);
  
  const [userToDelete, setUserToDelete] = useState<string | null>(null);
  const [showNewUserPassword, setShowNewUserPassword] = useState(false);

  useEffect(() => {
    fetchUsersList();
  }, [fetchUsersList]);

  const handleCopy = () => {
    if (newlyCreatedUser) {
      navigator.clipboard.writeText(`Логин: ${newlyCreatedUser.username}\nПароль: ${newlyCreatedUser.password}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const generatePassword = () => {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
    let pass = "";
    for (let i = 0; i < 12; i++) {
      pass += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setPassword(pass);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;
    const success = await handleAddUser(username, password, role);
    if (success) {
      setNewlyCreatedUser({ username, password });
      setUsername('');
      setPassword('');
      setRole('user');
    }
  };

  const isCurrentUserAdmin = currentUser?.role?.toLowerCase() === 'admin' || 
    ['admin', 'админ', 'администратор'].includes(
      currentUser?.username?.toLowerCase() || ''
    );

  if (!isCurrentUserAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-500">
        <Shield size={48} className="mb-4 opacity-20" />
        <h2 className="text-xl font-bold">Доступ запрещен</h2>
        <p>У вас нет прав для просмотра этой страницы.</p>
      </div>
    );
  }

  return (
    <div 
      className="space-y-8 max-w-5xl mx-auto tab-enter"
    >
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tight">Пользователи</h2>
          <p className="text-slate-500 mt-1 font-medium">Управление доступом к системе</p>
        </div>
        <button 
          onClick={() => fetchUsersList()}
          disabled={isSyncing}
          className="p-3 bg-white text-slate-600 rounded-2xl hover:bg-slate-50 border border-slate-200 shadow-sm transition-all disabled:opacity-50"
        >
          <RefreshCw size={20} className={isSyncing ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Add User Form */}
        <div className="lg:col-span-1">
          <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-xl shadow-slate-200/20 sticky top-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center">
                <UserPlus size={20} />
              </div>
              <h3 className="text-lg font-bold">Новый пользователь</h3>
            </div>

            <form onSubmit={onSubmit} className="space-y-4" autoComplete="off">
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Логин</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                  placeholder="Введите логин"
                  autoComplete="off"
                  name="new-username"
                  required
                />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center ml-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Пароль</label>
                  <button 
                    type="button" 
                    onClick={generatePassword}
                    className="text-[10px] font-bold text-indigo-600 hover:text-indigo-700 uppercase tracking-widest"
                  >
                    Сгенерировать
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showNewUserPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-4 pr-12 py-3 rounded-xl border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-500 font-medium font-mono"
                    placeholder="Введите пароль"
                    autoComplete="new-password"
                    name="new-password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewUserPassword(!showNewUserPassword)}
                    className="absolute inset-y-0 right-0 pr-4 flex items-center text-slate-400 hover:text-indigo-600 transition-colors"
                    tabIndex={-1}
                    title={showNewUserPassword ? "Скрыть пароль" : "Показать пароль"}
                  >
                    {showNewUserPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Роль</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as 'admin' | 'user')}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-500 font-medium cursor-pointer"
                >
                  <option value="user">Пользователь</option>
                  <option value="admin">Администратор</option>
                </select>
              </div>

              <button
                type="submit"
                disabled={isProcessing || !username || !password}
                className="w-full bg-indigo-600 text-white py-4 rounded-xl font-bold hover:bg-indigo-700 disabled:opacity-50 transition-all shadow-lg shadow-indigo-200 flex items-center justify-center gap-2 mt-2"
              >
                {isProcessing ? <Loader2 className="animate-spin" size={20} /> : <UserPlus size={20} />}
                Создать пользователя
              </button>
            </form>
          </div>
        </div>

        {/* Users List */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-[2rem] border border-slate-200 shadow-xl shadow-slate-200/20 overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center gap-3">
              <div className="w-10 h-10 bg-slate-100 text-slate-600 rounded-xl flex items-center justify-center">
                <Users size={20} />
              </div>
              <h3 className="text-lg font-bold">Список пользователей</h3>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 border-b border-slate-100">
                    <th className="px-6 py-4 font-bold text-slate-400 uppercase text-[10px] tracking-widest">Пользователь</th>
                    <th className="px-6 py-4 font-bold text-slate-400 uppercase text-[10px] tracking-widest">Роль</th>
                    <th className="px-6 py-4 font-bold text-slate-400 uppercase text-[10px] tracking-widest">Пароль</th>
                  </tr>
                </thead>
                <tbody>
                  {usersList.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-6 py-12 text-center text-slate-400 font-medium">
                        {isSyncing ? 'Загрузка...' : 'Нет пользователей'}
                      </td>
                    </tr>
                  ) : (
                    usersList.map((user, idx) => {
                      const isAdmin = user.role === 'admin';
                      const displayRole = isAdmin ? 'Админ' : (user.role === 'user' ? 'Пользователь' : user.role);
                      
                      return (
                      <tr key={idx} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors group">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${isAdmin ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-700'}`}>
                              {user.username.charAt(0).toUpperCase()}
                            </div>
                            <span className="font-bold text-slate-900">{user.username}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-3 py-1 rounded-lg text-xs font-bold uppercase tracking-wider ${isAdmin ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-100 text-slate-500'}`}>
                            {displayRole}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-sm text-slate-400 bg-slate-50 px-2 py-1 rounded-md min-w-[100px] text-center">
                              ••••••••
                            </span>
                            {user.username !== currentUser?.username && (
                              <button
                                onClick={() => setUserToDelete(user.username)}
                                disabled={isProcessing}
                                className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all opacity-0 group-hover:opacity-100 disabled:opacity-50"
                                title="Удалить пользователя"
                              >
                                <Trash2 size={18} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Modal for new user password */}
      {newlyCreatedUser && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 fade-in">
          <div
            className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl modal-enter"
          >
            <div className="flex items-center gap-3 mb-6 text-emerald-600">
              <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center">
                <Check size={24} />
              </div>
              <h3 className="text-xl font-bold text-slate-900">Пользователь создан</h3>
            </div>
            
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 flex gap-3 text-amber-800">
              <AlertCircle size={20} className="shrink-0 mt-0.5" />
              <p className="text-sm font-medium">
                Обязательно скопируйте пароль сейчас. В целях безопасности он зашифрован и больше нигде не будет отображаться.
              </p>
            </div>

            <div className="space-y-4 mb-8">
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Логин</label>
                <div className="px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 font-medium text-slate-900">
                  {newlyCreatedUser.username}
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Пароль</label>
                <div className="px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 font-mono font-medium text-slate-900">
                  {newlyCreatedUser.password}
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleCopy}
                className="flex-1 bg-indigo-50 text-indigo-600 py-3 rounded-xl font-bold hover:bg-indigo-100 transition-colors flex items-center justify-center gap-2"
              >
                {copied ? <Check size={18} /> : <Copy size={18} />}
                {copied ? 'Скопировано' : 'Скопировать'}
              </button>
              <button
                onClick={() => setNewlyCreatedUser(null)}
                className="flex-1 bg-slate-900 text-white py-3 rounded-xl font-bold hover:bg-slate-800 transition-colors"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog 
        show={userToDelete !== null}
        title="Удаление пользователя"
        message={`Вы уверены, что хотите лишить доступа пользователя ${userToDelete}? У него пропадет возможность входа в систему.`}
        onConfirm={() => {
          if (userToDelete) handleDeleteUser(userToDelete);
        }}
        onCancel={() => setUserToDelete(null)}
      />
    </div>
  );
});