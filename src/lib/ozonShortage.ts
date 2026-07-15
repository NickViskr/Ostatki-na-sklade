import { ExternalShipment, SKUItem, Transaction } from '../types';
import { roundToTwo } from './utils';

export interface ShortageRecalcItem {
  offerId: string;
  article: string;
  declared: number;
  accepted: number;
  baseUnitCost: number;
  adjustedUnitCost: number;
  redistributedCost: number;
}

export interface ShortageRecalcResult {
  status: 'none' | 'surplus' | 'error' | 'ok' | 'peresort';
  items: ShortageRecalcItem[];
  historyNotes: { article: string; note: string }[];
  errorMsg?: string;
}

export function computeShortageRecalc(
  shipment: ExternalShipment,
  allShipments: ExternalShipment[],
  transactions: Transaction[],
  skus: SKUItem[]
): ShortageRecalcResult {
  // Шаг 1. Распарси itemsJSON
  let items: any[] = [];
  try {
    items = JSON.parse(shipment.itemsJSON || '[]');
  } catch (e) {
    return {
      status: 'error',
      items: [],
      historyNotes: [],
      errorMsg: 'Ошибка разбора заявленных позиций поставки'
    };
  }
  
  if (!Array.isArray(items) || items.length === 0) {
    return {
      status: 'error',
      items: [],
      historyNotes: [],
      errorMsg: 'Поставка не содержит заявленных позиций'
    };
  }

  // Распарси acceptedJSON
  if (!shipment.acceptedJSON || !shipment.acceptedJSON.trim()) {
    return { status: 'none', items: [], historyNotes: [] };
  }

  let acceptedList: any[] = [];
  try {
    acceptedList = JSON.parse(shipment.acceptedJSON);
  } catch (e) {
    return {
      status: 'error',
      items: [],
      historyNotes: [],
      errorMsg: 'Ошибка разбора принятых позиций поставки'
    };
  }

  if (!Array.isArray(acceptedList) || acceptedList.length === 0) {
    return { status: 'none', items: [], historyNotes: [] };
  }

  // Проверка на пересорт: есть ли в acceptedList записи с offerId, отсутствующим среди заявленных items (без учёта регистра)
  const declaredOfferIds = new Set(
    items.map((it: any) => String(it.offerId || it.offer_id || '').trim().toLowerCase())
  );

  const hasPeresort = acceptedList.some((it: any) => {
    if (it && typeof it === 'object' && 'offerId' in it) {
      const offerId = String(it.offerId).trim().toLowerCase();
      return !declaredOfferIds.has(offerId);
    }
    return false;
  });

  if (hasPeresort) {
    return { status: 'peresort', items: [], historyNotes: [] };
  }

  const acceptedMap = new Map<string, number>();
  acceptedList.forEach((it: any) => {
    if (it && typeof it === 'object' && 'offerId' in it && 'accepted' in it) {
      acceptedMap.set(String(it.offerId).toLowerCase(), Number(it.accepted));
    }
  });

  // Шаг 2. Проверка на излишек (accepted > declared)
  let hasSurplus = false;
  let hasShortage = false;

  for (const item of items) {
    const offerId = String(item.offerId || '').trim();
    const declared = Number(item.quantity) || 0;
    const lowerOfferId = offerId.toLowerCase();
    const accepted = acceptedMap.has(lowerOfferId) ? acceptedMap.get(lowerOfferId)! : declared;

    if (accepted > declared) {
      hasSurplus = true;
    }
    if (accepted < declared) {
      hasShortage = true;
    }
  }

  if (hasSurplus) {
    return { status: 'surplus', items: [], historyNotes: [] };
  }

  // Шаг 3. Проверка на недостачу
  if (!hasShortage) {
    return { status: 'none', items: [], historyNotes: [] };
  }

  // Шаг 4. Сопоставление со SKU
  const unmatchedOfferIds: string[] = [];
  const matchedSkusMap = new Map<string, SKUItem>(); // offerId -> SKUItem

  for (const item of items) {
    const offerId = String(item.offerId || '').trim();
    const barcode = String(item.barcode || '').trim();
    
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
      matchedSkusMap.set(offerId.toLowerCase(), matchedSku);
    } else {
      unmatchedOfferIds.push(offerId || barcode || 'НЕИЗВЕСТНО');
    }
  }

  if (unmatchedOfferIds.length > 0) {
    return {
      status: 'error',
      items: [],
      historyNotes: [],
      errorMsg: `Не удалось сопоставить SKU для позиций: ${unmatchedOfferIds.join(', ')}`
    };
  }

  // Шаг 5. Определение базовой себестоимости
  const shipOrderId = String(shipment.orderId || '').trim();
  if (!shipOrderId) {
    return {
      status: 'error',
      items: [],
      historyNotes: [],
      errorMsg: 'Невозможно рассчитать перераспределение: у поставки отсутствует OrderID'
    };
  }

  const transactionIds = new Set<string>();
  allShipments.forEach(s => {
    const sOrderId = String(s.orderId || '').trim();
    if (sOrderId && sOrderId.toLowerCase() === shipOrderId.toLowerCase() && s.status === 'processed' && s.transGroupInfo) {
      try {
        const parsedIds = JSON.parse(s.transGroupInfo);
        if (Array.isArray(parsedIds)) {
          parsedIds.forEach(id => transactionIds.add(String(id)));
        }
      } catch (e) {
        // Игнорируем
      }
    }
  });

  const mainTransactions = transactions.filter(t => 
    t.isComponent !== true && 
    transactionIds.has(String(t.id)) && 
    t.type === 'Расход'
  );

  const transGroups = new Map<string, { totalCost: number; totalQty: number }>();
  mainTransactions.forEach(t => {
    const art = String(t.article).trim().toLowerCase();
    const cost = Number(t.total ?? t.writeOffCost ?? 0);
    const qty = Number(t.quantity) || 0;
    
    if (!transGroups.has(art)) {
      transGroups.set(art, { totalCost: 0, totalQty: 0 });
    }
    const g = transGroups.get(art)!;
    g.totalCost += cost;
    g.totalQty += qty;
  });

  const baseUnitCosts = new Map<string, number>(); // sku.toLowerCase() -> baseUnitCost
  const missingArticles: string[] = [];

  for (const item of items) {
    const offerId = String(item.offerId || '').trim();
    const skuItem = matchedSkusMap.get(offerId.toLowerCase())!;
    const skuLower = skuItem.sku.toLowerCase();
    
    if (baseUnitCosts.has(skuLower)) {
      continue;
    }

    const g = transGroups.get(skuLower);
    if (!g || g.totalQty === 0) {
      missingArticles.push(skuItem.sku);
    } else {
      const baseCost = g.totalCost / g.totalQty;
      baseUnitCosts.set(skuLower, baseCost);
    }
  }

  if (missingArticles.length > 0) {
    return {
      status: 'error',
      items: [],
      historyNotes: [],
      errorMsg: `Не найдены транзакции расхода для артикулов: ${missingArticles.join(', ')}. Убедитесь, что заявка оформлена (processed), и обновите страницу.`
    };
  }

  // Шаг 6. Расчет перераспределения
  interface CalcPosition {
    offerId: string;
    barcode: string;
    article: string;
    declared: number;
    accepted: number;
    baseUnitCost: number;
    pool: number;
    adjustedUnitCost: number;
    redistributedCost: number;
  }

  const calcPositions: CalcPosition[] = [];
  let totalDeclaredCost = 0;
  let hasAcceptedAtLeastOne = false;

  for (const item of items) {
    const offerId = String(item.offerId || '').trim();
    const barcode = String(item.barcode || '').trim();
    const skuItem = matchedSkusMap.get(offerId.toLowerCase())!;
    const skuLower = skuItem.sku.toLowerCase();
    const baseUnitCost = baseUnitCosts.get(skuLower)!;
    
    const declared = Number(item.quantity) || 0;
    const accepted = acceptedMap.has(offerId.toLowerCase()) ? acceptedMap.get(offerId.toLowerCase())! : declared;
    
    const pool = declared * baseUnitCost;
    totalDeclaredCost += pool;

    if (accepted > 0) {
      hasAcceptedAtLeastOne = true;
    }

    calcPositions.push({
      offerId,
      barcode,
      article: skuItem.sku,
      declared,
      accepted,
      baseUnitCost,
      pool,
      adjustedUnitCost: 0,
      redistributedCost: 0
    });
  }

  if (!hasAcceptedAtLeastOne) {
    return {
      status: 'error',
      items: [],
      historyNotes: [],
      errorMsg: 'Принято 0 по всем позициям — перераспределять не на что, похоже на полную потерю поставки, обработайте вручную'
    };
  }

  let orphanPool = 0;
  let acceptedPoolSum = 0;

  calcPositions.forEach(p => {
    if (p.accepted === 0) {
      orphanPool += p.pool;
    } else {
      acceptedPoolSum += p.pool;
    }
  });

  calcPositions.forEach(p => {
    if (p.accepted > 0) {
      let adjUnit = p.pool / p.accepted;
      
      if (orphanPool > 0 && acceptedPoolSum > 0) {
        const share = p.pool / acceptedPoolSum;
        adjUnit += (orphanPool * share) / p.accepted;
      }
      
      p.adjustedUnitCost = adjUnit;
      p.redistributedCost = Math.max(0, p.accepted * adjUnit - p.accepted * p.baseUnitCost);
    } else {
      p.adjustedUnitCost = 0;
      p.redistributedCost = 0;
    }
  });

  let totalAdjustedCost = 0;
  calcPositions.forEach(p => {
    totalAdjustedCost += p.accepted * p.adjustedUnitCost;
  });

  if (Math.abs(totalAdjustedCost - totalDeclaredCost) > 0.01) {
    return {
      status: 'error',
      items: [],
      historyNotes: [],
      errorMsg: `Внутренняя ошибка расчёта: суммы не сходятся (заявлено: ${totalDeclaredCost.toFixed(4)}, распределено: ${totalAdjustedCost.toFixed(4)})`
    };
  }

  // Шаг 7. Округление и финальные элементы
  const finalItems: ShortageRecalcItem[] = calcPositions.map(p => ({
    offerId: p.offerId,
    article: p.article,
    declared: p.declared,
    accepted: p.accepted,
    baseUnitCost: roundToTwo(p.baseUnitCost),
    adjustedUnitCost: roundToTwo(p.adjustedUnitCost),
    redistributedCost: roundToTwo(p.redistributedCost)
  }));

  // Шаг 8. Формирование historyNotes
  const historyNotes: { article: string; note: string }[] = [];
  const orderRef = shipment.orderNumber || shipment.orderId || '-';

  calcPositions.forEach(p => {
    if (p.accepted < p.declared) {
      const diffCost = (p.declared - p.accepted) * p.baseUnitCost;
      historyNotes.push({
        article: p.article,
        note: `Недостача приёмки Ozon: заявка № ${orderRef}, поставка ${shipment.postingId}: отгружено ${p.declared} → принято ${p.accepted}, ${roundToTwo(diffCost)} ₽ перераспределено на принятые товары поставки`
      });
    }
  });

  return {
    status: 'ok',
    items: finalItems,
    historyNotes
  };
}

export function parseRecalcJSON(recalcJSON?: string): ShortageRecalcItem[] | null {
  if (!recalcJSON || !recalcJSON.trim()) return null;
  try {
    const parsed = JSON.parse(recalcJSON);
    if (Array.isArray(parsed)) {
      return parsed as ShortageRecalcItem[];
    }
  } catch (e) {
    // Игнорируем ошибку парсинга
  }
  return null;
}
