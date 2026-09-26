import { OzonCoverageResult } from './ozonCoverage';

/**
 * Item 87 step 4. What a settings change does to money, aggregated from an already-built
 * `OzonCoverageResult` — the caller runs `buildOzonCoverage` itself (see
 * `OzonStocksTab.runCoverage`) so «было» is byte-identical to what the «Остатки Озон» screen
 * shows for the SAME settings.
 */
export interface OzonSettingsImpact {
  /** Пункт заказа на фабрике по всем товарам и компонентам комплектов, шт. */
  factoryPcs: number;
  /** То же в рублях по цене последнего поступления (или средней себестоимости), 2 знака. */
  factoryRub: number;
  /** Сколько товаров/компонентов дали сигнал заказа на фабрике. */
  factoryArticles: number;
  /** Рекомендованная поставка в кластеры по всем товарам, шт. */
  supplyPcs: number;
  /** Артикулы с сигналом заказа на фабрике, у которых цена неизвестна (не вошли в factoryRub). */
  noPriceArticles: string[];
}

/**
 * Сворачивает результат `buildOzonCoverage` в четыре цифры для окна настроек. Компоненты
 * виртуальных комплектов учитываются наравне с обычными товарами — у самого комплекта сигнала
 * заказа на фабрике нет (его несёт компонент-узкое место), поэтому двойного счёта не возникает.
 */
export function summarizeSettingsImpact(
  result: OzonCoverageResult,
  unitPrice: (article: string) => number
): OzonSettingsImpact {
  let factoryPcs = 0;
  let factoryRub = 0;
  let factoryArticles = 0;
  let supplyPcs = 0;
  const noPriceArticles: string[] = [];

  const addFactorySignal = (article: string, orderQty: number) => {
    if (!(orderQty > 0)) return;
    factoryPcs += orderQty;
    factoryArticles += 1;
    const price = unitPrice(article);
    if (price > 0) {
      factoryRub += orderQty * price;
    } else {
      noPriceArticles.push(article);
    }
  };

  for (const art of result.articles || []) {
    if (art.factory && art.factory.orderQty > 0) addFactorySignal(art.article, art.factory.orderQty);
    for (const cls of art.clusters || []) {
      if (cls.recommendation) supplyPcs += cls.recommendation.qty;
    }
  }
  for (const comp of result.components || []) {
    if (comp.factory && comp.factory.orderQty > 0) addFactorySignal(comp.component, comp.factory.orderQty);
  }

  return {
    factoryPcs,
    // Деньги считаются кодом (не в уме), округление до копеек — единожды, в конце суммирования.
    factoryRub: Math.round(factoryRub * 100) / 100,
    factoryArticles,
    supplyPcs,
    noPriceArticles,
  };
}
