import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Source guards over the write path of an operation (27.08.2026).
 *
 * Neither `Code.gs` nor `server.ts` can be imported by a test: the first one only runs inside
 * Google, the second one starts a server on import. What CAN be checked is that the specific
 * lines the speed of a receipt depends on are still there. The arithmetic of a commit is
 * covered by the Apps Script stand (`npm run test:gas`); these checks cover the shape of it —
 * the thing a later edit could quietly undo without a single number changing.
 *
 * Measured in Cloud Run on 21.08.2026, receipt of a factory batch: 29,8 s for one write and
 * 115,1 s for another (90 s of timeout + 20 s of pause + 5,1 s of the repeat), and the repeat
 * came back "already recorded" over a receipt that had never been made before.
 */
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

function commitBody(): string {
  const gas = read('Code.gs');
  const start = gas.indexOf('function commitTransaction(');
  expect(start).toBeGreaterThan(-1);
  const end = gas.indexOf('\nfunction ', start + 10);
  expect(end).toBeGreaterThan(start);
  return gas.slice(start, end);
}

describe('цена проведения операции не растёт с числом позиций', () => {
  it('лист SKU не читается внутри цикла позиций', () => {
    const body = commitBody();
    // The single-article helper is the one that costs a full read of the sheet per call.
    expect(body).not.toContain('ensureSkuExists(');
    // The whole list is handed over once, before the loop.
    expect(body).toMatch(/skusCreated = ensureSkusExist\(items/);
  });

  it('строки «Остатки» пишутся через накопитель, а не по одной прямо из цикла', () => {
    const body = commitBody();
    expect(body).not.toContain('stockSheet.appendRow');
    // The only two direct requests to the sheet left are the two batch writes inside
    // flushStockRows: the block of changed rows and the block of created ones.
    expect(body.split('stockSheet.getRange(').length - 1).toBe(2);
    expect(body).toMatch(/stockSheet\.getRange\(minRow, 2, block\.length, 3\)\.setValues\(block\)/);
    expect(body).toMatch(
      /stockSheet\.getRange\(firstNewStockRow, 1, newStockRows\.length, STOCK_ROW_WIDTH\)\.setValues\(newStockRows\)/
    );
    expect(body).toMatch(/flushStockRows\(\);/);
  });

  it('список SKU возвращается только когда артикул действительно заведён', () => {
    expect(commitBody()).toMatch(/if \(skusCreated\) commitResult\.skus = getSkus\(\);/);
  });

  it('повторному проведению дают дождаться замка, а не падать на нём', () => {
    expect(read('Code.gs')).toMatch(/lock\.waitLock\(action === 'commit' \? 30000 : 10000\);/);
  });
});

describe('повтор, который сделал сам прокси, не выдаётся за дубль', () => {
  it('пауза перед повтором — 5 секунд', () => {
    const server = read('server.ts');
    expect(server).toMatch(/const retryDelayMs = 5_000;/);
    expect(server).not.toMatch(/const retryDelayMs = 20_000;/);
  });

  it('метка idempotentHit снимается, когда повтор сделал сам прокси', () => {
    expect(read('server.ts')).toMatch(
      /if \(attempt > 1 && data\?\.data\?\.idempotentHit === true\) \{[\s\S]{0,400}?delete data\.data\.idempotentHit;/
    );
  });

  it('на первой попытке метка сохраняется — настоящий повтор пользователя виден', () => {
    // The check above proves a delete stands under `attempt > 1`. This one proves there is no
    // SECOND, unconditional delete somewhere else: that one would hide a real double press,
    // when the user himself sent the same operation twice.
    expect(read('server.ts').split('delete data.data.idempotentHit;').length - 1).toBe(1);
  });
});
