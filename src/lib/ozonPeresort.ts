import { ExternalShipment, SKUItem } from '../types';

export interface PeresortPosition {
  offerId: string;
  article: string;
  qty: number;
}

export interface PeresortDetection {
  isCandidate: boolean;
  missing: PeresortPosition[];
  extras: PeresortPosition[];
}

export function detectPeresort(shipment: ExternalShipment, skus: SKUItem[]): PeresortDetection {
  const fallbackResult: PeresortDetection = { isCandidate: false, missing: [], extras: [] };

  if (!shipment.itemsJSON || !shipment.acceptedJSON) {
    return fallbackResult;
  }

  let items: any[] = [];
  let acceptedList: any[] = [];

  try {
    items = JSON.parse(shipment.itemsJSON);
    acceptedList = JSON.parse(shipment.acceptedJSON);
  } catch (e) {
    return fallbackResult;
  }

  if (!Array.isArray(items) || !Array.isArray(acceptedList)) {
    return fallbackResult;
  }

  // Построй Map принятых количеств: ключ = offerId.trim().toLowerCase(), значение = Number(accepted).
  const acceptedMap = new Map<string, number>();
  acceptedList.forEach((it: any) => {
    if (it && typeof it === 'object' && 'offerId' in it) {
      const offerId = String(it.offerId).trim().toLowerCase();
      const accepted = typeof it.accepted === 'number' ? it.accepted : Number(it.accepted) || 0;
      acceptedMap.set(offerId, accepted);
    }
  });

  // Построй набор заявленных offerId в нижнем регистре
  const declaredOfferIdsLower = new Set<string>();
  items.forEach((item: any) => {
    const offerId = String(item.offerId || item.offer_id || '').trim().toLowerCase();
    if (offerId) {
      declaredOfferIdsLower.add(offerId);
    }
  });

  const missing: PeresortPosition[] = [];
  const extras: PeresortPosition[] = [];

  // c) missing: пройди по заявленным позициям
  items.forEach((item: any) => {
    const offerId = String(item.offerId || item.offer_id || '').trim();
    const barcode = String(item.barcode || '').trim();
    const declared = Number(item.quantity || item.qty) || 0;

    const offerIdLower = offerId.toLowerCase();
    const accepted = acceptedMap.has(offerIdLower) ? acceptedMap.get(offerIdLower)! : declared;

    if (accepted < declared) {
      // Найти SKU
      let matchedSku = skus.find(skuItem => {
        if (barcode && skuItem.ozonBarcode) {
          return skuItem.ozonBarcode.trim() === barcode;
        }
        return false;
      });

      if (!matchedSku && offerId) {
        matchedSku = skus.find(skuItem => skuItem.sku.toLowerCase() === offerIdLower);
      }

      const article = matchedSku ? matchedSku.sku : offerId;
      missing.push({
        offerId,
        article,
        qty: declared - accepted
      });
    }
  });

  // d) extras: пройди по записям acceptedJSON; если offerId записи (без учёта регистра) отсутствует среди заявленных offerId
  acceptedList.forEach((it: any) => {
    if (it && typeof it === 'object' && 'offerId' in it) {
      const offerId = String(it.offerId).trim();
      const accepted = typeof it.accepted === 'number' ? it.accepted : Number(it.accepted) || 0;
      const offerIdLower = offerId.toLowerCase();

      if (!declaredOfferIdsLower.has(offerIdLower)) {
        // Найти SKU (только по SKU, так как штрихкод отсутствует для незаявленных позиций)
        const matchedSku = skus.find(skuItem => skuItem.sku.toLowerCase() === offerIdLower);
        const article = matchedSku ? matchedSku.sku : offerId;

        extras.push({
          offerId,
          article,
          qty: accepted
        });
      }
    }
  });

  const isCandidate = extras.length > 0;

  return {
    isCandidate,
    missing,
    extras
  };
}
