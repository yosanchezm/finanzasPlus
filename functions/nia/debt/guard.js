// Numeric guard of the advice paraphrase (NDA-6, DPA-3). Gemini may reword the structured
// `facts`, but it must not introduce a figure of its own: any number in the reply that is not
// in the facts rejects the reply and the caller sends the deterministic template instead.
// Pure and Node 16 safe.

export const MAX_REPLY = 4096;

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
 * Accepts a paraphrase only when it is text of at most 4096 characters and every number in it
 * appears in `facts` (its figures, dates and notices). Words are not checked: the guard is about figures.
 * @param {unknown} reply The model's text.
 * @param {object} facts `advise(...).facts`.
 * @param {string[]} [extra] Texts whose numbers are also allowed (for example the debt's own name).
 * @returns {(string | null)} The trimmed reply, or `null` when the caller must use the template.
 */
export function guardParaphrase(reply, facts, extra = []) {
  if (typeof reply !== 'string') return null;
  const text = reply.trim();
  if (text === '' || text.length > MAX_REPLY) return null;
  const allowed = allowedNumbers(facts, extra);
  return numbersIn(text).every((number) => allowed.has(number)) ? text : null;
}
