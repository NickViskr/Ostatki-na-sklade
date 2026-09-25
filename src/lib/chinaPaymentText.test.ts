import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseChinaPaymentText, chinaDateFromText } from './chinaPaymentText';

const TODAY = new Date(2026, 8, 24); // 24.09.2026

describe('сообщение об оплате', () => {
  it('reads the sentence the owner said he would write', () => {
    expect(parseChinaPaymentText('сегодня оплатил 100000 руб по курсу 12,4', TODAY)).toEqual({
      date: '', amountRub: 100000, rate: 12.4, amountCny: 0,
      comment: 'сегодня оплатил 100000 руб по курсу 12,4', matched: true
    });
  });

  it('the comment is the owner\'s sentence trimmed, not padded with stray spaces', () => {
    expect(parseChinaPaymentText('  оплатил 100000 руб по курсу 12,4  ', TODAY).comment)
      .toBe('оплатил 100000 руб по курсу 12,4');
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
      date: '', amountRub: 100000, rate: 12.4, amountCny: 0,
      comment: 'сегодня оплатил 100000 руб по курсу 12,4 руб за 1 юань', matched: true
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

  it('does not take a rate written with a dot, «12.4», as a day and a month', () => {
    // The rate is cut out of the sentence before the date is looked for — otherwise «12.4» would
    // be read as the 12th of April.
    expect(parseChinaPaymentText('оплатил 100000 р по курсу 12.4 ₽ за юань', TODAY).date).toBe('');
  });

  // Item 81g, owner's live check of 2026-09-25: a date written out in full was left blank, and
  // the owner's own sentence was thrown away instead of becoming the comment. Real sentences,
  // every figure checked so a date or a comment word can never turn into money by mistake.
  describe('every real-looking sentence the owner might actually type', () => {
    it('a word month with no year', () => {
      const sentence = '20 августа оплатил 331303,20 руб по курсу 12,4';
      expect(parseChinaPaymentText(sentence, TODAY)).toMatchObject({
        date: '2026-08-20', amountRub: 331303.2, rate: 12.4, comment: sentence
      });
    });

    it('the rate phrased in full, the date trailing at the end', () => {
      const sentence = 'оплатил 100 000 р по курсу 12,4 руб за 1 юань 16.09.2026';
      expect(parseChinaPaymentText(sentence, TODAY)).toMatchObject({
        date: '2026-09-16', amountRub: 100000, rate: 12.4, amountCny: 0, comment: sentence
      });
    });

    it('«вчера», and rubles written with no space before the ₽ sign', () => {
      const sentence = 'вчера перевел 92541,2₽ курс 12,4';
      expect(parseChinaPaymentText(sentence, TODAY)).toMatchObject({
        date: '2026-09-23', amountRub: 92541.2, rate: 12.4, comment: sentence
      });
    });

    it('«от», a slash date with no year, and a rate whose tail names no currency', () => {
      const sentence = 'от 18/09 оплата 116600 рублей по курсу 12,5 за доставку и товар';
      expect(parseChinaPaymentText(sentence, TODAY)).toMatchObject({
        date: '2026-09-18', amountRub: 116600, rate: 12.5, comment: sentence
      });
    });

    it('the owner\'s own misspelt month still reads, and the order number is not taken for money', () => {
      const sentence = '25 сентябяр 2026 оплатил 25000 руб по курсу 13,4 это был аванс под 31 заказ';
      expect(parseChinaPaymentText(sentence, TODAY)).toMatchObject({
        date: '2026-09-25', amountRub: 25000, rate: 13.4, comment: sentence
      });
    });

    it('a word month with no year, one word earlier than the misspelt one above', () => {
      const sentence = '18 сентября оплатил 25000 руб по курсу 13,4';
      expect(parseChinaPaymentText(sentence, TODAY)).toMatchObject({
        date: '2026-09-18', amountRub: 25000, rate: 13.4, comment: sentence
      });
    });
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

  it('reads a word month, with and without the year, and any case ending', () => {
    expect(chinaDateFromText('20 августа', TODAY)).toBe('2026-08-20');
    expect(chinaDateFromText('20 августа 2026', TODAY)).toBe('2026-08-20');
    expect(chinaDateFromText('20 авг', TODAY)).toBe('2026-08-20');
    expect(chinaDateFromText('20 декабря', TODAY)).toBe('2025-12-20'); // in the future this year — last year instead
  });

  it('tolerates a misspelt month ending, matching by the stem alone', () => {
    expect(chinaDateFromText('25 сентябяр 2026', TODAY)).toBe('2026-09-25');
  });

  it('«марта» is read as March, not as May with a stray tail — the two stems must not collide', () => {
    expect(chinaDateFromText('20 марта 2026', TODAY)).toBe('2026-03-20');
    expect(chinaDateFromText('20 мая 2026', TODAY)).toBe('2026-05-20');
  });

  it('reads a dotted, slashed or dashed date, with a two-digit or absent year', () => {
    expect(chinaDateFromText('20.08.2026г', TODAY)).toBe('2026-08-20');
    expect(chinaDateFromText('20/08/2026', TODAY)).toBe('2026-08-20');
    expect(chinaDateFromText('20/08', TODAY)).toBe('2026-08-20');
    expect(chinaDateFromText('20-08-2026', TODAY)).toBe('2026-08-20');
    expect(chinaDateFromText('от 20.08', TODAY)).toBe('2026-08-20');
  });

  it('reads «вчера» and «позавчера», «позавчера» never read as «вчера»', () => {
    expect(chinaDateFromText('вчера', TODAY)).toBe('2026-09-23');
    expect(chinaDateFromText('позавчера', TODAY)).toBe('2026-09-22');
  });

  it('«сегодня» names no date of its own — same as saying nothing about a date', () => {
    expect(chinaDateFromText('сегодня', TODAY)).toBe('');
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

  // Item 81g, owner's live check of 2026-09-25: the parsed sentence used to fill only the
  // numbers, throwing away the owner's own words and staying silent when it found no date.
  it('the parsed sentence fills the comment, unless the owner already typed one himself', () => {
    expect(card).toContain('if (!comment.trim()) setComment(parsed.comment);');
  });

  it('a sentence with no date warns instead of silently leaving today', () => {
    expect(card).toContain("toast.warning('Дата не найдена — проверьте поле даты, стоит сегодняшняя');");
    const readText = (card.split('const readText = () => {')[1] || '').split('const add = async')[0];
    expect(readText).toMatch(/if \(parsed\.date\) \{[\s\S]*toast\.success/);
  });

  // Item 81g, owner's live check of 2026-09-25: «общий список заказов должен сворачиваться и по
  // умолчанию должен быть свернут».
  it('the orders table is collapsible and starts collapsed', () => {
    expect(card).toContain('btn-china-orders-toggle');
    expect(card).toContain('useState(() => readOrdersOpen(username))');
    expect(card).toContain('Заказы по отчёту ({orders.length})');
    // The count and the advance warning still show while the table itself stays hidden.
    expect(card).toMatch(/!ordersOpen && orders\.some\(\(o\) => o\.advanceWarning\)/);
  });

  it('the collapse choice is remembered per viewer, and never crashes without localStorage', () => {
    expect(card).toContain('try {');
    // With nothing saved yet (or a viewer who has never touched it), '1' is the only value that
    // opens the table — anything else, including a missing key, leaves it collapsed.
    expect(card).toContain("localStorage.getItem(ORDERS_OPEN_KEY(username)) === '1'");
    expect(card).toContain('localStorage.setItem(ORDERS_OPEN_KEY(username)');
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
