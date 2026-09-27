/**
 * Item 89, part C. The one table of Apps Script actions the proxy (`server.ts`, `/api/gas`)
 * needs to know about. Replaces three separate lists (READ_ONLY_ACTIONS, getCacheTtlMs,
 * CACHE_INVALIDATION) that had to be kept in step by hand.
 *
 * A READ is cached for its tier's lifetime, retried once after a transport failure, and never
 * touches the cache of others. A WRITE is not cached, not retried (except `commit` with an
 * opId, decided in server.ts), and drops the reads it lists. An action missing from the table
 * is a WRITE that wipes the WHOLE cache — safe, but a read missing here wipes the cache on
 * every call (items 26 ×2, and `getOzonStockHistory` until 2026-09-27).
 * `gasActions.test.ts` checks the table against Code.gs's own dispatch and lock-free list.
 */

// Пункт 29, этап B: раздельные сроки жизни кэша вместо общих 30 секунд.
// Справочники почти не меняются, данные Ozon обновляются триггерами
// дважды в сутки, а оперативные остатки должны быть свежими.
// Любое пишущее действие по-прежнему сбрасывает весь кэш целиком,
// поэтому длинные сроки не могут показать устаревшие данные.
// (Since stage C, a write listed in GAS_ACTIONS drops only the reads it names.)
// Item 26 (2026-08-20): Ozon raised from 5 to 60 minutes. Measurement showed the whole start-up
// is one request — getOzonSales takes 9-13 s because it reads the entire «Продажи Ozon»
// sheet, of which 57% are archive rows the date window always discards. Served from cache
// the same call takes 250 ms, so keeping the cache alive is worth far more than bundling
// calls together. STALENESS TRADE-OFF, stated plainly: the twice-daily sync trigger runs
// INSIDE Apps Script and never passes through this proxy, so it cannot invalidate this
// cache — after a sync the app may show data up to one hour old. Three things keep that
// acceptable: the screen always shows the data's own «Обновлено» timestamp, any write
// action through the proxy clears the cache, and with max-instances=1 an idle night scales
// the container to zero, so the first visit of the day starts from an empty cache anyway.
export const GAS_CACHE_TTL_MS = {
  reference: 10 * 60 * 1000, // справочники, 10 минут
  ozon: 60 * 60 * 1000,      // данные Ozon, 60 минут
  operational: 30_000        // оперативные данные, 30 секунд
} as const;

type GasCacheTier = keyof typeof GAS_CACHE_TTL_MS;

type GasAction =
  /** No `cache`: a read that is never served from the cache. */
  | { read: true; cache?: GasCacheTier }
  /** The reads this write makes stale; an empty list drops nothing. */
  | { read: false; invalidates: readonly string[] };

const read = (cache?: GasCacheTier): GasAction => ({ read: true, cache });
const write = (...invalidates: string[]): GasAction => ({ read: false, invalidates });

// Item 81: the module «Заказы в Китае». Its writes touch nothing but its own spreadsheet, so only
// its own reads have to be dropped.
const CHINA_READS = ['getChinaBatches', 'getChinaMoney', 'getChinaForecastData'];
// Item 84 (stage 1): posting/cancelling touches the module's own spreadsheet AND the MAIN
// spreadsheet's «Остатки»/«Транзакции» (commitTransaction/deleteTransaction) plus «Заказы на
// фабрике» (the posted batch's row moves in the pipeline) — every read any of that feeds must
// drop. saveChinaBatch and saveChinaReport can run the automatic cost correction of a posted
// batch, which writes the same main-spreadsheet sheets.
const CHINA_AND_MAIN_READS = [...CHINA_READS, 'getFactoryOrders', 'getOzonInitialData', 'getInitialData', 'getStock', 'getTransactions'];

export const GAS_ACTIONS: Record<string, GasAction> = {
  // ── Reads ──
  getInitialData: read('operational'),
  getTransactions: read('operational'),
  getSkus: read('operational'),
  getStock: read('operational'),
  getArchivedItems: read('operational'),
  getExternalShipments: read('operational'),
  getOzonSupplyRequests: read('operational'),
  // Item 26 (2026-08-20): getLastPurchasePrices was missing from the reads from the day it was
  // added. It is a pure read — it only calls getValues on the history sheet — but the dashboard
  // fires it on EVERY load, so on every load the proxy treated it as a write and wiped the
  // entire response cache. That is why the cache never helped at start-up.
  getLastPurchasePrices: read('operational'),
  getServices: read('reference'),
  getServiceRates: read('reference'),
  getUsers: read('reference'),
  getOzonSettings: read('reference'),
  getOzonClusters: read('reference'),
  getOzonStocks: read('ozon'),
  getOzonSales: read('ozon'),
  getFactoryOrders: read('ozon'),
  // Item 26 stage A1: the composite read is cached like the Ozon data it carries. It also
  // carries settings and clusters, which on their own live 10 minutes — the shorter of the two
  // lifetimes is used deliberately, so nothing is served staler than it would have been when
  // fetched separately. LEFT OUT OF THE LIFETIMES BY MISTAKE when the action was introduced: it
  // was not cached at all and start-up got SLOWER, not faster — five cached reads had been
  // replaced by one uncached one. It was also missing from the reads at first, so every cache
  // miss on it wiped the whole cache and made every other read on the same page load miss too.
  getOzonInitialData: read('ozon'),
  // Item 89 (2026-09-27): read after every sales refresh since item 86 but never listed, so
  // every call wiped the whole cache. Written only by saveOzonStocks (updateOzonStockHistory).
  getOzonStockHistory: read('ozon'),
  // Item 78a: a pure read of «KAN дни» and «Снимки склада»; runKanPullNow stays a write.
  getTurnoverData: read('ozon'),
  verifySession: read(),
  login: read(),
  getGlobalSettings: read(),
  getOzonSyncStatus: read(),
  getGeminiKey: read(),
  getOzonKeys: read(),
  checkSupplyAvailability: read(),
  // Item 47, stage 3: a pure read of the cost journal. Deliberately NOT cached — the button
  // stamps the rows it exported, so a cached answer would offer the same rows twice.
  getOzonCostExport: read(),
  // Item 81: pure reads of the module's own spreadsheet. Deliberately not cached — every write
  // of the module answers with the whole state anyway. Item 82: calcChinaForecast computes a
  // forecast but writes nothing.
  getChinaBatches: read(),
  getChinaMoney: read(),
  getChinaForecastData: read(),
  calcChinaForecast: read(),
  // Item 87 step 5: the settings change journal. Deliberately not cached — the journal gains a
  // row on every saveOzonSettings, so a cached answer would hide the most recent change.
  getOzonSettingsJournal: read(),

  // ── Writes with a narrow invalidation ──
  // Пункт 29, этап C: точечная очистка кэша. Сюда попали только действия, про которые точно
  // известно, что склад, историю, SKU и комплекты они не затрагивают.
  logout: write(),
  saveOzonSettings: write('getOzonSettings', 'getOzonInitialData'),
  saveOzonClusters: write('getOzonClusters', 'getOzonInitialData'),
  markOzonClustersNotified: write('getOzonClusters', 'getOzonInitialData'),
  saveOzonSales: write('getOzonSales', 'getOzonInitialData'),
  saveOzonStocks: write('getOzonStocks', 'getOzonInitialData', 'getOzonStockHistory'),
  saveExternalShipments: write('getExternalShipments'),
  updateExternalShipmentStatus: write('getExternalShipments'),
  saveOzonSupplyRequest: write('getOzonSupplyRequests', 'getExternalShipments'),
  addUser: write('getUsers'),
  deleteUser: write('getUsers'),
  saveGlobalSettings: write('getGlobalSettings'),
  addService: write('getServices'),
  updateService: write('getServices'),
  deleteService: write('getServices'),
  addServiceRate: write('getServiceRates'),
  saveFactoryOrder: write('getFactoryOrders', 'getOzonInitialData'),
  // Item 47, stage 3: stamping the exported rows touches nothing any other read returns. It
  // must still be listed: an action missing from the table wipes the whole cache.
  markOzonCostExported: write(),
  // Item 68 stage 2: a return moves stock, adds history rows and marks the supply row.
  commitUnshippedReturn: write('getInitialData', 'getStock', 'getTransactions', 'getExternalShipments'),
  // Item 79b: the documents record lands in the journal from /api/ozon/supply/docs, which
  // calls Apps Script directly and must clear the journal read itself (see that route).
  saveOzonSupplyDocs: write('getOzonSupplyRequests'),
  // Item 81/82: China writes drop every read of the module (tariffs, boxes and vs-fact all
  // derive from batches, lines, payments and reports).
  setupChinaSpreadsheet: write('getChinaBatches'),
  saveChinaBatchCost: write(...CHINA_READS),
  deleteChinaBatchCost: write(...CHINA_READS),
  saveChinaPayment: write(...CHINA_READS),
  deleteChinaPayment: write(...CHINA_READS),
  // Item 81g-2: matching moves money between a payment and a receipt — both reads must drop.
  matchChinaPayment: write(...CHINA_READS),
  unmatchChinaPayment: write(...CHINA_READS),
  // Item 81g-3.
  setChinaRubCostsDone: write(...CHINA_READS),
  // Owner, 2026-09-25: the owner's own «история» mark on a receipt.
  setChinaReceiptHistory: write(...CHINA_READS),
  // Item 83c: deleting a batch also syncs «Заказы на фабрике».
  deleteChinaBatch: write(...CHINA_READS, 'getFactoryOrders', 'getOzonInitialData'),
  // Items 83c/84: a batch save syncs «Заказы на фабрике» and may run the automatic cost
  // correction of a posted batch; posting and cancelling write the main stock.
  saveChinaBatch: write(...CHINA_AND_MAIN_READS),
  // Item 81g-1: the report touches its own spreadsheet's read. Item 3: it now also fills
  // batches' order/arrival from the report's bills and syncs «Заказы на фабрике»
  // (chinaFillBatchesFromReport + syncChinaFactoryOrders) — same entries as saveChinaBatch.
  saveChinaReport: write(...CHINA_AND_MAIN_READS),
  postChinaBatch: write(...CHINA_AND_MAIN_READS),
  cancelChinaBatchPosting: write(...CHINA_AND_MAIN_READS),
  // Item 82d/83c: a forecast with an order number and a shipping date feeds «Заказы на фабрике».
  saveChinaForecast: write('getChinaForecastData', 'getFactoryOrders', 'getOzonInitialData'),
  deleteChinaForecast: write('getChinaForecastData', 'getFactoryOrders', 'getOzonInitialData'),
  // Item 83i: the manual/first-run sync button — same reads as the writes it reconciles.
  syncChinaFactoryOrders: write('getFactoryOrders', 'getOzonInitialData'),
  // Item 83e: the owner's manual/China conflict resolution touches only «Заказы на фабрике».
  resolveFactoryOrderConflict: write('getFactoryOrders', 'getOzonInitialData')
};

const own = (action: string): GasAction | undefined =>
  Object.prototype.hasOwnProperty.call(GAS_ACTIONS, action) ? GAS_ACTIONS[action] : undefined;

/** True for a known read. Unknown actions are writes. */
export function isGasRead(action: string): boolean {
  return own(action)?.read === true;
}

/** How long a successful answer may be served from the cache; 0 = never. */
export function gasCacheTtlMs(action: string): number {
  const a = own(action);
  return a && a.read && a.cache ? GAS_CACHE_TTL_MS[a.cache] : 0;
}

/** The reads a call of `action` makes stale: [] for a read, null = wipe the whole cache. */
export function gasReadsInvalidatedBy(action: string): readonly string[] | null {
  const a = own(action);
  if (!a) return null;
  return a.read ? [] : a.invalidates;
}
