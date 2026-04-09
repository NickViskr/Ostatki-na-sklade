import React from 'react';
import { 
  LayoutDashboard, 
  FileUp, 
  Settings2, 
  History, 
  BookOpen, 
  Database,
  Truck
} from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: any) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab }) => {
  const menuItems = [
    { id: 'dashboard', label: 'Склад', icon: LayoutDashboard },
    { id: 'upload', label: 'Загрузка', icon: FileUp },
    { id: 'manual', label: 'Списание', icon: Database },
    { id: 'shipment', label: 'Себестоимость отгрузки', icon: Truck },
    { id: 'history', label: 'История', icon: History },
    { id: 'skus', label: 'SKU База', icon: BookOpen },
    { id: 'settings', label: 'Настройки', icon: Settings2 },
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
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                activeTab === item.id 
                  ? 'bg-indigo-50 text-indigo-700 font-medium' 
                  : 'text-slate-500 hover:bg-slate-50'
              }`}
            >
              <item.icon size={20} />
              <span>{item.label}</span>
              {activeTab === item.id && (
                <div className="ml-auto w-1.5 h-1.5 bg-indigo-600 rounded-full" />
              )}
            </button>
          ))}
        </nav>
      </div>

      <div className="mt-auto p-8">
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
