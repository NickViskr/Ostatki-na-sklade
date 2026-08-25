import React, { useCallback } from 'react';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { useUIStore } from '../store/useUIStore';
import { toast } from 'sonner';
import { ExternalShipment, SKUItem, Transaction } from '../types';
import { MatchResult, matchOzonGroup } from './ozonMatch';
import { isStockDeparted } from './ozonStatus';
import { BatchWriteOffGroup, BatchWriteOffItem, mergeBatchItems } from './ozonBatchWriteOff';

export interface OzonGroup {
  id: string;
  label: string;
  items: ExternalShipment[];
  postingCount: number;
  shipmentDate: string;
  cabinet: string;
  matchResult: MatchResult;
  needsExpense: boolean;
  /** Пункт 31. Заявку создал сам Ozon: списание со склада по ней не проводится. */
  isVirtual: boolean;
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
    
    // Пункт 31. Признак виртуальности берётся по любой поставке заявки: Ozon помечает
    // флагом всю заявку целиком, поэтому смешанных групп не бывает.
    const isVirtual = items.some(p => p.isVirtual === true);
    // У виртуальной заявки списания не возникает никогда, даже после отгрузки на Ozon
    const needsExpense = !isVirtual && items.some(p => p.status === 'new' && isStockDeparted(p.ozonStatus));

    return {
      id: key,
      label,
      items,
      postingCount: items.length,
      shipmentDate,
      cabinet,
      matchResult,
      needsExpense,
      isVirtual,
    };
  });
}

/**
 * Item 45. Ozon names an item by barcode and offerId; this turns the items of one order
 * into rows of our own accounting, with the cost we would write them off at.
 * Equal articles are summed — one article can sit in several postings of the same order.
 */
const mapPostingItems = (
  postings: ExternalShipment[],
  skus: SKUItem[]
): { items: BatchWriteOffItem[]; error: string | null } => {
  const rawItems: any[] = [];
  for (const posting of postings) {
    try {
      const list = JSON.parse(posting.itemsJSON);
      if (Array.isArray(list)) rawItems.push(...list);
    } catch (e) {
      return { items: [], error: `Ошибка разбора позиций поставки №${posting.postingId}` };
    }
  }

  const mapped: BatchWriteOffItem[] = rawItems.map((item: any) => {
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
    }
    return {
      article: offerId || barcode || 'НЕИЗВЕСТНО',
      quantity,
      price: 0,
      status: 'unknown' as const,
      errorMsg: 'SKU не найден по штрихкоду или артикулу Ozon'
    };
  });

  return {
    items: mergeBatchItems([{ groupId: '', label: '', postingIds: [], items: mapped }]),
    error: null
  };
};

/**
 * Item 56. Writes off one or several Ozon orders in a single pass.
 *
 * The contractor packs and hauls several orders as one physical supply, so the additional
 * costs are paid once and must be spread over the combined article list. The screen therefore
 * shows the orders merged, while the commit stays one expense per order — see
 * src/lib/ozonBatchWriteOff.ts for why the two do not contradict each other.
 *
 * A single order goes through exactly the same path with a batch of one, so there is no
 * second code path to keep in step.
 */
export function useProcessOzonGroups(): (groups: OzonGroup[]) => void {
  const skus = useWarehouseStore((state) => state.skus);
  const stock = useWarehouseStore((state) => state.stock);
  const setPendingOzonPostingIds = useWarehouseStore((state) => state.setPendingOzonPostingIds);
  const setPendingOzonBatch = useWarehouseStore((state) => state.setPendingOzonBatch);
  const setOpType = useUIStore((state) => state.setOpType);
  const setUploadDestination = useUIStore((state) => state.setUploadDestination);
  const askConfirmation = useUIStore((state) => state.askConfirmation);

  return useCallback((groups: OzonGroup[]) => {
    if (!groups || groups.length === 0) {
      toast.error('Не выбрано ни одной заявки');
      return;
    }
    // Пункт 31. Предохранитель: по виртуальной заявке списание не проводится никогда
    if (groups.some(g => g.isVirtual)) {
      toast.error('Заявку создал сам Ozon — списание со склада по ней не проводится');
      return;
    }
    // Магазин входит в назначение расхода, поэтому в одном списании он должен быть один
    const cabinets = Array.from(new Set(groups.map(g => String(g.cabinet || '').trim())));
    if (cabinets.length > 1) {
      toast.error('В одном списании могут участвовать только заявки одного магазина');
      return;
    }

    const batch: BatchWriteOffGroup[] = [];
    for (const group of groups) {
      const newPostings: ExternalShipment[] = (group.items as ExternalShipment[]).filter(
        p => p.status === 'new' && isStockDeparted(p.ozonStatus)
      );
      if (newPostings.length === 0) {
        toast.error(`Заявка № ${group.label} ещё не отгружена на Ozon — оформление станет доступно после приёмки на точке отгрузки`);
        return;
      }
      const { items, error } = mapPostingItems(newPostings, skus);
      if (error) {
        toast.error(error);
        return;
      }
      if (items.length === 0) {
        toast.error(`Поставки заявки № ${group.label} не содержат позиций`);
        return;
      }
      batch.push({
        groupId: group.id,
        label: group.label,
        postingIds: newPostings.map(p => p.postingId),
        items
      });
    }

    const mergedItems = mergeBatchItems(batch);
    const postingCount = batch.reduce((sum, g) => sum + g.postingIds.length, 0);

    const proceedToModal = () => {
      setPendingOzonBatch(batch);
      setPendingOzonPostingIds(batch.reduce<string[]>((all, g) => all.concat(g.postingIds), []));

      setOpType('Расход');
      // Заявка знает свой магазин — подставляем в назначение автоматически
      const cabName = cabinets[0] || '';
      setUploadDestination(cabName ? `Ozon (${cabName})` : 'Ozon');
      useUIStore.getState().setParsedItems(mergedItems as any);
      useUIStore.getState().setShowConfirmModal(true);
      toast.success(
        batch.length === 1
          ? `Заявка № ${batch[0].label}: подготовлено поставок — ${postingCount}`
          : `Выбрано заявок: ${batch.length}, поставок — ${postingCount}`
      );
    };

    // Проверка наличия сразу при оформлении (комплекты — через доступность по компонентам).
    // Считается по ОБЩЕМУ списку: списание уедет одной партией, и товара должно хватить на всё сразу.
    const requiredByArticle: Record<string, number> = {};
    for (const it of mergedItems) {
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
  }, [skus, stock, setPendingOzonPostingIds, setPendingOzonBatch, setOpType, setUploadDestination, askConfirmation]);
}

/** Одна заявка — та же дорога, что и партия, только из одного элемента. */
export function useProcessOzonGroup(): (group: OzonGroup) => void {
  const processGroups = useProcessOzonGroups();
  return useCallback((group: OzonGroup) => processGroups([group]), [processGroups]);
}
