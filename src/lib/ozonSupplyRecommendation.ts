// Item 88, ticket 02. Coverage days, colour tone, and the per-cluster supply recommendation.
import type { OzonCoverageSettings } from './ozonClusters';

/**
 * Покрытие в днях.
 * Обычный кластер: (расчётный остаток − скорость × неснижаемые дни) ÷ скорость.
 * Исключённый кластер (без поставок): неснижаемый запас не применяется — остаток ÷ скорость.
 * Скорость 0 — покрытие не определено (null, трактуется как «бесконечное»).
 */
export function calcCoverageDays(
  estimated: number,
  perDay: number,
  minStockDays: number,
  excluded: boolean
): number | null {
  if (!(perDay > 0)) return null;
  if (excluded) return estimated / perDay;
  return (estimated - perDay * minStockDays) / perDay;
}

/**
 * Item 85, step 1.8 (owner 2026-09-26). The colour of «Покрытие» follows the SAME thresholds as
 * the recommendation, on the same figure (shelf + goods on their way): 'red' — below the
 * minimum stock; 'amber' — below the target, i.e. exactly when a supply is recommended;
 * 'green' — enough; 'none' — no sales, nothing to measure. The old colour compared «days above
 * the minimum» with the whole target: a cluster could be amber with no recommendation, and the
 * priority coefficient was ignored. An excluded cluster has no minimum (as in calcCoverageDays).
 *
 * Item 86, step C (owner, 26.09.2026): a settings.deliveryToOzonDays (D) widens both thresholds
 * by the time a supply spends on the road, D itself NOT multiplied by the priority coefficient:
 *   red   ⇔ coverageDays (days above the minimum, calcCoverageDays' own meaning) < D — a supply
 *           sent today would still arrive AFTER the stock crosses the minimum;
 *   amber ⇔ estimated < perDay × (targetStockDays × k + D) — exactly calcSupplyRecommendation's
 *           own «need > 0» (settings there already carries targetStockDays × k, D added once).
 * D = 0 reproduces the old thresholds exactly (0 < 0 is false, the amber term loses +D).
 */
export type CoverageTone = 'none' | 'red' | 'amber' | 'green';

export function coverageTone(
  estimated: number,
  perDay: number,
  settings: Pick<OzonCoverageSettings, 'minStockDays' | 'targetStockDays' | 'deliveryToOzonDays'>,
  priorityK: number = 1,
  excluded: boolean = false
): CoverageTone {
  if (!(perDay > 0)) return 'none';
  const D = Math.max(0, Number(settings.deliveryToOzonDays) || 0);
  const k = !excluded && priorityK > 1 ? priorityK : 1;
  if (!excluded) {
    const coverageDays = (estimated - perDay * settings.minStockDays * k) / perDay;
    if (coverageDays < D) return 'red';
  }
  if (estimated < perDay * (settings.targetStockDays * k + D)) return 'amber';
  return 'green';
}

export interface SupplyRecommendation {
  /** Расчётная потребность, шт (до ограничения Моим складом и округления). */
  neededQty: number;
  /** Item 51. Pieces to ship if stock were unlimited: whole boxes, or a partial one. */
  wantQty: number;
  /** Boxes recommended; a partial box still counts as a box. */
  boxes: number;
  /** Pieces recommended. A multiple of the box ALWAYS, except the partial box of item 51. */
  qty: number;
  /** true when the recommendation was cut down by the stock of «Мой склад». */
  limitedByMyStock: boolean;
  /** Item 51: the box is partial because a FULL one would bury a slow cluster. */
  partialByMaxDays: boolean;
  /** How many days a FULL box would last. 0 when the box is full. */
  fullBoxDays: number;
}

/**
 * Рекомендация поставки в кластер.
 * Пункт 34, дефект 1: неснижаемый остаток входит ВНУТРЬ целевого запаса, поэтому
 * нужно = скорость × целевой запас − расчётный остаток (без слагаемого minStockDays).
 * Порог включения рекомендации равен целевому запасу.
 * Пункт 34, дефект 2: rounding UP to whole boxes can bury a slow cluster under years of stock.
 * ITEM 51, owner's decision of 03.09.2026: such a cluster is NO LONGER dropped in silence —
 * it is offered a PARTIAL box holding exactly the need. The need is
 * perDay × targetStockDays − estimated, so after that delivery the cluster sits on exactly
 * the target stock and the maxClusterDays ceiling is never breached.
 * The cutoff stays as insurance and now fires only where the ceiling is BELOW the target
 * stock itself: there even the exact need breaches it, and the cluster gets no
 * recommendation — that is a settings mismatch, not a slow cluster.
 * ITEM 51, second half: the stock of «Мой склад» is also cut IN PIECES, not in whole boxes.
 * A cluster short of a full box used to get nothing at all.
 *
 * Item 86, step C (owner, 26.09.2026): a supply travels settings.deliveryToOzonDays (D) days
 * while the cluster keeps selling, so the need must cover the target stock PLUS that time on
 * the road: need = perDay × (targetStockDays + D) − estimated. D is NOT multiplied by the
 * priority coefficient — the caller already folds priority into targetStockDays (and
 * minStockDays) before calling this function, so D is added on top, once.
 * The maxClusterDays ceiling reads «days of sales left AFTER the supply arrives»: at arrival
 * (D days from now) perDay × D more pieces will have sold, so the days left are
 * (estimated + wantQty) / perDay − D, compared with maxDays. Same net-of-D figure is used for
 * the insurance return-null check and for fullBoxDays (the days a FULL box would leave AFTER
 * arrival) — one convention, so the UI hint stays true to what tripped the ceiling.
 * D = 0 reproduces the old numbers exactly.
 */
export function calcSupplyRecommendation(
  perDay: number,
  estimated: number,
  settings: OzonCoverageSettings,
  pcsPerBox: number,
  myStockAvailable: number
): SupplyRecommendation | null {
  if (!(perDay > 0)) return null;
  const D = Math.max(0, Number(settings.deliveryToOzonDays) || 0);

  const need = perDay * (settings.targetStockDays + D) - estimated;
  if (need <= 0) return null;

  const box = pcsPerBox > 0 ? pcsPerBox : 1;
  const boxesNeeded = Math.ceil(need / box);

  let wantQty = boxesNeeded * box;
  let partialByMaxDays = false;
  let fullBoxDays = 0;
  const maxDays = Number(settings.maxClusterDays) || 0;
  if (maxDays > 0 && (estimated + wantQty) / perDay - D > maxDays) {
    fullBoxDays = (estimated + wantQty) / perDay - D;
    wantQty = Math.ceil(need);
    partialByMaxDays = true;
    // Insurance: a ceiling below the target stock — not even the exact need fits under it.
    if ((estimated + wantQty) / perDay - D > maxDays) return null;
  }

  const stock = Math.floor(Math.max(0, myStockAvailable));
  const qty = Math.min(wantQty, stock);

  return {
    neededQty: need,
    wantQty,
    boxes: Math.ceil(qty / box),
    qty,
    limitedByMyStock: qty < wantQty,
    partialByMaxDays,
    fullBoxDays
  };
}
