import { ExternalShipment, SKUItem } from '../types';
import { detectPeresort } from './ozonPeresort';

export type OzonAlertType = 'overdue' | 'rejected' | 'dispute' | 'shortage' | 'peresort_confirm' | 'peresort_commit';

export interface OzonAlert {
  key: string;            // `${postingId}:${type}` — уникальный ключ для скрытия
  postingId: string;
  orderNumber?: string;
  cabinet?: string;
  type: OzonAlertType;
  severity: 'red' | 'amber' | 'violet';
  title: string;          // короткий заголовок по-русски
  description: string;    // детали по-русски
}

function parsePeresortMeta(peresortJSON?: string): { confirmed: boolean; committed: boolean } {
  if (!peresortJSON || peresortJSON.trim() === '') {
    return { confirmed: false, committed: false };
  }
  try {
    const parsed = JSON.parse(peresortJSON);
    if (!parsed || !Array.isArray(parsed.pairs) || parsed.pairs.length === 0) {
      return { confirmed: false, committed: false };
    }
    return {
      confirmed: true,
      committed: !!parsed.committedAt
    };
  } catch (e) {
    return { confirmed: false, committed: false };
  }
}

export function buildOzonAlerts(shipments: ExternalShipment[], skus: SKUItem[]): OzonAlert[] {
  if (!shipments || !Array.isArray(shipments)) {
    return [];
  }

  const redAlerts: OzonAlert[] = [];
  const violetAlerts: OzonAlert[] = [];
  const amberAlerts: OzonAlert[] = [];

  for (const s of shipments) {
    // Пропускай поставки со status === 'ignored'.
    if (s.status === 'ignored') {
      continue;
    }

    // ozonStatus нормализуй: String(s.ozonStatus || '').toUpperCase().trim().
    const ozonStatus = String(s.ozonStatus || '').toUpperCase().trim();

    // Пропускай поставки с ozonStatus === 'CANCELLED' — по ним алертов нет вообще.
    if (ozonStatus === 'CANCELLED') {
      continue;
    }

    const orderRef = s.orderNumber || s.postingId;
    const cabinetSuffix = s.cabinet ? `, Кабинет: ${s.cabinet}` : '';
    const stdDescription = `Заявка №${orderRef}${cabinetSuffix}`;

    // Алерты по статусу (severity 'red'):
    if (ozonStatus === 'OVERDUE') {
      redAlerts.push({
        key: `${s.postingId}:overdue`,
        postingId: s.postingId,
        orderNumber: s.orderNumber,
        cabinet: s.cabinet,
        type: 'overdue',
        severity: 'red',
        title: 'Поставка просрочена',
        description: stdDescription
      });
    } else if (ozonStatus === 'REJECTED_AT_SUPPLY_WAREHOUSE') {
      redAlerts.push({
        key: `${s.postingId}:rejected`,
        postingId: s.postingId,
        orderNumber: s.orderNumber,
        cabinet: s.cabinet,
        type: 'rejected',
        severity: 'red',
        title: 'Отказано в приёмке',
        description: stdDescription
      });
    } else if (ozonStatus === 'REPORT_REJECTED') {
      redAlerts.push({
        key: `${s.postingId}:dispute`,
        postingId: s.postingId,
        orderNumber: s.orderNumber,
        cabinet: s.cabinet,
        type: 'dispute',
        severity: 'red',
        title: 'Спор: акт приёмки отклонён',
        description: stdDescription
      });
    }

    // Алерты пересорта:
    const det = detectPeresort(s, skus);
    const meta = parsePeresortMeta(s.peresortJSON);

    let hasPeresortAlert = false;

    if (det.isCandidate && det.extras.length > 0 && !meta.confirmed) {
      const extrasText = det.extras
        .map(item => {
          const art = item.article || item.offerId;
          return `${art} ×${item.qty}`;
        })
        .join(', ');

      amberAlerts.push({
        key: `${s.postingId}:peresort_confirm`,
        postingId: s.postingId,
        orderNumber: s.orderNumber,
        cabinet: s.cabinet,
        type: 'peresort_confirm',
        severity: 'amber',
        title: 'Возможен пересорт — нужно подтверждение',
        description: extrasText
      });
      hasPeresortAlert = true;
    } else if (meta.confirmed && !meta.committed) {
      violetAlerts.push({
        key: `${s.postingId}:peresort_commit`,
        postingId: s.postingId,
        orderNumber: s.orderNumber,
        cabinet: s.cabinet,
        type: 'peresort_commit',
        severity: 'violet',
        title: 'Пересорт подтверждён — нужно проведение',
        description: stdDescription
      });
      hasPeresortAlert = true;
    }

    // Алерт недостачи (severity 'amber', type 'shortage', title «Недостача при приёмке»):
    // - Считай ТОЛЬКО если по этой поставке НЕ создан ни peresort_confirm, ни peresort_commit
    // - Условие: s.acceptedJSON непустой.
    if (!hasPeresortAlert && s.acceptedJSON && s.acceptedJSON.trim() !== '') {
      try {
        const items = JSON.parse(s.itemsJSON || '[]');
        const acceptedList = JSON.parse(s.acceptedJSON);

        if (Array.isArray(items) && Array.isArray(acceptedList)) {
          const acceptedMap = new Map<string, number>();
          acceptedList.forEach((it: any) => {
            if (it && typeof it === 'object' && 'offerId' in it) {
              const key = String(it.offerId).trim().toLowerCase();
              const accepted = typeof it.accepted === 'number' ? it.accepted : Number(it.accepted) || 0;
              acceptedMap.set(key, accepted);
            }
          });

          let totalShortage = 0;
          const shortageLines: string[] = [];

          for (const item of items) {
            if (!item || typeof item !== 'object') continue;
            const offerId = String(item.offerId || item.offer_id || '').trim();
            if (!offerId) continue;
            const key = offerId.toLowerCase();

            if (acceptedMap.has(key)) {
              const qtyVal = item.qty !== undefined ? item.qty : item.quantity;
              const qty = Number(qtyVal) || 0;
              const accepted = acceptedMap.get(key)!;
              if (accepted < qty) {
                const diff = qty - accepted;
                if (diff > 0) {
                  totalShortage += diff;
                  const art = String(item.article || item.offerId || '').trim() || offerId;
                  shortageLines.push(`${art} −${diff}`);
                }
              }
            }
          }

          if (totalShortage > 0) {
            amberAlerts.push({
              key: `${s.postingId}:shortage`,
              postingId: s.postingId,
              orderNumber: s.orderNumber,
              cabinet: s.cabinet,
              type: 'shortage',
              severity: 'amber',
              title: 'Недостача при приёмке',
              description: `Не принято ${totalShortage} шт: ${shortageLines.join(', ')}`
              // артикул из позиции itemsJSON, если пуст — offerId
            });
          }
        }
      } catch (e) {
        // При любой ошибке парсинга недостачу не считаем
      }
    }
  }

  return [...redAlerts, ...violetAlerts, ...amberAlerts];
}
