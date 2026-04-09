import React, { useMemo } from 'react';
import { motion } from 'motion/react';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { Package, Truck, TrendingDown, Calendar } from 'lucide-react';

export const ShipmentCostTab: React.FC = () => {
  const transactions = useWarehouseStore((state) => state.transactions);

  // We only care about 'Расход' transactions for shipment costs
  const shipmentTransactions = useMemo(() => {
    return transactions
      .filter(t => t.type === 'Расход')
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [transactions]);

  // Group by date and destination to show shipments as batches
  const groupedShipments = useMemo(() => {
    const groups: Record<string, typeof shipmentTransactions> = {};
    
    shipmentTransactions.forEach(t => {
      // Group by date (DD-MM-YYYY) and destination
      let dateStr = '';
      if (t.date) {
        if (t.date.includes('.')) {
          dateStr = t.date.split(',')[0].trim().replace(/\./g, '-');
        } else {
          const d = new Date(t.date);
          if (!isNaN(d.getTime())) {
            const day = String(d.getDate()).padStart(2, '0');
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const year = d.getFullYear();
            dateStr = `${day}-${month}-${year}`;
          } else {
            dateStr = t.date.split('T')[0];
          }
        }
      }
      
      const key = `${dateStr}_${t.destination}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    });

    return Object.entries(groups).map(([key, items]) => {
      const dateStr = key.split('_')[0];
      const destination = key.split('_')[1];
      const totalCost = items.reduce((sum, item) => sum + item.total, 0);
      const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
      
      return {
        id: key,
        date: items[0].date,
        dateStr,
        destination,
        totalCost,
        totalItems,
        items
      };
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [shipmentTransactions]);

  const totalShipmentCost = useMemo(() => {
    return shipmentTransactions.reduce((sum, t) => sum + t.total, 0);
  }, [shipmentTransactions]);

  return (
    <motion.div 
      key="shipment-cost"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="max-w-6xl mx-auto space-y-8"
    >
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="space-y-2">
          <h2 className="text-3xl font-bold">Себестоимость отгрузки</h2>
          <p className="text-slate-500">Анализ себестоимости отгруженных товаров с учетом доп. расходов</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600">
            <TrendingDown size={28} />
          </div>
          <div>
            <div className="text-sm font-bold text-slate-400 uppercase tracking-wider">Общая себестоимость</div>
            <div className="text-2xl font-bold text-slate-900">{totalShipmentCost.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} ₽</div>
          </div>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center text-emerald-600">
            <Package size={28} />
          </div>
          <div>
            <div className="text-sm font-bold text-slate-400 uppercase tracking-wider">Отгружено товаров</div>
            <div className="text-2xl font-bold text-slate-900">
              {shipmentTransactions.reduce((sum, t) => sum + t.quantity, 0).toLocaleString()} шт
            </div>
          </div>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center text-blue-600">
            <Truck size={28} />
          </div>
          <div>
            <div className="text-sm font-bold text-slate-400 uppercase tracking-wider">Всего отгрузок</div>
            <div className="text-2xl font-bold text-slate-900">{groupedShipments.length}</div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 bg-slate-50/50">
          <h3 className="text-lg font-bold">История отгрузок</h3>
        </div>
        
        {groupedShipments.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <Package size={48} className="mx-auto mb-4 opacity-20" />
            <p className="text-lg font-medium">Нет данных об отгрузках</p>
            <p className="text-sm">Оформите расход товара, чтобы увидеть расчет себестоимости.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {groupedShipments.map((group) => (
              <div key={group.id} className="p-6 hover:bg-slate-50/50 transition-colors">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600">
                      <Calendar size={24} />
                    </div>
                    <div>
                      <div className="font-bold text-lg">{group.dateStr}</div>
                      <div className="text-sm text-slate-500 flex items-center gap-2">
                        <Truck size={14} /> {group.destination}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-slate-900">{group.totalCost.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} ₽</div>
                    <div className="text-sm text-slate-500">{group.totalItems} шт.</div>
                  </div>
                </div>
                
                <div className="mt-4 bg-slate-50 rounded-2xl p-4 border border-slate-100">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="text-slate-400 uppercase text-[10px] tracking-widest">
                        <th className="pb-2 font-bold">Артикул</th>
                        <th className="pb-2 font-bold text-right">Кол-во</th>
                        <th className="pb-2 font-bold text-right">Себест. ед.</th>
                        <th className="pb-2 font-bold text-right">Итого</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100/50">
                      {group.items.map(item => (
                        <tr key={item.id}>
                          <td className="py-2 font-mono text-indigo-600 font-bold">{item.article}</td>
                          <td className="py-2 text-right font-medium">{item.quantity}</td>
                          <td className="py-2 text-right text-slate-600 whitespace-nowrap">{item.price.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} ₽</td>
                          <td className="py-2 text-right font-bold text-slate-900 whitespace-nowrap">{item.total.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} ₽</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
};
