import { ServiceItem, ServiceRate } from '../types';

/**
 * Item 43. The single place that decides which rate is in force and which rate a past
 * shipment was billed at. This logic used to exist as three diverging copies: the
 * directory had none at all, the confirmation window let an empty ДействуетС through,
 * and the services editor replaced the historical price with today's one.
 */

/** Today as yyyy-MM-dd on the LOCAL calendar.
 *  Not toISOString(): in Moscow the UTC date is still yesterday until 03:00, so a tariff
 *  starting today would not apply for the first three hours of the working day. */
export const todayLocalDateString = (now: Date = new Date()): string =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

/**
 * The tariff in force on the cut-off date: the latest row of «Тарифы услуг» that has
 * already started. Rows with an empty ДействуетС are skipped, exactly as getServiceCostAt
 * does in Code.gs. With no matching row the service's base price applies.
 */
export const resolveServiceRateAt = (
  serviceRates: ServiceRate[],
  serviceId: string,
  dateStr?: string
): ServiceRate | null => {
  const targetDate = dateStr || todayLocalDateString();
  const rates = (serviceRates || []).filter(
    (r) => String(r.serviceId) === String(serviceId) && r.validFrom && r.validFrom <= targetDate
  );
  if (rates.length === 0) return null;
  return rates.slice().sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0];
};

/** Unit cost of a service on the cut-off date, RUB. */
export const resolveServiceCostAt = (
  serviceRates: ServiceRate[],
  services: ServiceItem[],
  serviceId: string,
  dateStr?: string
): number => {
  const rate = resolveServiceRateAt(serviceRates, serviceId, dateStr);
  if (rate) return rate.cost;
  const service = (services || []).find((s) => String(s.id) === String(serviceId));
  return service ? service.cost : 0;
};
