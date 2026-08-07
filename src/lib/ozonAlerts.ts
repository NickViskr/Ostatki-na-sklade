import { ExternalShipment, SKUItem } from '../types';
import { detectPeresort } from './ozonPeresort';
import { OzonCoverageResult, OzonCoverageSettings } from './ozonCoverage';

export type OzonAlertType = 'overdue' | 'rejected' | 'dispute' | 'shortage' | 'peresort_confirm' | 'peresort_commit' | 'supply_needed' | 'factory_order' | 'reserve_shortage';

export interface OzonAlert {
  key: string;            // `${postingId}:${type}` — уникальный ключ для скрытия
  postingId?: string;
  article?: string;
  orderNumber?: string;
  cabinet?: string;
  type: OzonAlertType;
  severity: 'red' | 'amber' | 'violet' | 'sky' | 'orange';
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

export function buildCoverageAlerts(
  coverage: OzonCoverageResult | null,
  settings: OzonCoverageSettings,
  orderedArticles: string[],
  namesByArticle: Record<string, string>
): OzonAlert[] {
  if (!coverage || !coverage.articles || !Array.isArray(coverage.articles) || coverage.articles.length === 0) {
    return [];
  }

  const orderedSet = new Set(
    (orderedArticles || []).map(a => String(a || '').trim().toLowerCase())
  );

  const factoryItems: { alert: OzonAlert; daysLeft: number }[] = [];
  const supplyItems: { alert: OzonAlert; minCoverageDays: number }[] = [];

  for (const art of coverage.articles) {
    const artKey = String(art.article || '').trim().toLowerCase();
    const name = namesByArticle && namesByArticle[art.article] ? String(namesByArticle[art.article]).trim() : '';
    const namePart = name ? `${art.article} — ${name}` : art.article;

    // АЛЕРТ «ПОРА ЗАКАЗАТЬ НА ФАБРИКЕ»
    if (art.factory && !orderedSet.has(artKey)) {
      let reasonText = '';
      if (art.factory.reason === 'total') {
        const threshold = Math.round((Number(art.leadTimeDays) || 0) + settings.minStockDays);
        reasonText = `хватит на ${Math.round(art.factory.daysLeft)} дн. при пороге ${threshold} дн.`;
      } else if (art.factory.reason === 'clusterDeficit') {
        reasonText = `кластерам нужно ${Math.round(art.factory.unmetDeficitQty)} шт, на своём складе нет`;
      }

      const orderText = `заказать ${Math.round(art.factory.orderQty)} шт (${art.factory.orderBoxes} кор.)`;
      const description = `${namePart} · ${reasonText} · ${orderText}`;

      factoryItems.push({
        alert: {
          key: `factory:${art.article}:${art.factory.orderQty}`,
          article: art.article,
          type: 'factory_order',
          severity: 'orange',
          title: 'Пора заказать на фабрике',
          description
        },
        daysLeft: art.factory.daysLeft
      });
    }

    // АЛЕРТ «ПОРА СДЕЛАТЬ ПОСТАВКУ»
    if (art.clusters && Array.isArray(art.clusters)) {
      const selectedClusters = art.clusters.filter(cls =>
        cls.recommendation !== null &&
        (cls.recommendation.boxes > 0 || cls.unmetQty > 0)
      );

      if (selectedClusters.length > 0) {
        let totalQty = 0;
        let totalUnmet = 0;

        for (const cls of selectedClusters) {
          if (cls.recommendation) {
            totalQty += cls.recommendation.qty;
          }
          totalUnmet += (cls.unmetQty || 0);
        }

        const sortedClusters = [...selectedClusters].sort((a, b) => {
          const ca = a.coverageDays === null ? Number.POSITIVE_INFINITY : a.coverageDays;
          const cb = b.coverageDays === null ? Number.POSITIVE_INFINITY : b.coverageDays;
          return ca - cb;
        });

        const top3 = sortedClusters.slice(0, 3);
        const clusterTexts = top3.map(cls => {
          if (cls.recommendation && cls.recommendation.boxes > 0) {
            let t = `${cls.clusterName}: ${cls.recommendation.boxes} кор. (${Math.round(cls.recommendation.qty)} шт)`;
            if (cls.unmetQty > 0) {
              t += `, не хватает ${Math.round(cls.unmetQty)} шт`;
            }
            return t;
          } else {
            return `${cls.clusterName}: нужно ${Math.round(cls.unmetQty)} шт — нет на своём складе`;
          }
        });

        let clusterStr = clusterTexts.join('; ');
        if (selectedClusters.length > 3) {
          clusterStr += ` и ещё ${selectedClusters.length - 3} кластер(ов)`;
        }

        // Если часть потребности уже закрыта созданными заявками, говорим об этом прямо:
        // иначе алерт выглядит противоречием — заявка создана, а поставку всё равно просят.
        const pendingNote = art.pendingTotal > 0
          ? ` · уже в заявках ${Math.round(art.pendingTotal)} шт, эта потребность сверх них`
          : '';

        const description = `${namePart} · ${clusterStr}${pendingNote}`;

        const minCoverageDays = Math.min(
          ...selectedClusters.map(cls => cls.coverageDays === null ? Number.POSITIVE_INFINITY : cls.coverageDays)
        );

        supplyItems.push({
          alert: {
            key: `supply:${art.article}:${Math.round(totalQty)}:${Math.round(totalUnmet)}`,
            article: art.article,
            type: 'supply_needed',
            severity: 'sky',
            title: 'Пора сделать поставку на Ozon',
            description
          },
          minCoverageDays
        });
      }
    }
  }

  factoryItems.sort((a, b) => a.daysLeft - b.daysLeft);
  supplyItems.sort((a, b) => a.minCoverageDays - b.minCoverageDays);

  return [
    ...factoryItems.map(item => item.alert),
    ...supplyItems.map(item => item.alert)
  ];
}

/** Входные данные алерта «резерв под заявки больше остатка». */
export interface ReserveShortageInput {
  /** Резерв под созданные заявки Ozon: артикул -> шт. */
  reservedByArticle: Record<string, number>;
  /** Доступно на Моём складе: артикул -> шт. */
  availableByArticle: Record<string, number>;
  /** Названия товаров для подписи: артикул -> название. Необязательно. */
  namesByArticle?: Record<string, string>;
}

/**
 * Алерт «заявка больше остатка». Состав заявки можно изменить в Ozon Seller,
 * и после изменения резерв под заявки может превысить остаток на складе.
 * Автоматически исправить это приложение не может — заявку правит пользователь в Ozon Seller.
 * Функция чистая: сравнивает два справочника и возвращает список алертов, отсортированный
 * по величине нехватки, от большей к меньшей.
 */
export function buildReserveShortageAlerts(input: ReserveShortageInput): OzonAlert[] {
  const reserved = (input && input.reservedByArticle) || {};
  const available = (input && input.availableByArticle) || {};
  const names = (input && input.namesByArticle) || {};

  const items: { alert: OzonAlert; missing: number }[] = [];

  for (const article of Object.keys(reserved)) {
    const reservedQty = Math.max(0, Number(reserved[article]) || 0);
    if (reservedQty <= 0) continue;

    const availableQty = Math.max(0, Number(available[article]) || 0);
    const missing = reservedQty - availableQty;
    if (missing <= 0) continue;

    const name = names[article] ? String(names[article]).trim() : '';
    const namePart = name ? `${article} — ${name}` : article;
    const description = `${namePart} · в заявках ${Math.round(reservedQty)} шт, на складе ${Math.round(availableQty)} шт, не хватает ${Math.round(missing)} шт`;

    items.push({
      alert: {
        key: `reserve_shortage:${article}:${Math.round(missing)}`,
        article,
        type: 'reserve_shortage',
        severity: 'red',
        title: 'Заявка больше остатка — измените заявку в Ozon Seller',
        description
      },
      missing
    });
  }

  items.sort((a, b) => b.missing - a.missing);
  return items.map(item => item.alert);
}

