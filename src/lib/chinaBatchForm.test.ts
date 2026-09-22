import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  chinaNumber, emptyChinaBatchForm, emptyChinaLine, chinaBatchToForm, chinaFormToPayload,
  chinaFormCounts, chinaGroupLabel, chinaLevelledGroups, validateChinaBatchForm, chinaFilledLines,
  ChinaBatchForm
} from './chinaBatchForm';
import { ChinaBatch } from '../types';

const filledForm = (): ChinaBatchForm => ({
  ...emptyChinaBatchForm(),
  code: 'NV-0825-2',
  orderNo: '28',
  shippedAt: '2026-08-27',
  arrivedAt: '2026-09-17',
  status: 'Прибыла',
  chinaDeliveryCny: '700',
  weightKg: '672,5',
  ratePerKgUsd: '2.3',
  packingUsd: '90',
  freightUsd: '1636.75',
  rubRate: '12,4',
  lines: [
    { ...emptyChinaLine(), marking: 'NV-99', boxes: '30', pcsPerBox: '8', qty: '240', priceCny: '20.3', palletWeightKg: '339' },
    { ...emptyChinaLine(), marking: 'NV-99', boxes: '15', pcsPerBox: '8', qty: '120', priceCny: '20.3' },
    { ...emptyChinaLine(), marking: 'NV-98', boxes: '15', pcsPerBox: '8', qty: '120', priceCny: '20.3', palletWeightKg: '333.5' }
  ]
});

describe('chinaNumber', () => {
  it('takes a comma as the decimal point', () => {
    expect(chinaNumber('672,5')).toBe(672.5);
  });

  it('ignores the spaces of a pasted number', () => {
    expect(chinaNumber('11 457,25')).toBe(11457.25);
  });

  it('turns an empty field and nonsense into zero', () => {
    expect(chinaNumber('')).toBe(0);
    expect(chinaNumber('около трёх')).toBe(0);
  });
});

describe('the payload of a batch', () => {
  it('sends numbers as numbers, so the script parses nothing', () => {
    const payload = chinaFormToPayload(filledForm()) as Record<string, unknown>;
    expect(payload.weightKg).toBe(672.5);
    expect(payload.rubRate).toBe(12.4);
    const lines = payload.lines as Record<string, unknown>[];
    expect(lines[0].qty).toBe(240);
    expect(lines[0].palletWeightKg).toBe(339);
  });

  it('leaves out the id of a batch that does not exist yet', () => {
    expect(chinaFormToPayload(filledForm())).not.toHaveProperty('id');
    expect(chinaFormToPayload({ ...filledForm(), id: 'CB1' })).toHaveProperty('id', 'CB1');
  });

  it('trims what the owner typed', () => {
    const form = { ...filledForm(), code: '  NV-0825-2  ' };
    form.lines = [{ ...emptyChinaLine(), marking: ' NV-99 ', qty: '10', article: ' BOX ' }];
    const payload = chinaFormToPayload(form) as Record<string, unknown>;
    expect(payload.code).toBe('NV-0825-2');
    expect((payload.lines as Record<string, unknown>[])[0].article).toBe('BOX');
  });
});

describe('a batch opened for editing', () => {
  it('comes back with the same numbers it was saved with', () => {
    const batch = {
      id: 'CB1', orderNo: '28', code: 'NV-0825-2', shippedAt: '2026-08-27', arrivedAt: '2026-09-17',
      status: 'Прибыла', goodsCny: 9744, chinaDeliveryCny: 700, weightKg: 672.5, volumeM3: 4.92,
      ratePerKgUsd: 2.3, packingUsd: 90, otherCargoUsd: 0, freightUsd: 1636.75, cargoRate: 7,
      freightCny: 11457.25, rubCosts: 0, rubRate: 12.4, totalRub: 271575.49, weightFactor: 0.7987,
      comment: '', user: 'Николай', updatedAt: '2026-09-22 20:00:00',
      lines: [{
        id: 'CB1-1', batchId: 'CB1', marking: 'NV-99', name: '收纳盒', boxes: 30, pcsPerBox: 8,
        qty: 240, priceCny: 20.3, sumCny: 4872, pallet: '1', palletWeightKg: 339, boxWeightKg: 0,
        weightKg: 270.76, weightSource: 'паллета', chinaShareCny: 281.83, freightShareCny: 4612.83,
        rubShare: 0, costRub: 121106.58, unitRub: 504.61, article: 'BOX', group: ''
      }],
      costs: []
    } as ChinaBatch;
    const form = chinaBatchToForm(batch);
    expect(form.weightKg).toBe('672.5');
    expect(form.lines[0].qty).toBe('240');
    expect(form.lines[0].article).toBe('BOX');
    // A zero is an empty field, not the digit 0: the owner sees a blank to fill in.
    expect(form.lines[0].boxWeightKg).toBe('');
  });
});

describe('what the form counts', () => {
  it('counts rows, boxes and pieces of the filled lines only', () => {
    const form = filledForm();
    form.lines.push(emptyChinaLine());
    expect(chinaFormCounts(form.lines)).toEqual({ rows: 3, boxes: 60, qty: 480 });
  });

  it('drops the empty tail rows before sending', () => {
    const form = filledForm();
    form.lines.push(emptyChinaLine(), emptyChinaLine());
    expect(chinaFilledLines(form.lines)).toHaveLength(3);
  });
});

describe('which lines are one product', () => {
  it('prefers the owner marker, then our article, then the carrier marking', () => {
    expect(chinaGroupLabel({ group: 'короб 8 шт', article: 'BOX-WHITE', marking: 'NV-99' })).toBe('короб 8 шт');
    expect(chinaGroupLabel({ article: 'BOX-WHITE', marking: 'NV-99' })).toBe('BOX-WHITE');
    expect(chinaGroupLabel({ marking: 'NV-99' })).toBe('NV-99');
  });

  it('shows a group only where there is something to level', () => {
    const lines = [{ marking: 'NV-99' }, { marking: 'NV-99' }, { marking: 'NV-98' }];
    expect(chinaLevelledGroups(lines)).toEqual({ 'nv-99': [0, 1] });
  });

  it('ties two colours together by the marker, across their own articles', () => {
    const lines = [
      { marking: 'NV-99', article: 'BOX-WHITE', group: 'короб 8 шт' },
      { marking: 'NV-98', article: 'BOX-GREY', group: 'короб 8 шт' }
    ];
    expect(chinaLevelledGroups(lines)).toEqual({ 'короб 8 шт': [0, 1] });
  });
});

describe('what the form refuses before the round trip', () => {
  it('accepts the batch of the real file', () => {
    expect(validateChinaBatchForm(filledForm())).toEqual([]);
  });

  it('refuses a batch with no code and no lines', () => {
    const errors = validateChinaBatchForm(emptyChinaBatchForm());
    expect(errors).toContain('Не указан код партии');
    expect(errors).toContain('В партии нет ни одной строки товара');
  });

  it('refuses a line without a marking and a line without pieces', () => {
    const form = filledForm();
    form.lines[0].marking = '';
    form.lines[1].qty = '0';
    const errors = validateChinaBatchForm(form);
    expect(errors).toContain('В строке 1 не указана маркировка');
    expect(errors).toContain('В строке 2 количество должно быть больше нуля');
  });

  it('refuses a date in another format, the way the script does', () => {
    const form = filledForm();
    form.shippedAt = '27.08.2026';
    expect(validateChinaBatchForm(form)).toContain('Дата отгрузки должна быть в формате ГГГГ-ММ-ДД');
  });

  it('lets an empty date through: not every batch has arrived', () => {
    const form = filledForm();
    form.arrivedAt = '';
    expect(validateChinaBatchForm(form)).toEqual([]);
  });

  it('refuses a status the script does not know', () => {
    expect(validateChinaBatchForm({ ...filledForm(), status: 'Прилетела' }))
      .toContain('Неизвестный статус партии');
  });
});

// Item 81b. Wiring guards: the screen, the store, the proxy and the script speak about the
// same module, and the browser never works out money of its own.
describe('подключение модуля «Заказы в Китае»', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
  const tab = read('src/components/ChinaOrdersTab.tsx');
  const modal = read('src/components/ChinaBatchModal.tsx');
  const store = read('src/store/useChinaStore.ts');
  const app = read('src/App.tsx');
  const sidebar = read('src/components/Sidebar.tsx');
  const server = read('server.ts');
  const script = read('ChinaOrders.gs');

  it('the tab is reachable, and only by an administrator', () => {
    expect(sidebar).toContain("id: 'china', label: 'Заказы в Китае'");
    expect(sidebar.indexOf("id: 'china'")).toBeGreaterThan(sidebar.indexOf('isCurrentUserAdmin ? ['));
    expect(app).toContain("activeTab === 'china' && isAdmin && <ChinaOrdersTab");
  });

  it('the store calls exactly the actions the script routes', () => {
    ['getChinaBatches', 'setupChinaSpreadsheet', 'saveChinaBatch', 'deleteChinaBatch',
      'saveChinaBatchCost', 'deleteChinaBatchCost'].forEach((action) => {
      expect(store).toContain(`'${action}'`);
      expect(script).toContain(`function ${action}(`);
    });
  });

  it('the proxy treats the read as a read and drops it after every write', () => {
    expect(server).toContain("'getChinaBatches'");
    ['setupChinaSpreadsheet', 'saveChinaBatch', 'deleteChinaBatch', 'saveChinaBatchCost', 'deleteChinaBatchCost']
      .forEach((action) => expect(server).toContain(`${action}: ['getChinaBatches']`));
  });

  it('every write replaces the whole state with what the script answered', () => {
    const writes = store.split('saveChinaBatch:')[1] || '';
    expect(writes).toContain('result.data.batches');
    expect(store).not.toContain('batches: [...get().batches');
  });

  it('the browser никогда не считает себестоимость сама', () => {
    // No rates, no shares, no multiplication of money anywhere on the screen.
    [tab, modal, store].forEach((source) => {
      expect(source).not.toMatch(/rubRate\s*\*/);
      expect(source).not.toMatch(/cargoRate\s*\*/);
      expect(source).not.toContain('freightCny =');
    });
    expect(tab).toContain('line.unitRub');
    expect(tab).toContain('line.costRub');
  });

  it('saving the articles saves the batch, so the script levels the goods again', () => {
    expect(tab).toContain('btn-save-china-labels');
    expect(tab).toContain('chinaFormToPayload(form)');
    expect(tab).toContain('chinaLevelledGroups');
  });

  it('the batch window can be scrolled to its buttons, as item 80 taught', () => {
    expect(modal).toContain('max-h-[90vh]');
    expect(modal).toContain('overflow-y-auto grow');
    expect(modal).toContain('shrink-0');
  });

  it('the window refuses a batch before sending it', () => {
    expect(modal).toContain('validateChinaBatchForm(form)');
    expect(modal).toContain('btn-save-china-batch');
  });

  it('the tab warns when the estimate of the weights and the waybill disagree', () => {
    expect(tab).toContain('weightFactor');
    expect(tab).toContain('Если знаете вес коробки');
  });
});
