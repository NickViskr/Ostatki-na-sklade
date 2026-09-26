/**
 * One item of Ozon's `/v1/analytics/stocks` answer → one row of the «Остатки Ozon» sheet.
 * Moved out of the `/api/ozon/stocks` handler in `server.ts` (item 85, step 1.3) so the mapping
 * can be tested: inside the request handler it was a closure nobody could call.
 *
 * Item 85, step 1.3 (audit 2026-09-26, owner's decision the same day). «Возвраты» used to be
 * `return_from_customer_stock_count` + `return_to_seller_stock_count`, and the supply planner
 * counts 95 % of «Возвраты» as goods for sale. The second field is goods Ozon prepares to send
 * BACK TO THE SELLER at his own request (Ozon's documentation: «готовящихся к вывозу по вашей
 * заявке») — they will never be sold on Ozon. They now go to «Прочее», which the planner never
 * counts; «Возвраты» keeps only the customer returns.
 */

export interface OzonAnalyticsStockItem {
  sku?: number | string;
  offer_id?: string;
  name?: string;
  warehouse_id?: number | string;
  warehouse_name?: string;
  cluster_name?: string;
  /** Ozon's older cluster id — NOT the one the planner and the supply wizard use. */
  cluster_id?: number | string;
  macrolocal_cluster_id?: number | string;
  available_stock_count?: number;
  valid_stock_count?: number;
  requested_stock_count?: number;
  transit_stock_count?: number;
  excess_stock_count?: number;
  return_from_customer_stock_count?: number;
  return_to_seller_stock_count?: number;
  waiting_docs_stock_count?: number;
  expiring_stock_count?: number;
  transit_defect_stock_count?: number;
  stock_defect_stock_count?: number;
  other_stock_count?: number;
}

export interface OzonStockSheetRow {
  cabinet: string;
  sku: string;
  offerId: string;
  name: string;
  warehouseName: string;
  clusterName: string;
  clusterId: string;
  available: number;
  preparing: number;
  requested: number;
  transit: number;
  excess: number;
  returns: number;
  other: number;
}

const n = (v: unknown): number => Number(v || 0) || 0;

/** The row, or null when every quantity is zero (such rows are never written, item 17). */
export function analyticsItemToStockRow(item: OzonAnalyticsStockItem, cabinet: string): OzonStockSheetRow | null {
  const available = n(item.available_stock_count);
  const preparing = n(item.valid_stock_count);
  const requested = n(item.requested_stock_count);
  const transit = n(item.transit_stock_count);
  const excess = n(item.excess_stock_count);
  const returns = n(item.return_from_customer_stock_count);
  const other = n(item.return_to_seller_stock_count) + n(item.waiting_docs_stock_count) + n(item.expiring_stock_count)
    + n(item.transit_defect_stock_count) + n(item.stock_defect_stock_count) + n(item.other_stock_count);

  if (available === 0 && preparing === 0 && requested === 0 && transit === 0 && excess === 0 && returns === 0 && other === 0) {
    return null;
  }

  return {
    cabinet,
    sku: String(item.sku || ''),
    offerId: String(item.offer_id || ''),
    name: String(item.name || ''),
    warehouseName: (item.warehouse_id && item.warehouse_name) ? String(item.warehouse_name) : 'Без склада (агрегат кластера)',
    clusterName: String(item.cluster_name || ''),
    clusterId: String(item.macrolocal_cluster_id || ''),
    available,
    preparing,
    requested,
    transit,
    excess,
    returns,
    other
  };
}
