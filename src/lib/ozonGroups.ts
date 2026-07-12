import React, { useCallback } from 'react';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { useUIStore } from '../store/useUIStore';
import { toast } from 'sonner';
import { ExternalShipment, SKUItem, Transaction } from '../types';
import { MatchResult, matchOzonGroup } from './ozonMatch';
import { isStockDeparted } from './ozonStatus';

export interface OzonGroup {
  id: string;
  label: string;
  items: ExternalShipment[];
  postingCount: number;
  shipmentDate: string;
  cabinet: string;
  matchResult: MatchResult;
  needsExpense: boolean;
}

export function buildOzonGroups(
  externalShipments: ExternalShipment[],
  skus: SKUItem[],
  transactions: Transaction[]
): OzonGroup[] {
  const groupsMap = new Map<string, ExternalShipment[]>();
  
  externalShipments.forEach((s) => {
    let key = '';
    if (s.orderId && s.orderId.trim()) {
      key = `orderId_${s.orderId.trim()}`;
    } else if (s.orderNumber && s.orderNumber.trim()) {
      key = `orderNumber_${s.orderNumber.trim()}`;
    } else {
      key = `postingId_${s.postingId}`;
    }
    
    if (!groupsMap.has(key)) {
      groupsMap.set(key, []);
    }
    groupsMap.get(key)!.push(s);
  });

  return Array.from(groupsMap.entries()).map(([key, items]) => {
    const firstItem = items[0];
    const orderNumber = firstItem.orderNumber || '';
    const orderId = firstItem.orderId || '';
    const label = orderNumber || orderId || firstItem.postingId;
    const cabinet = (firstItem.cabinet || '').trim();
    const shipmentDate = firstItem.shipmentDate || '-';

    const newPostings = items.filter(p => p.status === 'new');
    const matchResult = newPostings.length > 0
      ? matchOzonGroup(newPostings, cabinet, shipmentDate, skus, transactions, externalShipments)
      : { verdict: 'none' as const, candidates: [] };
    
    const needsExpense = items.some(p => p.status === 'new' && isStockDeparted(p.ozonStatus));

    return {
      id: key,
      label,
      items,
      postingCount: items.length,
      shipmentDate,
      cabinet,
      matchResult,
      needsExpense,
    };
  });
}

export function useProcessOzonGroup(): (group: OzonGroup) => void {
  const skus = useWarehouseStore((state) => state.skus);
  const stock = useWarehouseStore((state) => state.stock);
  const setPendingOzonPostingIds = useWarehouseStore((state) => state.setPendingOzonPostingIds);
  const setOpType = useUIStore((state) => state.setOpType);
  const setUploadDestination = useUIStore((state) => state.setUploadDestination);
  const askConfirmation = useUIStore((state) => state.askConfirmation);

  const handleProcessOzonGroup = useCallback((group: OzonGroup) => {
    const newPostings: ExternalShipment[] = (group.items as ExternalShipment[]).filter(
      p => p.status === 'new' && isStockDeparted(p.ozonStatus)
    );
    if (newPostings.length === 0) {
      toast.error('Заявка ещё не отгружена на Ozon — оформление станет доступно после приёмки на точке отгрузки');
      return;
    }

    const rawItems: any[] = [];
    for (const posting of newPostings) {
      try {
        const list = JSON.parse(posting.itemsJSON);
        if (Array.isArray(list)) rawItems.push(...list);
      } catch (e) {
        toast.error(`Ошибка разбора позиций поставки №${posting.postingId}`);
        return;
      }
    }

    if (rawItems.length === 0) {
      toast.error('Поставки заявки не содержат позиций');
      return;
    }

    const mapped = rawItems.map((item: any) => {
      const barcode = String(item.barcode || '').trim();
      const offerId = String(item.offerId || '').trim();
      const quantity = Number(item.quantity) || 0;

      let matchedSku = skus.find(skuItem => {
        if (barcode && skuItem.ozonBarcode) {
          return skuItem.ozonBarcode.trim() === barcode;
        }
        return false;
      });

      if (!matchedSku && offerId) {
        matchedSku = skus.find(skuItem => skuItem.sku.toLowerCase() === offerId.toLowerCase());
      }

      if (matchedSku) {
        // Себестоимость через хелпер стора: виртуальный комплект = сумма компонентов,
        // обычный товар = средняя со склада; справочная цена SKU — запасной вариант
        const effectiveCost = useWarehouseStore.getState().getEffectiveAvgCost(matchedSku.sku);
        const unitCost = effectiveCost > 0 ? effectiveCost : (matchedSku.price || 0);
        return {
          article: matchedSku.sku,
          quantity,
          price: unitCost,
          status: 'ok' as const
        };
      } else {
        return {
          article: offerId || barcode || 'НЕИЗВЕСТНО',
          quantity,
          price: 0,
          status: 'unknown' as const,
          errorMsg: 'SKU не найден по штрихкоду или артикулу Ozon'
        };
      }
    });

    // Одинаковые артикулы из разных поставок заявки суммируются в одну строку
    const aggregated = new Map<string, any>();
    for (const item of mapped) {
      const key = `${item.article}|${item.status}`;
      const existing = aggregated.get(key);
      if (existing) {
        existing.quantity += item.quantity;
      } else {
        aggregated.set(key, { ...item });
      }
    }
    const mappedItems = Array.from(aggregated.values());

    const proceedToModal = () => {
      setPendingOzonPostingIds(newPostings.map(p => p.postingId));

      setOpType('Расход');
      // Заявка знает свой магазин — подставляем в назначение автоматически
      const cabName = String(group.cabinet || '').trim();
      setUploadDestination(cabName ? `Ozon (${cabName})` : 'Ozon');
      useUIStore.getState().setParsedItems(mappedItems);
      useUIStore.getState().setShowConfirmModal(true);
      toast.success(`Заявка № ${group.label}: подготовлено поставок — ${newPostings.length}`);
    };

    // Проверка наличия сразу при оформлении (комплекты — через доступность по компонентам)
    const requiredByArticle: Record<string, number> = {};
    for (const it of mappedItems) {
      if (it.status === 'ok') {
        requiredByArticle[it.article] = (requiredByArticle[it.article] || 0) + it.quantity;
      }
    }
    const shortages: Array<{ article: string; req: number; avail: number }> = [];
    for (const [article, reqQty] of Object.entries(requiredByArticle)) {
      const available = useWarehouseStore.getState().getEffectiveAvailability(article);
      if (reqQty > available) {
        shortages.push({ article, req: reqQty, avail: available });
      }
    }

    if (shortages.length > 0) {
      askConfirmation(
        "Товара не хватает на складе",
        React.createElement(
          React.Fragment,
          null,
          React.createElement('span', { className: 'block' }, 'Возможно, заявка уже оформлена вручную — тогда нажмите «Игнорировать».'),
          React.createElement('span', { className: 'block mt-3 font-bold text-slate-700' }, 'Не хватает:'),
          shortages.map((s) =>
            React.createElement(
              'span',
              { key: s.article, className: 'block mt-1' },
              React.createElement('b', { className: 'text-slate-900' }, s.article),
              ' — нужно ',
              React.createElement('b', { className: 'text-red-600' }, s.req + ' шт.'),
              ', доступно ',
              React.createElement('b', { className: 'text-slate-900' }, s.avail + ' шт.')
            )
          ),
          React.createElement('span', { className: 'block mt-3' }, 'Открыть оформление всё равно?')
        ),
        () => proceedToModal()
      );
      return;
    }

    proceedToModal();
  }, [skus, stock, setPendingOzonPostingIds, setOpType, setUploadDestination, askConfirmation]);

  return handleProcessOzonGroup;
}
