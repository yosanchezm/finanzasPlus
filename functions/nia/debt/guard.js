// Numeric guard of the advice paraphrase (NDA-6, DPA-3). Gemini may reword the structured
// `facts`, but it must not introduce a figure of its own: any number in the reply that is not
// in the facts rejects the reply and the caller sends the deterministic template instead.
// Pure and Node 16 safe.

/** Default cap of every paraphrase: the spec caps any message at 1,200 characters. */
export const MAX_REPLY = 1200;

// Spelled-out Spanish numbers (dos to noventa, cien, hundreds, mil, millon, billon) and number-like words
// (doble, triple, mitad), matched on text folded to lowercase ASCII. «un», «una» and «uno» are articles and are
// not listed. A false rejection only sends the deterministic template, so the cost is safe.
export const NUMBER_WORDS = new RegExp(
  '\\b(?:' +
    [
      'dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince',
      'dieciseis|diecisiete|dieciocho|diecinueve|veinte|veinti[a-z]*',
      'treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa',
      'cien|ciento|(?:dos|tres|cuatro|seis|sete|ocho|nove)cient[oa]s|quinient[oa]s',
      'mil|millon|millones|billon|billones|doble|triple|mitad',
    ].join('|') +
    ')\\b',
);

const fold = (text) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const TOKEN = /\d+(?:[.,]\d+)*/g;

const stripZeros = (digits) => digits.replace(/^0+(?=\d)/, '');

function canonical(token) {
  const dots = (token.match(/\./g) || []).length;
  const commas = (token.match(/,/g) || []).length;
  let integer = token;
  let fraction = '';
  if (dots && commas) {
    // Both kinds present: the last separator is the decimal one ("1.234,50" and "1,234.50").
    const at = Math.max(token.lastIndexOf('.'), token.lastIndexOf(','));
    integer = token.slice(0, at);
    fraction = token.slice(at + 1);
  } else if (dots + commas === 1) {
    // One separator: followed by exactly 3 digits after a 1-3 digit head that does not start with 0 it groups thousands ("100.000").
    const [head, tail] = token.split(/[.,]/);
    if (!(tail.length === 3 && /^[1-9]\d{0,2}$/.test(head))) {
      integer = head;
      fraction = tail;
    }
  }
  const whole = stripZeros(integer.replace(/[.,]/g, ''));
  const decimals = fraction.replace(/0+$/, '');
  return decimals ? `${whole}.${decimals}` : whole;
}

/**
 * Every number written in a text, normalised: thousands separators (`.` or `,`) are dropped,
 * decimals use `.` without trailing zeros, and the percent sign is ignored. A date `2026-10-13`
 * yields its three parts.
 * @param {string} text
 * @returns {string[]}
 */
export function numbersIn(text) {
  return (String(text ?? '').match(TOKEN) || []).map(canonical);
}

function allowedNumbers(facts, extra) {
  const allowed = new Set();
  const add = (value) => numbersIn(value).forEach((number) => allowed.add(number));
  if (facts && typeof facts === 'object') {
    add(facts.asOf);
    Object.values(facts.numbers || {}).forEach(add);
    Object.values(facts.text || {}).forEach(add);
    for (const notice of facts.notices || []) {
      add(notice.asOf);
      add(notice.message);
    }
    add(facts.targetDebt && facts.targetDebt.name);
    add(facts.higherRateDebt && facts.higherRateDebt.name);
  }
  extra.forEach(add);
  return allowed;
}

/**
 * Accepts a paraphrase only when it is text of at most `maxChars` characters (1,200 by default), spells no
 * number out in Spanish and every digit number in it appears in `facts` (its figures, dates and notices).
 * @param {unknown} reply The model's text.
 * @param {object} facts `advise(...).facts`.
 * @param {string[]} [extra] Texts whose numbers are also allowed (for example the debt's own name).
 * @param {{ maxChars?: number }} [options]
 * @returns {(string | null)} The trimmed reply, or `null` when the caller must use the template.
 */
export function guardParaphrase(reply, facts, extra = [], { maxChars = MAX_REPLY } = {}) {
  if (typeof reply !== 'string') return null;
  const text = reply.trim();
  if (text === '' || text.length > maxChars) return null;
  if (NUMBER_WORDS.test(fold(text))) return null;
  const allowed = allowedNumbers(facts, extra);
  return numbersIn(text).every((number) => allowed.has(number)) ? text : null;
}
