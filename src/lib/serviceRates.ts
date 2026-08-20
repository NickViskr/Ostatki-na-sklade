import { ServiceItem, ServiceRate } from '../types';

/**
 * Item 43. Единственное место, где решается «какая расценка действует» и «по какой
 * расценке была посчитана прошлая отгрузка». Раньше логика жила тремя расходящимися
 * копиями: в справочнике её не было вовсе, в окне подтверждения она пропускала пустую
 * ДействуетС, а окно редактирования услуг подменяло историческую цену сегодняшней.
 */

/** Сегодняшний день в формате yyyy-MM-dd по МЕСТНОМУ календарю.
 *  Не toISOString(): в Москве UTC-дата до 03:00 ещё вчерашняя, и тариф, начавшийся
 *  сегодня, не применялся бы первые три часа рабочего дня. */
export const todayLocalDateString = (now: Date = new Date()): string =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

/**
 * Тариф услуги, действующий на дату отсечки: самая поздняя строка «Тарифы услуг»,
 * которая уже началась. Строки с пустой ДействуетС пропускаются — так же, как в
 * getServiceCostAt в Code.gs. Если подходящих строк нет, действует базовая цена услуги.
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

/** Стоимость услуги на дату отсечки, ₽ за единицу. */
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

export interface StoredServiceEntry {
  name: string;
  unitCost: number;
  quantity: number;
}

/**
 * Разбор записанной в отгрузку строки «Услуги: Название x2 (300₽), Другое (150₽)».
 *
 * Расценка берётся ИЗ САМОЙ ОТГРУЗКИ: она записана по тарифу, действовавшему на дату
 * поставки, и смена тарифа задним числом менять её не должна.
 *
 * Старый формат «Доп. услуги: Название (300₽)» количества не хранит. Только для него и
 * только когда справочная цена делит сумму нацело, количество восстанавливается по
 * справочнику; иначе услуга считается разовой на всю сумму.
 */
export const parseStoredServiceEntries = (
  servicesTag: string,
  services: ServiceItem[]
): StoredServiceEntry[] => {
  const out: StoredServiceEntry[] = [];
  const re = /([^(]+)\((\d+(?:\.\d+)?)₽\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(servicesTag)) !== null) {
    const rawName = m[1].trim().replace(/^(Доп\. услуги|Услуги):\s*/, '').replace(/^,\s*/, '').trim();
    const totalCost = parseFloat(m[2]);
    const qtyMatch = rawName.match(/^(.*?)\s+x(\d+)\s*$/i);

    if (qtyMatch) {
      const quantity = parseInt(qtyMatch[2], 10) || 1;
      out.push({
        name: qtyMatch[1].trim(),
        unitCost: quantity > 0 ? totalCost / quantity : totalCost,
        quantity
      });
      continue;
    }

    const service = (services || []).find((s) => s.name === rawName);
    const refCost = service && service.cost > 0 ? service.cost : 0;
    const inferredQty = refCost > 0 ? Math.round(totalCost / refCost) : 0;
    if (inferredQty > 0 && Math.abs(inferredQty * refCost - totalCost) < 0.01) {
      out.push({ name: rawName, unitCost: refCost, quantity: inferredQty });
    } else {
      out.push({ name: rawName, unitCost: totalCost, quantity: 1 });
    }
  }
  return out;
};
