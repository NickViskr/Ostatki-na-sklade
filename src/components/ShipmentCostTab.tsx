import React, { useState, useMemo, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { useWarehouseStore } from "../store/useWarehouseStore";
import { useUIStore } from "../store/useUIStore";
import {
  Package,
  Truck,
  TrendingDown,
  Calendar,
  Filter,
  Edit3,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Download,
  Settings,
  Save,
  Loader2,
  X,
} from "lucide-react";
import { ConfirmDialog } from "./ConfirmDialog";
import { formatCurrency, parseAppDate } from "../lib/utils";
import { toast } from "sonner";

const extractDestinationName = (destination: string): string => {
  if (!destination) return '';
  const bracketIdx = destination.indexOf('[');
  return bracketIdx > 0 ? destination.slice(0, bracketIdx).trim() : destination.trim();
};

// Helper to parse costs from destination string
const parseExtraCostsFromDestination = (destination: string) => {
  if (!destination) return { destinationName: '', packagingCost: 0, packagingDist: 'batch' as 'unit' | 'batch', otherCost: 0, otherDist: 'batch' as 'unit' | 'batch', totalServicesCost: 0 };

  const bracketMatch = destination.match(/(.*?)\[(.*?)\]$/);
  if (!bracketMatch) {
    return { destinationName: destination.trim(), packagingCost: 0, packagingDist: 'batch' as 'unit' | 'batch', otherCost: 0, otherDist: 'batch' as 'unit' | 'batch', totalServicesCost: 0 };
  }

  const destinationName = bracketMatch[1].trim();
  const tagsStr = bracketMatch[2];
  const tags = tagsStr.split('|').map(s => s.trim());

  let packagingCost = 0;
  let packagingDist: 'unit' | 'batch' = 'batch';
  let otherCost = 0;
  let otherDist: 'unit' | 'batch' = 'batch';
  let totalServicesCost = 0;

  tags.forEach(tag => {
    // Check packaging
    if (tag.startsWith('Упаковка:')) {
      const details = tag.replace('Упаковка:', '').trim();
      const unitMatch = details.match(/ шт\.\s*x\s*(\d+(?:\.\d+)?)₽/);
      if (unitMatch) {
        packagingCost = parseFloat(unitMatch[1]);
        packagingDist = 'unit';
      } else {
        const flatMatch = details.match(/(\d+(?:\.\d+)?)₽/);
        if (flatMatch) {
          packagingCost = parseFloat(flatMatch[1]);
          packagingDist = 'batch';
        }
      }
    }
    // Check other
    else if (tag.startsWith('Прочее:')) {
      const details = tag.replace('Прочее:', '').trim();
      const unitMatch = details.match(/ шт\.\s*x\s*(\d+(?:\.\d+)?)₽/);
      if (unitMatch) {
        otherCost = parseFloat(unitMatch[1]);
        otherDist = 'unit';
      } else {
        const flatMatch = details.match(/(\d+(?:\.\d+)?)₽/);
        if (flatMatch) {
          otherCost = parseFloat(flatMatch[1]);
          otherDist = 'batch';
        }
      }
    }
    // Check services
    else if (tag.startsWith('Услуги:')) {
      const details = tag.replace('Услуги:', '').trim();
      const costMatches = details.matchAll(/\((\d+(?:\.\d+)?)₽\)/g);
      for (const match of costMatches) {
        totalServicesCost += parseFloat(match[1]);
      }
    }
  });

  return {
    destinationName,
    packagingCost,
    packagingDist,
    otherCost,
    otherDist,
    totalServicesCost
  };
};

const resolveRedistributedTransactions = (
  originalItems: any[],
  deletedItemId: string
) => {
  const deletedItem = originalItems.find(t => t.id === deletedItemId);
  if (!deletedItem) return [];

  const remainingItems = originalItems.filter(t => t.id !== deletedItemId);
  if (remainingItems.length === 0) return [];

  const {
    destinationName,
    packagingCost,
    packagingDist,
    otherCost,
    otherDist,
    totalServicesCost
  } = parseExtraCostsFromDestination(deletedItem.destination);

  const totalStoredValue = originalItems.reduce((sum, item) => sum + (item.quantity * item.price), 0);
  const totalQuantity = originalItems.reduce((sum, item) => sum + item.quantity, 0);

  const packPerUnit = packagingDist === 'unit' ? packagingCost : (totalQuantity > 0 ? packagingCost / totalQuantity : 0);
  const otherPerUnit = otherDist === 'unit' ? otherCost : (totalQuantity > 0 ? otherCost / totalQuantity : 0);
  const K = packPerUnit + otherPerUnit;

  const totalBaseValue = Math.max(0, totalStoredValue - (totalQuantity * K) - totalServicesCost);
  const R = totalBaseValue > 0 ? (1 + totalServicesCost / totalBaseValue) : 1;

  const basePricesById: Record<string, number> = {};
  originalItems.forEach(item => {
    const basePrice = Math.max(0, (item.price - K) / R);
    basePricesById[item.id] = basePrice;
  });

  const newTotalQuantity = remainingItems.reduce((sum, item) => sum + item.quantity, 0);
  const newTotalBaseValue = remainingItems.reduce((sum, item) => sum + (item.quantity * basePricesById[item.id]), 0);

  const newPackPerUnit = packagingDist === 'unit' ? packagingCost : (newTotalQuantity > 0 ? packagingCost / newTotalQuantity : 0);
  const newOtherPerUnit = otherDist === 'unit' ? otherCost : (newTotalQuantity > 0 ? otherCost / newTotalQuantity : 0);

  const extraParts: string[] = [];
  if (packagingCost > 0) {
    if (packagingDist === 'unit') {
      extraParts.push(`Упаковка: ${newTotalQuantity} шт. x ${packagingCost}₽ = ${packagingCost * newTotalQuantity}₽`);
    } else {
      extraParts.push(`Упаковка: ${packagingCost}₽`);
    }
  }
  if (otherCost > 0) {
    if (otherDist === 'unit') {
      extraParts.push(`Прочее: ${newTotalQuantity} шт. x ${otherCost}₽ = ${otherCost * newTotalQuantity}₽`);
    } else {
      extraParts.push(`Прочее: ${otherCost}₽`);
    }
  }
  
  const bracketMatch = deletedItem.destination.match(/(.*?)\[(.*?)\]$/);
  if (bracketMatch) {
    const tagsStr = bracketMatch[2];
    const servicesTag = tagsStr.split('|').map((s: string) => s.trim()).find((tag: string) => tag.startsWith('Услуги:'));
    if (servicesTag) {
      extraParts.push(servicesTag);
    }
  }

  const newDestination = extraParts.length > 0
    ? `${destinationName} [${extraParts.join(' | ')}]`
    : destinationName;

  return remainingItems.map(item => {
    const basePrice = basePricesById[item.id];
    const servicesExtraPerUnit = newTotalBaseValue > 0 
      ? (totalServicesCost * basePrice) / newTotalBaseValue
      : 0;

    const newPrice = Math.round((basePrice + newPackPerUnit + newOtherPerUnit + servicesExtraPerUnit) * 100) / 100;
    const newTotal = Math.round((newPrice * item.quantity) * 100) / 100;

    return {
      ...item,
      price: newPrice,
      total: newTotal,
      destination: newDestination
    };
  });
};

const getMonthKey = (dateRaw: string): string => {
  const d = parseAppDate(dateRaw);
  if (!d) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const formatMonthLabel = (monthKey: string): string => {
  const [year, month] = monthKey.split('-');
  const months = ['Январь','Февраль','Март','Апрель','Май','Июнь',
                  'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  return `${months[parseInt(month) - 1]} ${year}`;
};

const recalculateGroupWithNewServices = (
  mainItems: any[],
  newPackagingCost: number,
  newPackagingDist: 'unit' | 'batch',
  newOtherCost: number,
  newOtherDist: 'unit' | 'batch',
  newServicesList: { name: string; unitCost: number; quantity: number }[],
  destinationName: string
): any[] => {
  const totalQty = mainItems.reduce((sum, item) => sum + item.quantity, 0);

  const {
    packagingCost: oldPackCost,
    packagingDist: oldPackDist,
    otherCost: oldOtherCost,
    otherDist: oldOtherDist,
    totalServicesCost: oldServicesCost,
  } = parseExtraCostsFromDestination(mainItems[0]?.destination || '');

  const oldPackPerUnit = oldPackDist === 'unit' ? oldPackCost : (totalQty > 0 ? oldPackCost / totalQty : 0);
  const oldOtherPerUnit = oldOtherDist === 'unit' ? oldOtherCost : (totalQty > 0 ? oldOtherCost / totalQty : 0);
  const oldK = oldPackPerUnit + oldOtherPerUnit;
  const totalStoredValue = mainItems.reduce((sum, i) => sum + i.quantity * i.price, 0);
  const oldTotalBaseValue = Math.max(0, totalStoredValue - totalQty * oldK - oldServicesCost);
  const oldR = oldTotalBaseValue > 0 ? (1 + oldServicesCost / oldTotalBaseValue) : 1;

  const itemsWithBase = mainItems.map(item => ({
    ...item,
    basePrice: Math.max(0, (item.price - oldK) / oldR),
  }));

  const newTotalServicesCost = newServicesList.reduce((sum, s) => sum + s.unitCost * s.quantity, 0);
  const newPackPerUnit = newPackagingDist === 'unit' ? newPackagingCost : (totalQty > 0 ? newPackagingCost / totalQty : 0);
  const newOtherPerUnit = newOtherDist === 'unit' ? newOtherCost : (totalQty > 0 ? newOtherCost / totalQty : 0);
  const newK = newPackPerUnit + newOtherPerUnit;
  const newTotalBaseValue = itemsWithBase.reduce((sum, i) => sum + i.quantity * i.basePrice, 0);
  const newR = newTotalBaseValue > 0 ? (1 + newTotalServicesCost / newTotalBaseValue) : 1;

  const extraParts: string[] = [];
  if (newPackagingCost > 0) {
    extraParts.push(newPackagingDist === 'unit'
      ? `Упаковка: ${totalQty} шт. x ${newPackagingCost}₽ = ${newPackagingCost * totalQty}₽`
      : `Упаковка: ${newPackagingCost}₽`);
  }
  if (newOtherCost > 0) {
    extraParts.push(newOtherDist === 'unit'
      ? `Прочее: ${totalQty} шт. x ${newOtherCost}₽ = ${newOtherCost * totalQty}₽`
      : `Прочее: ${newOtherCost}₽`);
  }
  if (newServicesList.length > 0) {
    const serviceDetails = newServicesList.map(s => `${s.name} x${s.quantity} (${Math.round(s.unitCost * s.quantity)}₽)`).join(', ');
    extraParts.push(`Услуги: ${serviceDetails}`);
  }
  const newDestination = extraParts.length > 0
    ? `${destinationName} [${extraParts.join(' | ')}]`
    : destinationName;

  return itemsWithBase.map(item => {
    const servicesExtra = newTotalBaseValue > 0
      ? (newTotalServicesCost * item.basePrice) / newTotalBaseValue
      : 0;
    const newPrice = Math.round((item.basePrice + newK + servicesExtra) * 100) / 100;
    const newTotal = Math.round(newPrice * item.quantity * 100) / 100;
    return { ...item, price: newPrice, total: newTotal, destination: newDestination };
  });
};

export const ShipmentCostTab: React.FC = React.memo(() => {
  const transactions = useWarehouseStore((state) => state.transactions);
  const handleDeleteTransaction = useWarehouseStore(
    (state) => state.handleDeleteTransaction,
  );
  const handleDeleteMultipleTransactions = useWarehouseStore(
    (state) => state.handleDeleteMultipleTransactions,
  );
  const handleUpdateTransaction = useWarehouseStore(
    (state) => state.handleUpdateTransaction,
  );
  const services = useWarehouseStore((state) => state.services);

  const setEditingTrans = useUIStore((state) => state.setEditingTrans);
  const setShowEditTransModal = useUIStore(
    (state) => state.setShowEditTransModal,
  );

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [destinationFilter, setDestinationFilter] = useState("");

  const formatDateStr = (dateRaw?: string, fallback = "") => {
    if (!dateRaw) return fallback;
    // ISO format (contains T) — must check BEFORE checking for "."
    // because ISO milliseconds ".177" would trigger the wrong branch
    if (dateRaw.includes("T")) {
      const d = new Date(dateRaw);
      if (!isNaN(d.getTime())) {
        const day = String(d.getDate()).padStart(2, "0");
        const month = String(d.getMonth() + 1).padStart(2, "0");
        const year = d.getFullYear();
        return `${day}-${month}-${year}`;
      }
      return dateRaw.split("T")[0];
    }
    if (dateRaw.includes(".")) {
      return dateRaw.split(",")[0].trim().replace(/\./g, "-");
    }
    const d = new Date(dateRaw);
    if (!isNaN(d.getTime())) {
      const day = String(d.getDate()).padStart(2, "0");
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const year = d.getFullYear();
      return `${day}-${month}-${year}`;
    }
    return dateRaw.split("T")[0];
  };

  // We only care about 'Расход' transactions for shipment costs
  const shipmentTransactions = useMemo(() => {
    return transactions
      .filter((t) => t.type === "Расход")
      .filter((t) => {
        const dest = (t.destination || "").toLowerCase();
        if (dest.includes("списание") || dest.includes("миграция")) return false;

        if (destinationFilter && extractDestinationName(t.destination) !== destinationFilter)
          return false;

        if (!dateFrom && !dateTo) return true;

        const tDate = parseAppDate(t.deliveryDate || t.date);
        if (!tDate) return true;

        const timestamp = tDate.getTime();

        if (dateFrom) {
          const fromTimestamp = new Date(dateFrom).getTime();
          if (timestamp < fromTimestamp) return false;
        }

        if (dateTo) {
          const toDate = new Date(dateTo);
          toDate.setHours(23, 59, 59, 999);
          if (timestamp > toDate.getTime()) return false;
        }

        return true;
      })
      .sort((a, b) => {
        const aDate = parseAppDate(a.deliveryDate || a.date);
        const bDate = parseAppDate(b.deliveryDate || b.date);
        return (bDate ? bDate.getTime() : 0) - (aDate ? aDate.getTime() : 0);
      });
  }, [transactions, dateFrom, dateTo, destinationFilter]);

  // Group by date and destination to show shipments as batches
  const groupedShipments = useMemo(() => {
    const groups: Record<string, typeof shipmentTransactions> = {};

    shipmentTransactions.forEach((t) => {
      const dateStr = formatDateStr(t.date, "no-date");

      let effectiveDeliveryDate = t.deliveryDate;
      let effectiveDestination = t.destination;

      if (t.isComponent && t.groupId) {
        const mainTx = shipmentTransactions.find(
          (m) => m.groupId === t.groupId && !m.isComponent
        );
        if (mainTx) {
          effectiveDeliveryDate = mainTx.deliveryDate;
          effectiveDestination = mainTx.destination;
        }
      }

      const deliveryDateStr = formatDateStr(effectiveDeliveryDate, "no-date");

      const key = `${dateStr}_${deliveryDateStr}_${effectiveDestination}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    });

    return Object.entries(groups)
      .map(([key, items]) => {
        const firstItem = items[0];
        const dateStr = formatDateStr(firstItem.date, "no-date");
        const deliveryDateStr = formatDateStr(
          firstItem.deliveryDate,
          "no-date",
        );
        const destination = firstItem.destination || "";

        const mainItems = items.filter(item => !item.isComponent);
        const totalCost = mainItems.reduce((sum, item) => {
          return sum + (item.total ?? item.writeOffCost ?? 0);
        }, 0);
        const totalItems = mainItems.reduce((sum, item) => sum + item.quantity, 0);

        return {
          id: key,
          date: firstItem.date,
          dateStr: dateStr === "no-date" ? "" : dateStr,
          destination,
          totalCost,
          totalItems,
          deliveryDateStr: deliveryDateStr === "no-date" ? "" : deliveryDateStr,
          items,
        };
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [transactions, shipmentTransactions]);

  const [transToDelete, setTransToDelete] = useState<string | null>(null);
  const [isLastItem, setIsLastItem] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedKitGroups, setExpandedKitGroups] = useState<Set<string>>(new Set());
  const toggleKit = (groupId: string) => {
    setExpandedKitGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
      return next;
    });
  };

  const [viewMode, setViewMode] = useState<'detailed' | 'monthly'>('detailed');
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [expandedMonthlyKits, setExpandedMonthlyKits] = useState<Set<string>>(new Set());

  type ServiceEditData = {
    packagingCost: number;
    packagingDist: 'unit' | 'batch';
    otherCost: number;
    otherDist: 'unit' | 'batch';
    servicesList: { name: string; unitCost: number; quantity: number }[];
    destinationName: string;
  };
  const [editingServicesGroup, setEditingServicesGroup] = useState<typeof groupedShipments[0] | null>(null);
  const [serviceEditData, setServiceEditData] = useState<ServiceEditData | null>(null);
  const [isSavingServices, setIsSavingServices] = useState(false);

  const openServicesModal = useCallback((group: typeof groupedShipments[0]) => {
    const { destinationName, packagingCost, packagingDist, otherCost, otherDist } =
      parseExtraCostsFromDestination(group.destination);
    const servicesList: { name: string; unitCost: number; quantity: number }[] = [];
    const bracketMatch = group.destination.match(/(.*?)\[(.*?)\]$/);
    if (bracketMatch) {
      const servicesTag = bracketMatch[2].split('|').map((s: string) => s.trim()).find((tag: string) => tag.startsWith('Услуги:'));
      if (servicesTag) {
        const re = /([^(]+)\((\d+(?:\.\d+)?)₽\)/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(servicesTag)) !== null) {
          // Strip "Услуги:" prefix (first item) and leading "," separator (subsequent items)
          let rawName = m[1].trim().replace(/^Услуги:\s*/, '').replace(/^,\s*/, '').trim();
          const totalCost = parseFloat(m[2]);

          // Detect "ServiceName x{qty}" format stored by ConfirmModal
          const qtyMatch = rawName.match(/^(.*?)\s+x(\d+)\s*$/i);
          let name: string;
          let storedQty: number;
          if (qtyMatch) {
            name = qtyMatch[1].trim();
            storedQty = parseInt(qtyMatch[2], 10) || 1;
          } else {
            name = rawName;
            storedQty = 1;
          }

          // Look up unit cost from services store by clean name
          const storeService = services.find(s => s.name === name);
          const unitCost = storeService?.cost && storeService.cost > 0
            ? storeService.cost
            : (storedQty > 0 ? totalCost / storedQty : totalCost);
          const quantity = unitCost > 0 ? Math.max(1, Math.round(totalCost / unitCost)) : storedQty;
          servicesList.push({ name, unitCost, quantity });
        }
      }
    }
    setServiceEditData({ packagingCost, packagingDist, otherCost, otherDist, servicesList, destinationName });
    setEditingServicesGroup(group);
  }, [groupedShipments, services]);

  const handleSaveServices = useCallback(async () => {
    if (!editingServicesGroup || !serviceEditData) return;
    setIsSavingServices(true);
    try {
      const mainItems = editingServicesGroup.items.filter(t => !t.isComponent);
      const updated = recalculateGroupWithNewServices(
        mainItems,
        serviceEditData.packagingCost,
        serviceEditData.packagingDist,
        serviceEditData.otherCost,
        serviceEditData.otherDist,
        serviceEditData.servicesList,
        serviceEditData.destinationName
      );
      for (const item of updated) {
        await handleUpdateTransaction(item.id, item);
      }
      toast.success('Услуги поставки обновлены, себестоимость пересчитана!');
      setEditingServicesGroup(null);
      setServiceEditData(null);
    } catch (e) {
      toast.error('Ошибка при обновлении услуг');
    } finally {
      setIsSavingServices(false);
    }
  }, [editingServicesGroup, serviceEditData, handleUpdateTransaction]);
  const toggleMonthlyKit = (article: string) => {
    setExpandedMonthlyKits(prev => {
      const next = new Set(prev);
      if (next.has(article)) next.delete(article); else next.add(article);
      return next;
    });
  };
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);

  const uniqueDestinations = useMemo(() => {
    return Array.from(
      new Set(
        transactions
          .filter((t) => t.type === "Расход")
          .map((t) => extractDestinationName(t.destination)),
      ),
    )
      .filter(Boolean)
      .sort();
  }, [transactions]);

  // Definitions moved up

  const availableMonths = useMemo(() => {
    const months = new Set<string>();
    shipmentTransactions
      .filter(t => !t.isComponent)
      .forEach(t => {
        const m = getMonthKey(t.deliveryDate || t.date);
        if (m) months.add(m);
      });
    return Array.from(months).sort().reverse();
  }, [shipmentTransactions]);

  React.useEffect(() => {
    if (viewMode === 'monthly' && !selectedMonth && availableMonths.length > 0) {
      setSelectedMonth(availableMonths[0]);
    }
  }, [viewMode, availableMonths]);

  const monthlySummary = useMemo(() => {
    if (viewMode !== 'monthly') return [];

    // Step 1: filter only MAIN transactions by month and destination
    const mainTxs = shipmentTransactions.filter(t => {
      if (t.isComponent) return false;
      if (selectedMonth && getMonthKey(t.deliveryDate || t.date) !== selectedMonth) return false;
      if (destinationFilter && extractDestinationName(t.destination) !== destinationFilter) return false;
      return true;
    });

    // Step 2: collect groupIds from filtered main transactions
    const mainGroupIds = new Set(mainTxs.map(t => t.groupId).filter(Boolean) as string[]);

    // Step 3: collect ALL component transactions from full transactions list (same as HistoryTab)
    // Using transactions (not shipmentTransactions) so date/destination filters don't exclude components
    const componentsByGroupId = new Map<string, (typeof transactions[0])[]>();
    transactions
      .filter(t => t.isComponent && t.type === 'Расход' && t.groupId && mainGroupIds.has(t.groupId))
      .forEach(c => {
        const existing = componentsByGroupId.get(c.groupId!) || [];
        componentsByGroupId.set(c.groupId!, [...existing, c]);
      });

    const articleMap = new Map<string, {
      totalQty: number;
      mainTotal: number;
      compWriteOffSum: number;
      componentTotals: Map<string, { qty: number; total: number }>;
      isKit: boolean;
    }>();

    mainTxs.forEach(t => {
      const existing = articleMap.get(t.article) || {
        totalQty: 0,
        mainTotal: 0,
        compWriteOffSum: 0,
        componentTotals: new Map(),
        isKit: false,
      };

      existing.totalQty += t.quantity;
      existing.mainTotal += (t.total ?? t.writeOffCost ?? 0);

      if (t.groupId) {
        const comps = componentsByGroupId.get(t.groupId) || [];
        if (comps.length > 0) {
          existing.isKit = true;
          comps.forEach(c => {
            existing.compWriteOffSum += (c.writeOffCost ?? 0);
            const cEx = existing.componentTotals.get(c.article) || { qty: 0, total: 0 };
            cEx.qty += c.quantity;
            cEx.total += c.total;
            existing.componentTotals.set(c.article, cEx);
          });
        }
      }

      articleMap.set(t.article, existing);
    });

    // Collect all articles that appear as kit components
    const kitComponentArticles = new Set<string>();
    articleMap.forEach(data => {
      data.componentTotals.forEach((_, article) => kitComponentArticles.add(article));
    });

    return Array.from(articleMap.entries())
      .filter(([article, data]) => {
        // Exclude zero-cost component articles — they are stock-deduction records, not real line items
        if (kitComponentArticles.has(article) && data.mainTotal === 0) return false;
        return true;
      })
      .map(([article, data]) => {
        const totalCost = data.mainTotal;
        const unitCost = data.totalQty > 0 ? totalCost / data.totalQty : 0;

        const components = Array.from(data.componentTotals.entries()).map(([cArticle, cData]) => ({
          article: cArticle,
          totalQty: cData.qty,
          totalCost: cData.total,
          unitCost: cData.qty > 0 ? cData.total / cData.qty : 0,
        }));

        return { article, totalQty: data.totalQty, mainTotal: data.mainTotal,
                 totalCost, unitCost, isKit: data.isKit, components };
      })
      .sort((a, b) => b.totalCost - a.totalCost);
  }, [transactions, shipmentTransactions, viewMode, selectedMonth, destinationFilter]);

  const handleDeleteWithRedistribution = useCallback(async (idOfItemToDelete: string) => {
    let matchedGroupItems: typeof transactions = [];
    for (const group of groupedShipments) {
      if (group.items.some(it => it.id === idOfItemToDelete)) {
        matchedGroupItems = group.items;
        break;
      }
    }

    if (matchedGroupItems.length === 0) {
      await handleDeleteTransaction(idOfItemToDelete);
      return;
    }

    // Find the deleted item and its kit component IDs
    const deletedItem = matchedGroupItems.find(t => t.id === idOfItemToDelete);
    const kitComponentIds: string[] = deletedItem?.groupId
      ? matchedGroupItems
          .filter(t => t.isComponent && t.groupId === deletedItem.groupId)
          .map(t => t.id)
      : [];
    const allIdsToDelete = [idOfItemToDelete, ...kitComponentIds];

    // Only main (non-component) items for redistribution
    const mainItems = matchedGroupItems.filter(t => !t.isComponent);

    if (mainItems.length <= 1) {
      // This is the only kit/item in the batch — delete everything including components
      if (allIdsToDelete.length > 1) {
        await handleDeleteMultipleTransactions(allIdsToDelete);
      } else {
        await handleDeleteTransaction(idOfItemToDelete);
      }
      return;
    }

    // Multiple main items remain — redistribute costs over them
    const updatedRemainingItems = resolveRedistributedTransactions(mainItems, idOfItemToDelete);

    const isDeleted = allIdsToDelete.length > 1
      ? await handleDeleteMultipleTransactions(allIdsToDelete)
      : await handleDeleteTransaction(idOfItemToDelete);

    if (isDeleted) {
      for (const updatedItem of updatedRemainingItems) {
        await handleUpdateTransaction(updatedItem.id, updatedItem);
      }
      toast.success("Внутренние расходы поставки перераспределены на оставшиеся артикулы!");
    }
  }, [groupedShipments, handleDeleteTransaction, handleDeleteMultipleTransactions, handleUpdateTransaction]);

  const exportToCSV = () => {
    if (shipmentTransactions.length === 0) return;

    const headers = [
      "Дата заведения",
      "Дата поставки",
      "Объект (Куда)",
      "Артикул",
      "Количество",
      "Себестоимость ед.",
      "Итого",
      "Комментарий",
    ];

    const csvContent = [
      headers.join(";"),
      ...shipmentTransactions.map((t) => {
        let dest = t.destination || '';
        const bracketMatch = dest.match(/(.*?)\[(.*?)\]$/);
        const stringMatch = dest.match(/(.*?)(?:\.\s*)?(Услуги:\s*.*|Доп\. услуги:\s*.*)$/);
        
        let main = '';
        if (bracketMatch) {
          main = bracketMatch[1].trim();
        } else if (stringMatch) {
          main = stringMatch[1].trim();
        } else {
          main = dest.trim();
        }

        return [
          formatDateStr(t.date),
          formatDateStr(t.deliveryDate),
          `"${main.replace(/"/g, '""')}"`,
          `"${(t.article || "").replace(/"/g, '""')}"`,
          t.quantity,
          (t.price || 0).toFixed(2).replace(".", ","),
          (t.total || 0).toFixed(2).replace(".", ","),
          `"${(t.comment || "").replace(/"/g, '""')}"`,
        ].join(";");
      }),
    ].join("\n");

    // Add BOM for Excel compatibility with UTF-8
    const blob = new Blob(["\ufeff" + csvContent], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;

    const timestamp = new Date().toISOString().split("T")[0];
    link.download = `shipments_${timestamp}.csv`;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const totalShipmentCost = useMemo(() => {
    if (viewMode === 'monthly') {
      return monthlySummary.reduce((sum, i) => sum + i.totalCost, 0);
    }
    return groupedShipments.reduce((sum, g) => sum + g.totalCost, 0);
  }, [shipmentTransactions, viewMode, monthlySummary]);

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);

  React.useEffect(() => {
    setCurrentPage(1);
  }, [dateFrom, dateTo, destinationFilter]);

  const totalPages = Math.ceil(groupedShipments.length / pageSize) || 1;

  const displayedGroups = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return groupedShipments.slice(start, start + pageSize);
  }, [groupedShipments, currentPage, pageSize]);

  const handleSelectAllGroup = useCallback((groupItems: any[], checked: boolean) => {
    const newSet = new Set(selectedIds);
    groupItems.filter(t => !t.isComponent).forEach(t => {
      if (checked) newSet.add(t.id);
      else newSet.delete(t.id);
    });
    setSelectedIds(newSet);
  }, [selectedIds]);

  const toggleSelect = useCallback((id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  }, [selectedIds]);

  const currentSelectionCount = selectedIds.size;

  const handleBulkDelete = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const success = await handleDeleteMultipleTransactions(Array.from(selectedIds));
    if (success) setSelectedIds(new Set());
    setBulkDeleteConfirm(false);
  }, [selectedIds, handleDeleteMultipleTransactions]);

  return (
    <div
      key="shipment-cost"
      className="max-w-6xl mx-auto space-y-8 tab-enter"
    >
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="space-y-2">
          <h2 className="text-3xl font-bold">Себестоимость отгрузки</h2>
          <p className="text-slate-500">
            Анализ себестоимости отгруженных товаров с учетом доп. расходов
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          {currentSelectionCount > 0 && (
            <button
              onClick={() => setBulkDeleteConfirm(true)}
              className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-xl hover:bg-red-100 transition-colors font-medium border border-red-100"
            >
              <Trash2 size={18} />
              Удалить выбранные ({currentSelectionCount})
            </button>
          )}

          <button
            onClick={exportToCSV}
            disabled={shipmentTransactions.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-600 rounded-xl hover:bg-emerald-100 transition-colors font-medium border border-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Выгрузить отфильтрованные данные в CSV"
          >
            <Download size={18} />
            <span className="hidden sm:inline">Экспорт CSV</span>
          </button>

          <div className="flex flex-wrap items-center gap-2 bg-white p-2 rounded-2xl shadow-sm border border-slate-200 w-full md:w-auto">
            <div className="flex items-center gap-2 px-2 border-r border-slate-100 text-slate-400">
              <Filter size={16} />
              <span className="text-sm font-medium hidden sm:inline">
                Фильтр:
              </span>
            </div>

            <select
              value={destinationFilter}
              onChange={(e) => setDestinationFilter(e.target.value)}
              className="px-2 py-1 outline-none text-sm bg-transparent font-medium border-r border-slate-100 w-[160px] truncate text-slate-600 focus:text-slate-900"
            >
              <option value="">Все объекты</option>
              {uniqueDestinations.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>

            {viewMode === 'monthly' && (
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="px-2 py-1 outline-none text-sm bg-transparent font-medium border-r border-slate-100 w-[180px] text-slate-600 focus:text-slate-900"
              >
                <option value="">Все месяцы</option>
                {availableMonths.map(m => (
                  <option key={m} value={m}>{formatMonthLabel(m)}</option>
                ))}
              </select>
            )}

            {viewMode === 'detailed' && (
              <>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="px-2 py-1 outline-none text-sm bg-transparent font-medium"
                  title="С даты"
                />
                <span className="text-slate-300">-</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="px-2 py-1 outline-none text-sm bg-transparent font-medium"
                  title="По дату"
                />
              </>
            )}

            {(viewMode === 'detailed' ? (dateFrom || dateTo || destinationFilter) : (destinationFilter || selectedMonth)) && (
              <button
                onClick={() => {
                  if (viewMode === 'detailed') {
                    setDateFrom("");
                    setDateTo("");
                    setDestinationFilter("");
                  } else {
                    setDestinationFilter("");
                    setSelectedMonth(availableMonths[0] || "");
                  }
                }}
                className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-xs font-bold transition-colors ml-1 whitespace-nowrap"
              >
                Сбросить
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600">
            <TrendingDown size={28} />
          </div>
          <div>
            <div className="text-sm font-bold text-slate-400 uppercase tracking-wider">
              Общая себестоимость
            </div>
            <div className="text-2xl font-bold text-slate-900">
              {formatCurrency(totalShipmentCost)} ₽
            </div>
          </div>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center text-emerald-600">
            <Package size={28} />
          </div>
          <div>
            <div className="text-sm font-bold text-slate-400 uppercase tracking-wider">
              Отгружено товаров
            </div>
            <div className="text-2xl font-bold text-slate-900">
              {(viewMode === 'monthly'
                ? monthlySummary.reduce((sum, i) => sum + i.totalQty, 0)
                : shipmentTransactions.reduce((sum, t) => sum + t.quantity, 0)
              ).toLocaleString()}{" "}
              шт
            </div>
          </div>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center text-blue-600">
            <Truck size={28} />
          </div>
          <div>
            <div className="text-sm font-bold text-slate-400 uppercase tracking-wider">
              Всего отгрузок
            </div>
            <div className="text-2xl font-bold text-slate-900">
              {viewMode === 'monthly' ? monthlySummary.length : groupedShipments.length}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
          <h3 className="text-lg font-bold">История отгрузок</h3>
          <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
            <button
              onClick={() => setViewMode('detailed')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                viewMode === 'detailed'
                  ? 'bg-white shadow text-slate-900'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >Детально</button>
            <button
              onClick={() => { setViewMode('monthly'); setDateFrom(''); setDateTo(''); }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                viewMode === 'monthly'
                  ? 'bg-white shadow text-slate-900'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >По месяцам</button>
          </div>
        </div>

        {groupedShipments.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <Package size={48} className="mx-auto mb-4 opacity-20" />
            <p className="text-lg font-medium">Нет данных об отгрузках</p>
            <p className="text-sm">
              Оформите расход товара, чтобы увидеть расчет себестоимости.
            </p>
          </div>
        ) : (
          <>
            {viewMode === 'detailed' && (
              <div className="divide-y divide-slate-100">
                {displayedGroups.map((group) => (
              <div
                key={group.id}
                className="p-6 hover:bg-slate-50/50 transition-colors"
              >
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600">
                      <Calendar size={24} />
                    </div>
                    <div>
                      <div className="font-bold text-lg">{group.dateStr}</div>
                      {group.deliveryDateStr && (
                        <div className="text-xs font-bold text-emerald-600 mb-1">
                          Поставка: {group.deliveryDateStr}
                        </div>
                      )}
                      <div className="text-[13px] text-slate-600 flex items-start gap-2 max-w-full">
                        <Truck size={16} className="mt-0.5 min-w-[16px] text-slate-400" />
                        {(() => {
                          if (!group.destination) return <span>-</span>;
                          
                          // Handle new bracket format block [Part1 | Part2] or old formats
                          const bracketMatch = group.destination.match(/(.*?)\[(.*?)\]$/);
                          const stringMatch = group.destination.match(/(.*?)(?:\.\s*)?(Услуги:\s*.*|Доп\. услуги:\s*.*)$/);

                          let main = '';
                          let tags: string[] = [];

                          if (bracketMatch) {
                            main = bracketMatch[1].trim();
                            tags = bracketMatch[2].split('|').map(s => s.trim());
                          } else if (stringMatch) {
                            main = stringMatch[1].trim();
                            if (stringMatch[2]) tags = [stringMatch[2].trim()];
                          } else {
                            main = group.destination.trim();
                          }

                          if (tags.length === 0) {
                            return <span className="whitespace-normal break-words font-medium">{main}</span>;
                          }

                          return (
                            <div className="flex flex-col gap-1.5 w-full">
                              {main && <span className="font-medium text-slate-800 text-sm">{main}</span>}
                              <div className="flex flex-col gap-1.5">
                                {tags.map((tag, idx) => {
                                  const isServices = tag.toLowerCase().startsWith('услуги') || tag.toLowerCase().startsWith('доп');
                                  const isPack = tag.toLowerCase().startsWith('упаковка');
                                  const isOther = tag.toLowerCase().startsWith('прочее');
                                  
                                  let bgClass = "bg-slate-50 text-slate-500 border border-slate-100";
                                  if (isServices) bgClass = "bg-indigo-50 text-indigo-700 border border-indigo-100";
                                  if (isPack) bgClass = "bg-emerald-50 text-emerald-700 border border-emerald-100";
                                  if (isOther) bgClass = "bg-rose-50 text-rose-700 border border-rose-100";

                                  return (
                                    <span key={idx} className={`text-xs px-2 py-1.5 rounded-lg w-fit leading-normal shadow-sm font-medium ${bgClass}`}>
                                      {tag.replace(/^(Доп\. услуги:|Услуги:)\s*/, 'Услуги: ')}
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => openServicesModal(group)}
                      className="p-2 hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 rounded-xl transition-all border border-slate-200 hover:border-indigo-200"
                      title="Редактировать доп. услуги поставки"
                    >
                      <Settings size={18} />
                    </button>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-slate-900 whitespace-nowrap">
                        {formatCurrency(group.totalCost)} ₽
                      </div>
                      <div className="text-sm text-slate-500">
                        {group.totalItems} шт.
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 bg-slate-50 rounded-2xl p-4 border border-slate-100">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="text-slate-400 uppercase text-[10px] tracking-widest">
                        <th className="pb-2 w-8 text-center">
                          <input
                            type="checkbox"
                            checked={(() => {
                              const mi = group.items.filter(t => !t.isComponent);
                              return mi.length > 0 && mi.every(t => selectedIds.has(t.id));
                            })()}
                            onChange={(e) =>
                              handleSelectAllGroup(
                                group.items,
                                e.target.checked,
                              )
                            }
                            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                          />
                        </th>
                        <th className="pb-2 font-bold">Артикул</th>
                        <th className="pb-2 font-bold text-right">Кол-во</th>
                        <th className="pb-2 font-bold text-right">
                          Себест. ед.
                        </th>
                        <th className="pb-2 font-bold text-right">Итого</th>
                        <th className="pb-2 font-bold text-right w-20">
                          Действия
                        </th>
                      </tr>
                    </thead>
                    {(() => {
                      const mainItems = group.items.filter(item => !item.isComponent);
                      const componentsByGroupId = new Map<string, typeof transactions>();
                      transactions.filter(item => item.isComponent && item.groupId && item.type === 'Расход').forEach(item => {
                        const existing = componentsByGroupId.get(item.groupId!) || [];
                        componentsByGroupId.set(item.groupId!, [...existing, item]);
                      });
                      
                      return (
                        <tbody className="divide-y divide-slate-100/50">
                          {mainItems.map((item) => {
                            const components = item.groupId ? (componentsByGroupId.get(item.groupId) || []) : [];
                            const isKit = components.length > 0;
                            const isExpanded = isKit && item.groupId ? expandedKitGroups.has(item.groupId) : false;
                            
                            const componentsTotalSum = components.reduce((sum, c) => sum + (c.total ?? 0), 0);
                            const kitTotalCost = isKit && isExpanded
                              ? (item.total ?? 0) - componentsTotalSum
                              : (item.total ?? item.writeOffCost ?? 0);
                            
                            const kitUnitPrice = item.quantity > 0 ? (item.total ?? item.writeOffCost ?? 0) / item.quantity : item.price;


                            
                            const displayPrice = isKit && !isExpanded ? kitUnitPrice : item.price;
                            
                            return (
                              <React.Fragment key={item.id}>
                                <tr className={selectedIds.has(item.id) ? "bg-indigo-50/50" : ""}>
                                  <td className="py-2 text-center">
                                    <input
                                      type="checkbox"
                                      checked={selectedIds.has(item.id)}
                                      onChange={() => toggleSelect(item.id)}
                                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                                    />
                                  </td>
                                  <td className="py-2 font-mono text-indigo-600 font-bold">
                                    <div className="flex items-center gap-1.5">
                                      {item.article}
                                      {isKit && (
                                        <button
                                          onClick={() => toggleKit(item.groupId!)}
                                          className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 bg-violet-100 text-violet-600 rounded hover:bg-violet-200 transition-colors cursor-pointer"
                                          title={isExpanded ? 'Свернуть' : 'Показать компоненты комплекта'}
                                        >
                                          {isExpanded ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
                                          {components.length} арт.
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                  <td className="py-2 text-right font-medium">{item.quantity}</td>
                                  <td className="py-2 text-right text-slate-600 whitespace-nowrap">
                                    {formatCurrency(displayPrice)} ₽
                                  </td>
                                  <td className="py-2 text-right font-bold text-slate-900 whitespace-nowrap">
                                    {formatCurrency(kitTotalCost)} ₽
                                  </td>
                                  <td className="py-2 text-right">
                                    <div className="flex justify-end gap-1 border-l pl-2 border-slate-100">
                                      <button
                                        onClick={() => { setEditingTrans(item); setShowEditTransModal(true); }}
                                        className="p-1.5 hover:bg-indigo-100 text-slate-400 hover:text-indigo-600 rounded-lg transition-all"
                                        title="Редактировать"
                                      >
                                        <Edit3 size={14} />
                                      </button>
                                      <button
                                        onClick={() => {
                                          const mainCount = group.items.filter(t => !t.isComponent).length;
                                          setIsLastItem(mainCount === 1);
                                          setTransToDelete(item.id);
                                        }}
                                        className="p-1.5 hover:bg-red-50 text-slate-400 hover:text-red-600 rounded-lg transition-all"
                                        title="Удалить"
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                                {isExpanded && components.map(c => (
                                  <tr key={c.id} className="bg-violet-50/50 border-l-4 border-l-violet-300">
                                    <td className="py-1.5 text-center" />
                                    <td className="py-1.5 pl-6 font-mono text-violet-700 text-sm">
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-violet-400">└</span>
                                        {c.article}
                                        <span className="text-[10px] px-1 py-0.5 bg-violet-100 text-violet-600 rounded font-bold">компл.</span>
                                      </div>
                                    </td>
                                    <td className="py-1.5 text-right text-sm text-slate-600">{c.quantity}</td>
                                    <td className="py-1.5 text-right text-sm text-slate-600 whitespace-nowrap">
                                      {formatCurrency(c.price)} ₽
                                    </td>
                                    <td className="py-1.5 text-right text-sm font-bold text-slate-700 whitespace-nowrap">
                                      {formatCurrency(c.total)} ₽
                                    </td>
                                    <td className="py-1.5 text-right">
                                      <span className="text-xs text-slate-300 italic px-2">авто</span>
                                    </td>
                                  </tr>
                                ))}
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                      );
                    })()}
                  </table>
                </div>
              </div>
            ))}
              </div>
            )}

            {viewMode === 'monthly' && (
              <div className="divide-y divide-slate-100">
                {monthlySummary.length === 0 ? (
                  <div className="p-12 text-center text-slate-500">
                    <Package size={48} className="mx-auto mb-4 opacity-20" />
                    <p className="text-lg font-medium">Нет данных за выбранный месяц</p>
                  </div>
                ) : (
                  <div className="p-6">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="text-slate-400 uppercase text-[10px] tracking-widest">
                          <th className="pb-3 font-bold">Артикул</th>
                          <th className="pb-3 font-bold text-right">Кол-во</th>
                          <th className="pb-3 font-bold text-right">Себест. ед.</th>
                          <th className="pb-3 font-bold text-right">Итого</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100/50">
                        {monthlySummary.map(item => {
                          const isExpanded = expandedMonthlyKits.has(item.article);
                          return (
                            <React.Fragment key={item.article}>
                              <tr className="hover:bg-slate-50/50 transition-colors">
                                <td className="py-3 font-mono text-indigo-600 font-bold">
                                  <div className="flex items-center gap-1.5">
                                    {item.article}
                                    {item.isKit && (
                                      <button
                                        onClick={() => toggleMonthlyKit(item.article)}
                                        className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 bg-violet-100 text-violet-600 rounded hover:bg-violet-200 transition-colors cursor-pointer"
                                        title={isExpanded ? 'Свернуть' : 'Показать компоненты'}
                                      >
                                        {isExpanded ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
                                        {item.components.length} арт.
                                      </button>
                                    )}
                                  </div>
                                </td>
                                <td className="py-3 text-right font-medium">{item.totalQty}</td>
                                <td className="py-3 text-right text-slate-600 whitespace-nowrap">
                                  {formatCurrency(item.unitCost)} ₽
                                </td>
                                <td className="py-3 text-right font-bold text-slate-900 whitespace-nowrap">
                                  {formatCurrency(item.totalCost)} ₽
                                </td>
                              </tr>
                              {isExpanded && item.components.map(c => (
                                <tr key={c.article} className="bg-violet-50/50 border-l-4 border-l-violet-300">
                                  <td className="py-2 pl-6 font-mono text-violet-700 text-sm">
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-violet-400">└</span>
                                      {c.article}
                                      <span className="text-[10px] px-1 py-0.5 bg-violet-100 text-violet-600 rounded font-bold">компл.</span>
                                    </div>
                                  </td>
                                  <td className="py-2 text-right text-sm text-slate-600">{c.totalQty}</td>
                                  <td className="py-2 text-right text-sm text-slate-600 whitespace-nowrap">
                                    {formatCurrency(c.unitCost)} ₽
                                  </td>
                                  <td className="py-2 text-right text-sm font-bold text-slate-700 whitespace-nowrap">
                                    {formatCurrency(c.totalCost)} ₽
                                  </td>
                                </tr>
                              ))}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                      <tfoot className="border-t-2 border-slate-200">
                        <tr>
                          <td className="py-3 font-bold text-slate-700">Итого за месяц</td>
                          <td className="py-3 text-right font-bold text-slate-700">
                            {monthlySummary.reduce((sum, i) => sum + i.totalQty, 0)}
                          </td>
                          <td />
                          <td className="py-3 text-right font-bold text-slate-900 whitespace-nowrap text-base">
                            {formatCurrency(monthlySummary.reduce((sum, i) => sum + i.totalCost, 0))} ₽
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {viewMode === 'detailed' && groupedShipments.length > 0 && (
          <div className="flex items-center justify-between p-4 border-t border-slate-200 bg-slate-50 rounded-b-3xl">
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-500">Показывать по:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="text-sm border border-slate-200 rounded-lg px-2 py-1 bg-white outline-none focus:ring-2 focus:ring-indigo-500 font-medium text-slate-700"
              >
                <option value={30}>30</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={150}>150</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-1 rounded-md hover:bg-slate-200 text-slate-600 disabled:opacity-50 disabled:hover:bg-transparent transition-colors"
                title="Предыдущая страница"
              >
                <ChevronLeft size={20} />
              </button>
              <span className="text-sm font-medium text-slate-600 px-2 min-w-[100px] text-center">
                Стр. {currentPage} из {totalPages}
              </span>
              <button
                onClick={() =>
                  setCurrentPage((p) => Math.min(totalPages, p + 1))
                }
                disabled={currentPage === totalPages}
                className="p-1 rounded-md hover:bg-slate-200 text-slate-600 disabled:opacity-50 disabled:hover:bg-transparent transition-colors"
                title="Следующая страница"
              >
                <ChevronRight size={20} />
              </button>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        show={transToDelete !== null}
        title={isLastItem ? "Удаление всей поставки" : "Удаление товара из отгрузки"}
        message={
          isLastItem
            ? "Это последний товар в данной поставке. Удаление этой позиции приведет к ПОЛНОМУ удалению всей поставки. Вы действительно хотите удалить всю поставку полностью?"
            : "При удалении этого товара из поставки все дополнительные расходы будут автоматически перераспределены на оставшиеся в этой поставке товары. Продолжить?"
        }
        onConfirm={async () => {
          if (transToDelete) {
            await handleDeleteWithRedistribution(transToDelete);
            setTransToDelete(null);
            setIsLastItem(false);
          }
        }}
        onCancel={() => {
          setTransToDelete(null);
          setIsLastItem(false);
        }}
      />

      <ConfirmDialog
        show={bulkDeleteConfirm}
        title="Удаление выбранных отгрузок"
        message={`Вы действительно хотите удалить ${currentSelectionCount} строк отгрузки из истории? Действие нельзя отменить. Товары будут соответственно удалены из истории.`}
        onConfirm={handleBulkDelete}
        onCancel={() => setBulkDeleteConfirm(false)}
      />

      {editingServicesGroup && serviceEditData && ReactDOM.createPortal(
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <div>
                <h3 className="text-2xl font-bold">Редактировать услуги</h3>
                <p className="text-sm text-slate-500 mt-1">
                  {serviceEditData.destinationName} · {editingServicesGroup.dateStr.replace(/-/g, '.')}
                </p>
              </div>
              <button
                onClick={() => { setEditingServicesGroup(null); setServiceEditData(null); }}
                className="p-3 hover:bg-white rounded-2xl transition-all shadow-sm border border-transparent hover:border-slate-200"
              >
                <X size={24} />
              </button>
            </div>

            <div className="p-8 space-y-6 max-h-[55vh] overflow-y-auto">
              <div className="space-y-3">
                <label className="text-sm font-bold text-slate-500 uppercase tracking-wider">Упаковка (₽)</label>
                <div className="flex items-center gap-3">
                  <input
                    type="number" min="0" step="0.01"
                    value={serviceEditData.packagingCost}
                    onChange={(e) => setServiceEditData(prev => prev ? { ...prev, packagingCost: parseFloat(e.target.value) || 0 } : prev)}
                    className="flex-1 px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="0"
                  />
                  <div className="flex bg-slate-100 rounded-xl p-1 gap-1">
                    <button
                      onClick={() => setServiceEditData(prev => prev ? { ...prev, packagingDist: 'batch' } : prev)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${serviceEditData.packagingDist === 'batch' ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                    >Партия</button>
                    <button
                      onClick={() => setServiceEditData(prev => prev ? { ...prev, packagingDist: 'unit' } : prev)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${serviceEditData.packagingDist === 'unit' ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                    >За шт.</button>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-sm font-bold text-slate-500 uppercase tracking-wider">Прочее (₽)</label>
                <div className="flex items-center gap-3">
                  <input
                    type="number" min="0" step="0.01"
                    value={serviceEditData.otherCost}
                    onChange={(e) => setServiceEditData(prev => prev ? { ...prev, otherCost: parseFloat(e.target.value) || 0 } : prev)}
                    className="flex-1 px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="0"
                  />
                  <div className="flex bg-slate-100 rounded-xl p-1 gap-1">
                    <button
                      onClick={() => setServiceEditData(prev => prev ? { ...prev, otherDist: 'batch' } : prev)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${serviceEditData.otherDist === 'batch' ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                    >Партия</button>
                    <button
                      onClick={() => setServiceEditData(prev => prev ? { ...prev, otherDist: 'unit' } : prev)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${serviceEditData.otherDist === 'unit' ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                    >За шт.</button>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-bold text-slate-500 uppercase tracking-wider">Услуги</label>
                  <button
                    onClick={() => setServiceEditData(prev => prev ? { ...prev, servicesList: [...prev.servicesList, { name: 'Новая услуга', unitCost: 0, quantity: 1 }] } : prev)}
                    className="text-xs font-bold text-indigo-600 hover:text-indigo-700 px-2 py-1 rounded-lg hover:bg-indigo-50 transition-colors"
                  >+ Добавить</button>
                </div>
                {serviceEditData.servicesList.length === 0 && (
                  <p className="text-sm text-slate-400 italic">Нет услуг. Нажмите «+ Добавить»</p>
                )}
                {serviceEditData.servicesList.map((svc, idx) => (
                  <div key={idx} className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={svc.name}
                        onChange={(e) => setServiceEditData(prev => {
                          if (!prev) return prev;
                          const list = [...prev.servicesList];
                          list[idx] = { ...list[idx], name: e.target.value };
                          return { ...prev, servicesList: list };
                        })}
                        className="flex-1 px-3 py-2 rounded-xl border border-slate-200 bg-white outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-medium"
                        placeholder="Название услуги"
                      />
                      <button
                        onClick={() => setServiceEditData(prev => {
                          if (!prev) return prev;
                          return { ...prev, servicesList: prev.servicesList.filter((_, i) => i !== idx) };
                        })}
                        className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-100 rounded-lg transition-colors flex-shrink-0"
                      >
                        <X size={15} />
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number" min="1" step="1"
                        value={svc.quantity}
                        onChange={(e) => setServiceEditData(prev => {
                          if (!prev) return prev;
                          const list = [...prev.servicesList];
                          list[idx] = { ...list[idx], quantity: Math.max(1, parseInt(e.target.value) || 1) };
                          return { ...prev, servicesList: list };
                        })}
                        className="w-20 px-3 py-2 rounded-xl border border-slate-200 bg-white outline-none focus:ring-2 focus:ring-indigo-500 text-sm text-center"
                        placeholder="Кол-во"
                        title="Количество"
                      />
                      <span className="text-slate-400 text-sm font-medium">×</span>
                      <input
                        type="number" min="0" step="0.01"
                        value={svc.unitCost}
                        onChange={(e) => setServiceEditData(prev => {
                          if (!prev) return prev;
                          const list = [...prev.servicesList];
                          list[idx] = { ...list[idx], unitCost: parseFloat(e.target.value) || 0 };
                          return { ...prev, servicesList: list };
                        })}
                        className="w-28 px-3 py-2 rounded-xl border border-slate-200 bg-white outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                        placeholder="Цена ₽"
                        title="Единичная расценка"
                      />
                      <span className="text-slate-400 text-sm font-medium">=</span>
                      <span className="text-sm font-bold text-slate-800 whitespace-nowrap">
                        {formatCurrency(svc.quantity * svc.unitCost)} ₽
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-8 bg-slate-50 border-t border-slate-100 flex gap-4">
              <button
                onClick={() => { setEditingServicesGroup(null); setServiceEditData(null); }}
                className="flex-1 py-4 rounded-2xl font-bold text-slate-500 hover:bg-white transition-all border border-transparent hover:border-slate-200"
              >Отмена</button>
              <button
                onClick={handleSaveServices}
                disabled={isSavingServices}
                className="flex-1 bg-slate-900 text-white py-4 rounded-2xl font-bold hover:bg-slate-800 disabled:opacity-50 transition-all shadow-xl flex items-center justify-center gap-2"
              >
                {isSavingServices ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
                Сохранить
              </button>
            </div>
          </div>
        </div>
      , document.body)}
    </div>
  );
});
