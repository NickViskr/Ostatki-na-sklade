/**
 * Item 81d: an owner's own sentence about a payment, turned into the three figures a payment
 * is made of.
 *
 * «сегодня оплатил 100000 руб по курсу 12,4» is how the owner said he would write it, and the
 * whole point is that he should not have to fill a form instead. The sentence is read here
 * rather than by a language model: what it holds is money, the shapes are few, and a parser
 * either understands the sentence or says plainly that it did not.
 *
 * Read in this order — the rate first, then the yuan, and the rubles out of what is left —
 * because «по курсу 12,4» is a number too, and taking it for the amount would be a silent and
 * expensive mistake.
 */

const NUMBER = '(\\d[\\d\\s\\u00a0]*(?:[.,]\\d+)?)';

export interface ChinaPaymentFromText {
  /** '' when the sentence does not name a date: the day of the payment is then today. */
  date: string;
  amountRub: number;
  rate: number;
  amountCny: number;
  /** The owner's own sentence, trimmed as typed — the card fills it into the comment field
   * unless one is already there by hand, so nothing he wrote is lost. */
  comment: string;
  /** false when nothing of a payment could be made out of the sentence. */
  matched: boolean;
}

const toNumber = (raw: string): number => {
  const text = String(raw || '').replace(/[\s ]/g, '').replace(',', '.');
  const value = Number(text);
  return isFinite(value) ? value : 0;
};

const pad = (n: number): string => String(n).padStart(2, '0');

const isoOf = (year: number, month: number, day: number): string => `${year}-${pad(month)}-${pad(day)}`;

/** «20» stated with no year: the owner means a day already past, never one still to come, so a
 * day/month that would land in the future is read as the same day of LAST year instead. */
const yearOfDayMonth = (day: number, month: number, today: Date): number => {
  const thisYear = today.getFullYear();
  const candidate = new Date(thisYear, month - 1, day);
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return candidate.getTime() > todayMidnight.getTime() ? thisYear - 1 : thisYear;
};

const yearOf = (stated: string | undefined, day: number, month: number, today: Date): number => {
  if (!stated) return yearOfDayMonth(day, month, today);
  const value = Number(stated);
  return value < 100 ? 2000 + value : value;
};

// Three-letter stems (two for «май», the shortest month name): every case ending and every
// abbreviation the owner might type («августа», «авг», «авг.») is the stem plus [а-я]*, so one
// entry covers all of them. «мар» is listed before «ма» on purpose — «марта» must match the
// March stem before the May stem gets a chance at its first two letters.
const MONTHS: Record<string, number> = {
  янв: 1, фев: 2, мар: 3, апр: 4, ма: 5, июн: 6, июл: 7, авг: 8, сен: 9, окт: 10, ноя: 11, дек: 12
};
const MONTH_STEMS = ['янв', 'фев', 'мар', 'апр', 'ма', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/**
 * A date the owner may put in front, in any of the shapes he actually writes:
 * 2026-09-24 (ISO), 24.09.2026 / 24.09.26 / 24.09, the same with «/» or «-» instead of the dot,
 * a word month («24 сентября», «24 сентября 2026», «24 сен»), or «вчера» / «позавчера».
 *
 * «сегодня» names no date of its own — the field is already blank and read as today, exactly as
 * when nothing about a date is said at all, so it is not matched here on purpose.
 */
export function chinaDateFromText(text: string, today: Date): string {
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return isoOf(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // «позавчера» contains «вчера» as a substring, so it must be tried first — otherwise the
  // engine would match «вчера» inside it and read the day before yesterday as yesterday.
  if (/позавчера/i.test(text)) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 2);
    return isoOf(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  if (/вчера/i.test(text)) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    return isoOf(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }

  const wordMonth = text.match(new RegExp(
    `(\\d{1,2})\\s+(${MONTH_STEMS.join('|')})[а-я]*\\.?\\s*(\\d{2,4})?`, 'i'));
  if (wordMonth) {
    const day = Number(wordMonth[1]);
    const month = MONTHS[wordMonth[2].toLowerCase()];
    if (day >= 1 && day <= 31) return isoOf(yearOf(wordMonth[3], day, month, today), month, day);
  }

  const dotted = text.match(/(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{2,4}))?/);
  if (dotted) {
    const day = Number(dotted[1]);
    const month = Number(dotted[2]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return isoOf(yearOf(dotted[3], day, month, today), month, day);
    }
  }
  return '';
}

export function parseChinaPaymentText(text: string, today: Date = new Date()): ChinaPaymentFromText {
  const source = String(text || '');
  const empty: ChinaPaymentFromText = { date: '', amountRub: 0, rate: 0, amountCny: 0, comment: '', matched: false };
  if (source.trim() === '') return empty;

  let rest = source;

  // The rate, with the whole phrase it lives in: «по курсу 12,4» and also the owner's full
  // «по курсу 12,4 руб за 1 юань». The tail matters: left in the text, its «руб» would make
  // 12,4 look like the payment and its «1 юань» like the sum the Chinese side confirmed — and
  // the two would then contradict each other and the payment would be refused.
  let rate = 0;
  const rateMatch = rest.match(new RegExp(
    'курс[а-я]*\\s*[:-]?\\s*' + NUMBER +
    '(?:\\s*(?:руб[а-я]*|₽|р\\.?))?' +
    '(?:\\s*за\\s*\\d*\\s*(?:юан[а-я]*|¥))?', 'i'));
  if (rateMatch) {
    rate = toNumber(rateMatch[1]);
    rest = rest.replace(rateMatch[0], ' ');
  }

  // The yuan the Chinese side confirmed: «получили 8064,52 юаня», «8064.52 ¥».
  let amountCny = 0;
  const cnyMatch = rest.match(new RegExp(NUMBER + '\\s*(?:юан[а-я]*|¥|cny)', 'i'));
  if (cnyMatch) {
    amountCny = toNumber(cnyMatch[1]);
    rest = rest.replace(cnyMatch[0], ' ');
  }

  // The rubles: with their word if it is there, otherwise the largest number left — a payment
  // is always the biggest figure in such a sentence.
  let amountRub = 0;
  const rubMatch = rest.match(new RegExp(NUMBER + '\\s*(?:руб[а-я]*|р\\.?|₽|rub)(?![а-я])', 'i'));
  if (rubMatch) {
    amountRub = toNumber(rubMatch[1]);
  } else {
    const dateLike = rest.match(/\d{1,2}\.\d{1,2}(?:\.\d{2,4})?|\d{4}-\d{2}-\d{2}/g) || [];
    let withoutDates = rest;
    dateLike.forEach((d) => { withoutDates = withoutDates.replace(d, ' '); });
    const numbers = withoutDates.match(new RegExp(NUMBER, 'g')) || [];
    numbers.forEach((raw) => {
      const value = toNumber(raw);
      if (value > amountRub) amountRub = value;
    });
  }

  // The date is read from what is left once the rate and the confirmed yuan are cut out — a rate
  // written with a dot, «12.4», is otherwise a day and a month («12.04») in disguise.
  const date = chinaDateFromText(rest, today);
  const matched = amountRub > 0 && (rate > 0 || amountCny > 0);
  return { date, amountRub, rate, amountCny, comment: source.trim(), matched };
}
