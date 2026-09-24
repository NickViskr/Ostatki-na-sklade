import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseChinaPaymentText, chinaDateFromText } from './chinaPaymentText';

const TODAY = new Date(2026, 8, 24); // 24.09.2026

describe('сообщение об оплате', () => {
  it('reads the sentence the owner said he would write', () => {
    expect(parseChinaPaymentText('сегодня оплатил 100000 руб по курсу 12,4', TODAY)).toEqual({
      date: '', amountRub: 100000, rate: 12.4, amountCny: 0, matched: true
    });
  });

  it('is not fooled into taking the rate for the amount', () => {
    const parsed = parseChinaPaymentText('оплатил по курсу 12,4 сумму 100000 р', TODAY);
    expect(parsed.rate).toBe(12.4);
    expect(parsed.amountRub).toBe(100000);
  });

  it('reads the owner’s own full phrasing, where the RATE also carries the word «руб»', () => {
    // «по курсу 12,4 руб за 1 юань» — the first «number + руб» in the sentence is the rate, not the
    // payment, and reading it as the payment would put 12,4 ₽ into the wallet.
    expect(parseChinaPaymentText('сегодня оплатил 100000 руб по курсу 12,4 руб за 1 юань', TODAY)).toEqual({
      date: '', amountRub: 100000, rate: 12.4, amountCny: 0, matched: true
    });
    // «за 1 юань» is part of the rate, not a sum of one yuan the Chinese side confirmed.
    expect(parseChinaPaymentText('оплатил 100000 р по курсу 12.4 ₽ за юань', TODAY).amountCny).toBe(0);
  });

  it('takes the payment and not some other number of the sentence', () => {
    expect(parseChinaPaymentText('оплата за 2 партии 50000 курс 13', TODAY)).toMatchObject({
      amountRub: 50000, rate: 13
    });
  });

  it('reads the yuan written with the sign', () => {
    expect(parseChinaPaymentText('оплатил 100000 руб, зачли 8064,52 ¥', TODAY).amountCny).toBe(8064.52);
  });

  it('reads a sum written with spaces', () => {
    expect(parseChinaPaymentText('оплатил 100 000 рублей по курсу 12.4', TODAY).amountRub).toBe(100000);
  });

  it('reads the yuan when the report confirmed them instead of a rate', () => {
    const parsed = parseChinaPaymentText('оплатил 100000 рублей, китайцы получили 8064,52 юаня', TODAY);
    expect(parsed.amountRub).toBe(100000);
    expect(parsed.amountCny).toBe(8064.52);
    expect(parsed.rate).toBe(0);
    expect(parsed.matched).toBe(true);
  });

  it('takes the largest number for the payment when the word «рубли» is missing', () => {
    expect(parseChinaPaymentText('оплата 50000 курс 13', TODAY)).toMatchObject({ amountRub: 50000, rate: 13 });
  });

  it('reads the date the owner put in front, in every shape he writes it', () => {
    expect(parseChinaPaymentText('24.09.2026 оплатил 50000 по курсу 13', TODAY).date).toBe('2026-09-24');
    expect(parseChinaPaymentText('оплата 03.09.26 на 50000 руб по курсу 13', TODAY).date).toBe('2026-09-03');
    expect(parseChinaPaymentText('3.9 оплатил 50000 руб по курсу 13', TODAY).date).toBe('2026-09-03');
    expect(parseChinaPaymentText('2026-09-24 оплатил 50000 руб по курсу 13', TODAY).date).toBe('2026-09-24');
  });

  it('does not take a date for the payment', () => {
    // 24.09.2026 holds the number 2026, which must not become the amount.
    expect(parseChinaPaymentText('24.09.2026 оплата 1500 курс 12', TODAY).amountRub).toBe(1500);
  });

  it('says plainly that it understood nothing', () => {
    expect(parseChinaPaymentText('', TODAY).matched).toBe(false);
    expect(parseChinaPaymentText('надо будет заплатить китайцам', TODAY).matched).toBe(false);
    // Rubles without a rate and without confirmed yuan are not yet a payment.
    expect(parseChinaPaymentText('оплатил 100000 руб', TODAY)).toMatchObject({ amountRub: 100000, matched: false });
  });
});

describe('дата из текста', () => {
  it('fills in the current year when the owner leaves it out', () => {
    expect(chinaDateFromText('оплата 3.9', TODAY)).toBe('2026-09-03');
  });

  it('is empty when there is no date at all', () => {
    expect(chinaDateFromText('оплатил сегодня', TODAY)).toBe('');
  });

  it('ignores a day or a month that cannot exist', () => {
    expect(chinaDateFromText('45.13.2026', TODAY)).toBe('');
  });
});

// Item 81d. Wiring guards: the payments card, the store, the proxy and the script agree.
describe('подключение оплат', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
  const card = read('src/components/ChinaPaymentsCard.tsx');
  const tab = read('src/components/ChinaOrdersTab.tsx');
  const store = read('src/store/useChinaStore.ts');
  const server = read('server.ts');
  const script = read('ChinaOrders.gs');

  it('the card reads the owner\u2019s sentence and sends the payment as one action', () => {
    expect(card).toContain('parseChinaPaymentText(text)');
    expect(card).toContain('btn-china-payment-parse');
    expect(card).toContain('btn-china-payment-add');
    expect(card).toContain('savePayment({');
    expect(store).toContain("callChina('saveChinaPayment'");
    expect(script).toContain('function saveChinaPayment(');
  });

  it('a payment is tied to an order, because that is what gives a batch its rate', () => {
    expect(card).toContain('select-china-payment-order');
    expect(card).toContain('orderNo: orderNo.trim()');
    expect(script).toContain('function chinaRateFromPayments(');
    expect(script).toContain('recalcChinaOrders(ss, [orderNo, previousOrder]');
  });

  it('the proxy drops the read after a payment is written', () => {
    expect(server).toContain("saveChinaPayment: ['getChinaBatches']");
    expect(server).toContain("deleteChinaPayment: ['getChinaBatches']");
  });

  it('the card works out no cost of its own \u2014 only the wallet total it shows', () => {
    expect(card).not.toMatch(/costRub|unitRub|freightShareCny/);
    expect(card).toContain('rub / cny');
  });

  it('a sentence without a date does not inherit the date of the payment before (review)', () => {
    expect(card).toContain('setDate(parsed.date);');
    expect(card).not.toContain('if (parsed.date) setDate(parsed.date);');
    expect(card).toContain("setText(''); setDate('');");
  });

  it('a payment already made can be put against its order when the report confirms it (review)', () => {
    expect(card).toContain('select-china-payment-reassign');
    expect(card).toContain('reassign(p, { orderNo: e.target.value })');
    expect(card).toContain('reassign(p, { confirmed: e.target.checked })');
    // The edit goes by id and carries the money unchanged: only its order and its mark move.
    const reassign = card.split('const reassign = ')[1] || '';
    expect(reassign).toContain('id: p.id');
    expect(reassign).toContain('amountRub: p.amountRub');
    expect(reassign).toContain('amountCny: p.amountCny');
  });

  it('the batch card says where its rate came from and what the report says about the order', () => {
    expect(tab).toContain('batch.rubRateSource');
    expect(tab).toContain('По отчёту китайцев по заказу');
    expect(tab).toContain('оплаты не внесены, курс взят вручную');
    expect(tab).toContain('<ChinaPaymentsCard batches={batches} />');
  });
});
