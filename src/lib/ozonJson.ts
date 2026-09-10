// ===== Parsing Ozon responses without losing long integers =====
//
// THE DEFECT, found by the owner on production 10.09.2026. Direct supply 2000066179965
// carried cargo_id 1000000000058319036; the file «Состав ГМ поставки» on Google Drive said
// 1000000000058319000, while the label PDF that Ozon draws itself said the true number.
//
// CAUSE. `cargo_id` is int64 in Ozon's API. JSON.parse turns every number into a double,
// which holds integers exactly only up to 2^53 − 1 = 9 007 199 254 740 991 (16 digits).
// A 19-digit cargo_id does not fit, so the digits are gone BEFORE any of our code sees the
// value: `String(cargo_id)` further down the proxy was already stringifying a broken number.
//
// WHY CROSS-DOCK LOOKED HEALTHY. Nothing in the code branches on the supply type — the file
// is built by the same lines for both. Cross-dock supply 2000066179375 simply got the
// 16-digit cargo_id 1022104706512000, which is below the limit and survives. Its trailing
// zeros are Ozon's own, not rounding: the label PDF prints the same digits. So cross-dock is
// not protected, it was lucky, and a longer number would break it too.
//
// THE RULE. The raw response text is scanned before parsing, and an integer literal is
// wrapped in quotes ONLY when it fails to survive the round trip through a double —
// `String(Number(literal)) !== literal`. Anything a double holds exactly is left as a number,
// so nothing that works today can change: the only values that turn into strings are the ones
// that are already wrong.

/** An integer a double no longer holds exactly becomes a string: the digits matter more than the type. */
function isLossyInteger(literal: string): boolean {
  // A double holds -0 fine, but String(Number('-0')) gives '0': an exception, not a loss of precision.
  if (literal === '-0') return false;
  return String(Number(literal)) !== literal;
}

/**
 * Quotes the integer literals of raw JSON that do not survive the trip through a double.
 *
 * Walks the text character by character and knows whether it is inside a string: digits inside
 * a string value are text, not a number, and must never be touched. An escaped pair is copied
 * whole, otherwise `\"` would be read as the end of the string.
 *
 * Fractions and exponent notation are never touched: they are inexact by nature, and turning
 * them into strings would break arithmetic.
 */
export function quoteLossyIntegers(text: string): string {
  const src = String(text || '');
  let out = '';
  let i = 0;
  let inString = false;

  while (i < src.length) {
    const ch = src[i];

    if (inString) {
      out += ch;
      if (ch === '\\') {
        // The escaped pair goes out whole: the next character means nothing on its own.
        i++;
        if (i < src.length) out += src[i];
        i++;
        continue;
      }
      if (ch === '"') inString = false;
      i++;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      i++;
      continue;
    }

    const startsNumber = ch >= '0' && ch <= '9'
      || (ch === '-' && i + 1 < src.length && src[i + 1] >= '0' && src[i + 1] <= '9');
    if (!startsNumber) {
      out += ch;
      i++;
      continue;
    }

    const start = i;
    if (src[i] === '-') i++;
    while (i < src.length && src[i] >= '0' && src[i] <= '9') i++;

    let isInteger = true;
    if (src[i] === '.') {
      isInteger = false;
      i++;
      while (i < src.length && src[i] >= '0' && src[i] <= '9') i++;
    }
    if (src[i] === 'e' || src[i] === 'E') {
      isInteger = false;
      i++;
      if (src[i] === '+' || src[i] === '-') i++;
      while (i < src.length && src[i] >= '0' && src[i] <= '9') i++;
    }

    const literal = src.slice(start, i);
    out += (isInteger && isLossyInteger(literal)) ? '"' + literal + '"' : literal;
  }

  return out;
}

/**
 * JSON.parse, except that long integers arrive as strings instead of rounded numbers.
 * A parse error is not swallowed: an unparsable Ozon response must fail exactly as loudly
 * as it used to fail on res.json().
 */
export function parseOzonJson(text: string): any {
  return JSON.parse(quoteLossyIntegers(text));
}
