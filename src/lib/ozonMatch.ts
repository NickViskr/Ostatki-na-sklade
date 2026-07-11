import { ExternalShipment, SKUItem, Transaction } from '../types';
import { parseAppDate } from './utils';

const normalizeDestination = (raw?: string): string => {
  const s = String(raw || '');
  const bracketIdx = s.indexOf('[');
  return (bracketIdx === -1 ? s : s.slice(0, bracketIdx)).trim();
};

export interface MatchCandidate {
  date: string;
  deliveryDate?: string;
  destination: string;
  dateDiffDays: number | null;
  compositionExact: boolean;
  items: Array<{ article: string; quantity: number }>;
  txIds: string[];
}

export interface MatchResult {
  verdict: 'duplicate' | 'suspect' | 'none';
  candidates: MatchCandidate[];
}

/**
 * Сверка Ozon-заявки с ручными отгрузками по «отпечатку»
 */
export function matchOzonGroup(
  newPostings: ExternalShipment[],
  cabinet: string,
  shipmentDate: string,
  skus: SKUItem[],
  transactions: Transaction[],
  externalShipments: ExternalShipment[]
): MatchResult {
  if (newPostings.length === 0) {
    return { verdict: 'none', candidates: [] };
  }

  // 1. Состав заявки. Распарси itemsJSON всех newPostings
  const orderMap = new Map<string, number>();
  const rawItems: any[] = [];

  for (const posting of newPostings) {
    try {
      if (posting.itemsJSON) {
        const list = JSON.parse(posting.itemsJSON);
        if (Array.isArray(list)) {
          rawItems.push(...list);
        }
      }
    } catch {
      // Игнорируем ошибки парсинга отдельной поставки
    }
  }

  for (const item of rawItems) {
    const barcode = String(item.barcode || '').trim();
    const offerId = String(item.offerId || item.offer_id || '').trim();
    const quantity = Number(item.quantity || item.qty) || 0;

    let matchedSku = skus.find(skuItem => {
      if (barcode && skuItem.ozonBarcode) {
        return skuItem.ozonBarcode.trim() === barcode;
      }
      return false;
    });

    if (!matchedSku && offerId) {
      matchedSku = skus.find(skuItem => skuItem.sku.toLowerCase() === offerId.toLowerCase());
    }

    const article = matchedSku ? matchedSku.sku : (offerId || barcode || 'НЕИЗВЕСТНО');
    orderMap.set(article, (orderMap.get(article) || 0) + quantity);
  }

  if (orderMap.size === 0) {
    return { verdict: 'none', candidates: [] };
  }

  // 2. Уже привязанные транзакции
  const linkedTxIds = new Set<string>();
  externalShipments.forEach(s => {
    if (s.status === 'processed' && s.transGroupInfo) {
      try {
        const parsed = JSON.parse(s.transGroupInfo);
        if (Array.isArray(parsed)) {
          parsed.forEach((id: any) => {
            linkedTxIds.add(String(id));
          });
        }
      } catch {
        // ignore
      }
    }
  });

  // 3. Кандидаты — ручные группы отгрузок
  const manualGroupsMap = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (t.type === 'Расход' && !t.isComponent) {
      if (normalizeDestination(t.destination).startsWith('Ozon')) {
        const key = `${t.date}|${t.destination}|${t.deliveryDate || ''}`;
        if (!manualGroupsMap.has(key)) {
          manualGroupsMap.set(key, []);
        }
        manualGroupsMap.get(key)!.push(t);
      }
    }
  }

  const candidateGroups: { key: string; transactions: Transaction[] }[] = [];
  for (const [key, txs] of manualGroupsMap.entries()) {
    const isAlreadyLinked = txs.some(t => linkedTxIds.has(String(t.id)));
    if (!isAlreadyLinked) {
      candidateGroups.push({ key, transactions: txs });
    }
  }

  // 4. Сравнение каждой группы-кандидата с заявкой
  const matchedCandidates: MatchCandidate[] = [];
  let duplicateCount = 0;

  const orderArticles = Array.from(orderMap.keys()).sort();
  const parsedOrderDate = parseAppDate(shipmentDate);
  const noDateMode = !parsedOrderDate && newPostings.some(
    p => String(p.ozonStatus || '').toUpperCase() === 'READY_TO_SUPPLY'
  );

  for (const { transactions: txs } of candidateGroups) {
    const firstTx = txs[0];
    const groupCreated = parseAppDate(firstTx.date);
    const freshEnough = groupCreated !== null &&
      (Date.now() - groupCreated.getTime()) <= 7 * 24 * 60 * 60 * 1000;
    
    // Состав группы: суммируем количества по артикулам главных строк
    const groupMap = new Map<string, number>();
    for (const t of txs) {
      groupMap.set(t.article, (groupMap.get(t.article) || 0) + Math.abs(t.quantity));
    }

    const groupArticles = Array.from(groupMap.keys()).sort();

    // Сверка наборов артикулов
    const hasSameArticles = orderArticles.length === groupArticles.length &&
      orderArticles.every((art, i) => art === groupArticles[i]);

    let compositionExact = false;

    if (hasSameArticles) {
      const allQuantitiesEqual = orderArticles.every(art => orderMap.get(art) === groupMap.get(art));
      if (allQuantitiesEqual) {
        compositionExact = true;
      }
    }

    // Дата группы = deliveryDate первой строки, если пусто — date
    const groupDateStr = firstTx.deliveryDate || firstTx.date;
    const parsedGroupDate = parseAppDate(groupDateStr);

    let dateDiffDays: number | null = null;
    if (parsedOrderDate && parsedGroupDate) {
      const dO = new Date(parsedOrderDate);
      dO.setHours(0, 0, 0, 0);
      const dG = new Date(parsedGroupDate);
      dG.setHours(0, 0, 0, 0);
      const diffTime = Math.abs(dO.getTime() - dG.getTime());
      dateDiffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
    }

    // cabinetOk
    const cabTrimmed = String(cabinet || '').trim();
    const destTrimmed = normalizeDestination(firstTx.destination);
    const cabinetOk = !cabTrimmed ||
                      (destTrimmed === 'Ozon') ||
                      (destTrimmed === `Ozon (${cabTrimmed})`);

    // Сверка критериев:
    // - duplicate: точное совпадение состава, кабинета, при близости дат до 5 дней (или без даты при READY_TO_SUPPLY, если ручная отгрузка создана за последние 7 дней)
    // - suspect: точное совпадение состава в пределах 7 дней при наличии дат
    const isDupCandidate = compositionExact && cabinetOk &&
      ((noDateMode && freshEnough) || (dateDiffDays !== null && dateDiffDays <= 5));
    const isSusCandidate = !isDupCandidate && compositionExact && cabinetOk &&
      dateDiffDays !== null && dateDiffDays <= 7;

    if (isDupCandidate || isSusCandidate) {
      if (isDupCandidate) {
        duplicateCount++;
      }

      const items = Array.from(groupMap.entries()).map(([article, quantity]) => ({
        article,
        quantity
      }));

      matchedCandidates.push({
        date: firstTx.date,
        deliveryDate: firstTx.deliveryDate,
        destination: firstTx.destination,
        dateDiffDays,
        compositionExact,
        items,
        txIds: txs.map(t => t.id)
      });
    }
  }

  // Сортировка по dateDiffDays по возрастанию
  matchedCandidates.sort((a, b) => {
    const da = a.dateDiffDays ?? Infinity;
    const db = b.dateDiffDays ?? Infinity;
    return da - db;
  });

  // 5. Вердикт заявки
  let verdict: 'duplicate' | 'suspect' | 'none' = 'none';
  if (duplicateCount === 1) {
    verdict = 'duplicate';
  } else if (duplicateCount > 1 || matchedCandidates.length > 0) {
    verdict = 'suspect';
  }

  return {
    verdict,
    candidates: matchedCandidates
  };
}
