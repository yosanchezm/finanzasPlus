import { fold } from '../findDebt.js';

// Merges a later answer into the stored case (design G13). The pending keeps the merged case, not the history, so a text answer such as
// «el corte es el 15» fills what was asked without re-reading the conversation. Pure and Node 16 safe.

const TRACKED = ['statementDay', 'dueDay', 'minRule'];
const PRESET_KEYS = ['fee', 'iva', 'ivaIncluded', 'life', 'insurance', 'gmf'];

const present = (value) => value !== null && value !== undefined;
const pick = (later, earlier) => (present(later) ? later : earlier);
const text = (later, earlier) => (typeof later === 'string' && later !== '' ? later : earlier);
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

// A number overrides; a missing amount (null) only records that the preset was mentioned and never erases an amount already known.
function mergePresets(earlier = {}, later = {}) {
  const merged = {};
  for (const key of PRESET_KEYS) {
    if (has(later, key) && present(later[key])) merged[key] = later[key];
    else if (has(earlier, key)) merged[key] = earlier[key];
    else if (has(later, key)) merged[key] = later[key];
  }
  return merged;
}

// By folded label: a later charge replaces the earlier one in place, a new one goes last.
function mergeCharges(earlier = [], later = []) {
  const merged = earlier.slice();
  for (const charge of later) {
    const at = merged.findIndex((item) => fold(item.label) === fold(charge.label));
    if (at >= 0) merged[at] = charge;
    else merged.push(charge);
  }
  return merged;
}

function mergeRate(earlier, later) {
  if (present(later.rate)) return { rate: later.rate, rateValue: pick(later.rateValue, later.rate.value) };
  if (present(later.rateValue)) return { rate: null, rateValue: later.rateValue };
  return { rate: earlier.rate ?? null, rateValue: earlier.rateValue ?? null };
}

// Statement day, due day and minimum rule asked once: if the answer gave none of them, they are unknown and creation is blocked. If it gave
// some, the rest stay open to be asked again. A field that is answered stops being unknown.
function mergeUnknown(earlier, card) {
  const asked = (earlier.asked || []).filter((field) => TRACKED.includes(field));
  const answered = asked.filter((field) => present(card[field]) && card[field] !== 'unknown');
  const kept = (earlier.unknown || []).filter((field) => !present(card[field]) || card[field] === 'unknown');
  if (asked.length === 0 || answered.length > 0) return kept;
  const added = asked.filter((field) => !present(card[field]) && !kept.includes(field));
  return [...kept, ...added];
}

/**
 * @param {(object | null)} stored The case in the pending (with its `asked` and `unknown` lists), or null for the first message.
 * @param {object} extracted `normaliseDebtExtraction(...).setup` of the latest message.
 * @returns {object} A new case. Later non-null values override, nulls fill from the stored case, `kind` stays, and a zero opening balance never overrides.
 */
export function mergeCase(stored, extracted) {
  if (!stored) return { ...extracted, asked: [], unknown: [] };
  const card = {};
  for (const field of ['statementDay', 'dueDay', 'minRule', 'minPct', 'minFloorMinor']) card[field] = pick(extracted.card && extracted.card[field], stored.card && stored.card[field]);
  return {
    kind: stored.kind,
    name: text(extracted.name, stored.name),
    lender: text(extracted.lender, stored.lender),
    principalMinor: extracted.principalMinor > 0 ? extracted.principalMinor : stored.principalMinor,
    openedOn: stored.openedOn,
    ...mergeRate(stored, extracted),
    n: pick(extracted.n, stored.n),
    periodicity: pick(extracted.periodicity, stored.periodicity),
    system: stored.kind === 'card' ? 'none' : pick(extracted.system, stored.system),
    firstDueOn: pick(extracted.firstDueOn, stored.firstDueOn),
    card,
    presets: mergePresets(stored.presets, extracted.presets),
    charges: mergeCharges(stored.charges, extracted.charges),
    lateStated: pick(extracted.lateStated, stored.lateStated),
    mentions: [...(stored.mentions || []), ...(extracted.mentions || []).filter((mention) => !(stored.mentions || []).includes(mention))],
    asked: stored.asked || [],
    unknown: mergeUnknown(stored, card),
  };
}
