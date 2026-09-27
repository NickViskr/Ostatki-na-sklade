/**
 * Item 89, part C. The proxy decides per Apps Script action whether it is a read (cached,
 * retried, never wipes the cache) or a write (invalidates reads). A read the proxy does not
 * know is treated as a write and wipes the whole cache — three times so far (items 26 ×2 and
 * `getOzonStockHistory`, found 2026-09-27). The table is checked here against Code.gs itself.
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { GAS_ACTIONS, gasCacheTtlMs, gasReadsInvalidatedBy, isGasRead } from './gasActions';

const codeGs = fs.readFileSync(path.join(process.cwd(), 'Code.gs'), 'utf8');

// doPost from its header to the end of the function (the first closing brace at column 0).
const doPostStart = codeGs.indexOf('function doPost(');
const doPost = codeGs.slice(doPostStart, codeGs.indexOf('\n}\n', doPostStart));
const lockFreeBlock = doPost.match(/const LOCK_FREE_ACTIONS = \[([\s\S]*?)\];/)![1];
const LOCK_FREE = [...lockFreeBlock.matchAll(/^\s*'(\w+)'/gm)].map((m) => m[1]);
// Actions answered before the lock is taken (early returns above LOCK_FREE_ACTIONS).
const beforeLock = doPost.slice(0, doPost.indexOf('const LOCK_FREE_ACTIONS'));
const EARLY = new Set([...beforeLock.matchAll(/action === '(\w+)'/g)].map((m) => m[1]));
const DISPATCHED = new Set([...EARLY, ...[...doPost.matchAll(/case '(\w+)':/g)].map((m) => m[1])]);

// Reads Code.gs still runs under the global lock. Known and accepted (owner, 2026-09-27, Q7):
// slower only, never wrong. A new read that takes the lock must be added here on purpose.
const KNOWN_LOCKED_READS = ['getArchivedItems', 'getLastPurchasePrices', 'getOzonCostExport', 'getOzonSettingsJournal', 'login', 'verifySession'];

const reads = Object.keys(GAS_ACTIONS).filter(isGasRead);

describe('item 89 C: the action table agrees with Code.gs', () => {
  it('parses Code.gs (guards the checks below against an empty match)', () => {
    expect(LOCK_FREE.length).toBeGreaterThan(15);
    expect(DISPATCHED.size).toBeGreaterThan(80);
  });

  it('every action in the table exists in Code.gs doPost', () => {
    expect(Object.keys(GAS_ACTIONS).filter((a) => !DISPATCHED.has(a))).toEqual([]);
  });

  it('every lock-free action of Code.gs is a read for the proxy', () => {
    expect(LOCK_FREE.filter((a) => !isGasRead(a))).toEqual([]);
  });

  it('every action Code.gs answers before the lock is a read, except the known background writes', () => {
    // These three start a background job or call the proxy back; they are writes on purpose.
    const EARLY_WRITES = ['archiveTransactions', 'runOzonSyncNow', 'runOzonStocksSyncNow'];
    expect([...EARLY].filter((a) => !isGasRead(a)).sort()).toEqual([...EARLY_WRITES].sort());
  });

  it('a read that Code.gs runs under the lock is a known exception', () => {
    const locked = reads.filter((a) => !LOCK_FREE.includes(a) && !EARLY.has(a));
    expect(locked.sort()).toEqual([...KNOWN_LOCKED_READS].sort());
  });

  it('a write only ever invalidates reads the table knows', () => {
    for (const a of Object.keys(GAS_ACTIONS)) {
      for (const r of gasReadsInvalidatedBy(a) || []) expect(isGasRead(r), `${a} → ${r}`).toBe(true);
    }
  });

  it('a read invalidates nothing and a write is never cached', () => {
    for (const a of Object.keys(GAS_ACTIONS)) {
      if (isGasRead(a)) expect(gasReadsInvalidatedBy(a)).toEqual([]);
      else expect(gasCacheTtlMs(a)).toBe(0);
    }
  });
});

describe('item 89 C: the rules of the table', () => {
  it('getOzonStockHistory is a cached Ozon read dropped by saveOzonStocks', () => {
    expect(isGasRead('getOzonStockHistory')).toBe(true);
    expect(gasCacheTtlMs('getOzonStockHistory')).toBe(60 * 60 * 1000);
    expect(gasReadsInvalidatedBy('saveOzonStocks')).toContain('getOzonStockHistory');
  });

  it('an unknown action is a write that wipes the whole cache', () => {
    expect(isGasRead('someNewAction')).toBe(false);
    expect(gasReadsInvalidatedBy('someNewAction')).toBeNull();
    expect(gasCacheTtlMs('someNewAction')).toBe(0);
    // commit is described nowhere on purpose: it touches stock, history and everything else.
    expect(gasReadsInvalidatedBy('commit')).toBeNull();
  });

  it('cache lifetimes: reference 10 min, Ozon 60 min, operational 30 s', () => {
    expect(gasCacheTtlMs('getOzonSettings')).toBe(10 * 60 * 1000);
    expect(gasCacheTtlMs('getOzonInitialData')).toBe(60 * 60 * 1000);
    expect(gasCacheTtlMs('getStock')).toBe(30_000);
  });

  it('reads that must never be served stale have no cache lifetime', () => {
    // Item 47: the export stamps rows; item 81: China writes answer with the whole state;
    // item 87: the journal gains a row on every settings save.
    for (const a of ['getOzonCostExport', 'getChinaBatches', 'getChinaMoney', 'getChinaForecastData', 'getOzonSettingsJournal']) {
      expect(isGasRead(a), a).toBe(true);
      expect(gasCacheTtlMs(a), a).toBe(0);
    }
  });

  // Moved from source-text checks of server.ts (items 79b, 81–84, 87) when the lists left it.
  it('writes keep their narrow invalidation lists', () => {
    expect(gasReadsInvalidatedBy('saveOzonSettings')).toEqual(['getOzonSettings', 'getOzonInitialData']);
    expect(gasReadsInvalidatedBy('saveOzonSupplyDocs')).toEqual(['getOzonSupplyRequests']);
    for (const a of ['saveChinaBatchCost', 'deleteChinaBatchCost', 'saveChinaPayment', 'deleteChinaPayment', 'matchChinaPayment', 'unmatchChinaPayment', 'setChinaRubCostsDone', 'setChinaReceiptHistory']) {
      expect(gasReadsInvalidatedBy(a), a).toEqual(['getChinaBatches', 'getChinaMoney', 'getChinaForecastData']);
    }
    expect(gasReadsInvalidatedBy('deleteChinaBatch')).toEqual(['getChinaBatches', 'getChinaMoney', 'getChinaForecastData', 'getFactoryOrders', 'getOzonInitialData']);
    const mainAndChina = ['getChinaBatches', 'getChinaMoney', 'getChinaForecastData', 'getFactoryOrders', 'getOzonInitialData', 'getInitialData', 'getStock', 'getTransactions'];
    for (const a of ['saveChinaBatch', 'saveChinaReport', 'postChinaBatch', 'cancelChinaBatchPosting']) {
      expect(gasReadsInvalidatedBy(a), a).toEqual(mainAndChina);
    }
  });
});
