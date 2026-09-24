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

// Item 81d/81g. Wiring guards: the payments card and the store agree on the CONTRACT's own
// action names — server.ts and ChinaOrders.gs are built in parallel and are not read here.
describe('подключение оплат', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
  const card = read('src/components/ChinaPaymentsCard.tsx');
  const tab = read('src/components/ChinaOrdersTab.tsx');
  const store = read('src/store/useChinaStore.ts');

  it('the card reads the owner’s sentence and sends the payment as one action', () => {
    expect(card).toContain('parseChinaPaymentText(text)');
    expect(card).toContain('btn-china-payment-parse');
    expect(card).toContain('btn-china-payment-add');
    expect(card).toContain('savePayment({');
    expect(store).toContain("callChina('saveChinaPayment'");
  });

  it('item 81g: a payment carries no order and no purpose any more, only date, rubles, rate and comment', () => {
    const add = (card.split('const add = async () => {')[1] || '').split('const match = async')[0];
    expect(add).toContain('date: date.trim()');
    expect(add).toContain('amountRub: chinaNumber(amountRub)');
    expect(add).toContain('rate: chinaNumber(rate)');
    expect(add).toContain('comment: comment.trim()');
    expect(add).not.toMatch(/purpose|orderNo|confirmed/);
  });

  it('item 81g: matching a payment to a receipt, and undoing it, go through the store', () => {
    expect(card).toContain('matchChinaPayment');
    expect(card).toContain('unmatchChinaPayment');
    expect(store).toContain("callChina('matchChinaPayment'");
    expect(store).toContain("callChina('unmatchChinaPayment'");
  });

  it('item 81g: a report file alone imports through the same store action a batch import uses', () => {
    expect(store).toContain("callChina('saveChinaReport'");
    expect(tab).toContain('saveChinaReportAction(');
    // Item 81g, step 7: the AI safety net may override `source`/`aiReason` of the payload the
    // parser built — the payload itself still comes from the one shared builder, not a second copy.
    expect(tab).toContain('chinaReportPayload(report)');
  });

  it('item 81g: the store reads getChinaMoney and refreshes it after every write', () => {
    expect(store).toContain("callChina('getChinaMoney')");
    expect(store).toContain('fetchChinaMoney()');
  });

  it('the card works out no cost of its own — only the pool figures the script sent back', () => {
    expect(card).not.toMatch(/costRub|unitRub|freightShareCny/);
  });

  it('a sentence without a date does not inherit the date of the payment before (review)', () => {
    expect(card).toContain('setDate(parsed.date);');
    expect(card).not.toContain('if (parsed.date) setDate(parsed.date);');
    expect(card).toContain("setText(''); setDate('');");
  });

  it('the batch card says where its rate came from and what the report says about the order', () => {
    expect(tab).toContain('batch.rubRateSource');
    expect(tab).toContain('По отчёту китайцев по заказу');
    expect(tab).toContain('chinaRateStatusText(batch.rubRateSource');
    expect(tab).toContain('<ChinaPaymentsCard />');
  });

  it('item 81g: the batch card shows the two rates and the owner’s own mark of closed RF costs', () => {
    expect(tab).toContain('Курс перевозки');
    expect(tab).toContain('setChinaRubCostsDone(batch.id');
    expect(tab).toContain('chinaCheckMark(batch.checkMark');
  });
});
