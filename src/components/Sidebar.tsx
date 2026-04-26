import React from 'react';
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
  Trash2
} from 'lucide-react';
import { useWarehouseStore } from '../store/useWarehouseStore';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: any) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab }) => {
  const currentUser = useWarehouseStore((state) => state.currentUser);
  const handleLogout = useWarehouseStore((state) => state.handleLogout);

  const isCurrentUserAdmin = currentUser?.role?.toLowerCase() === 'admin' || 
    ['admin', 'админ', 'администратор'].includes(currentUser?.username?.toLowerCase() || '');
  const archivedItems = useWarehouseStore((state) => state.archivedItems);

  const menuItems = [
    { id: 'dashboard', label: 'Склад', icon: LayoutDashboard },
    { id: 'upload', label: 'Загрузка', icon: FileUp },
    { id: 'manual', label: 'Списание', icon: Database },
    { id: 'shipment', label: 'Отгрузка', icon: Truck },
    { id: 'history', label: 'История', icon: History },
    { id: 'skus', label: 'SKU База', icon: BookOpen },
    ...(isCurrentUserAdmin ? [
      { id: 'users', label: 'Пользователи', icon: Users },
      { id: 'deleted', label: 'Удаленное', icon: Trash2 },
      { id: 'settings', label: 'Настройки', icon: Settings2 }
    ] : []),
  ];

  return (
    <aside className="w-72 bg-white border-r border-slate-200 flex flex-col sticky top-0 h-screen">
      <div className="p-8">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-200">
            <LayoutDashboard className="text-white" size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Склад.AI</h1>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Smart Inventory</p>
          </div>
        </div>

        <nav className="space-y-1">
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all relative ${
                activeTab === item.id 
                  ? 'bg-indigo-50 text-indigo-700 font-medium' 
                  : 'text-slate-500 hover:bg-slate-50'
              }`}
            >
              <item.icon size={20} />
              <span>{item.label}</span>
              {item.id === 'deleted' && archivedItems.length > 0 && (
                <div className="absolute left-6 top-2.5 w-2.5 h-2.5 bg-red-500 border-2 border-white rounded-full z-10" />
              )}
              {activeTab === item.id && (
                <div className="ml-auto w-1.5 h-1.5 bg-indigo-600 rounded-full" />
              )}
            </button>
          ))}
        </nav>
      </div>

      <div className="mt-auto p-8 space-y-4">
        {currentUser && (
          <div className="flex items-center justify-between p-4 bg-indigo-50 rounded-2xl border border-indigo-100">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white font-bold text-xs">
                {currentUser.username.charAt(0).toUpperCase()}
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-bold text-slate-900">{currentUser.username}</span>
                <span className="text-[10px] text-slate-500 uppercase tracking-wider">
                  {isCurrentUserAdmin ? 'Админ' : (currentUser.role === 'user' ? 'Пользователь' : currentUser.role || 'Пользователь')}
                </span>
              </div>
            </div>
            <button 
              onClick={handleLogout}
              className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors"
              title="Выйти"
            >
              <LogOut size={16} />
            </button>
          </div>
        )}
        <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
          <p className="text-xs text-slate-500 mb-2">Статус системы</p>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
            <span className="text-xs font-bold text-slate-700">Подключено к GAS</span>
          </div>
        </div>
      </div>
    </aside>
  );
};
