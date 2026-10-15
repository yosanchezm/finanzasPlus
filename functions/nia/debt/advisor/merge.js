import { findDebt, fold } from '../findDebt.js';

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

// `kindStated` only tells `isOtherDebt` how to read the kind of a message; it is not part of the case.
function withoutMarker(extracted) {
  const rest = { ...extracted };
  delete rest.kindStated;
  return rest;
}

/**
 * @param {(object | null)} stored The case in the pending (with its `asked` and `unknown` lists), or null for the first message.
 * @param {object} extracted `normaliseDebtExtraction(...).setup` of the latest message.
 * @returns {object} A new case. Later non-null values override, nulls fill from the stored case, `kind` stays, and a zero opening balance never overrides.
 */
export function mergeCase(stored, extracted) {
  if (!stored) return { ...withoutMarker(extracted), asked: [], unknown: [] };
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
    ...(stored.adjust ? { adjust: true, adjustKind: pick(extracted.adjustKind, stored.adjustKind), debtRef: text(extracted.debtRef, stored.debtRef), changeOn: pick(extracted.changeOn, stored.changeOn) } : {}),
    mentions: [...(stored.mentions || []), ...(extracted.mentions || []).filter((mention) => !(stored.mentions || []).includes(mention))],
    asked: stored.asked || [],
    unknown: mergeUnknown(stored, card),
  };
}

// Whether two lender names are the same one: equal once folded, or one holds the other («Bancolombia» and «Bancolombia S.A.»).
function sameLender(a, b) {
  const x = fold(a);
  const y = fold(b);
  return x === y || x.includes(y) || y.includes(x);
}

// An adjustment names its debt in free text: the message is about another registered debt only when its reference resolves to a debt that is
// not the one the open case targets. A reference that matches nothing, or no reference, is not another debt.
function namesAnotherRegistered(stored, extracted, debts, openDebtId) {
  if (!stored.adjust || !text(extracted.debtRef, '')) return false;
  const named = findDebt(debts, extracted.debtRef).match;
  const open = openDebtId || (findDebt(debts, stored.debtRef).match || {}).$id;
  return Boolean(named && open && named.$id !== open);
}

/**
 * Whether a message describes a different debt than the open case (owner decision S6x), so it must not be merged.
 * Only what the message states counts: another lender, another kind the extraction marked as stated (`kindStated`: the kind of a plain answer
 * is only the extraction default), or, for an adjustment, a reference that resolves to another registered debt.
 * @param {object} stored The case in the pending.
 * @param {object} extracted `normaliseDebtExtraction(...).setup` of the latest message.
 * @param {{ debts?: object[], openDebtId?: (string | null) }} [options] `debts`: the registered debts in scope; `openDebtId`: the debt the open adjustment targets, when known.
 * @returns {boolean}
 */
export function isOtherDebt(stored, extracted, { debts = [], openDebtId = null } = {}) {
  if (text(stored.lender, '') && text(extracted.lender, '') && !sameLender(stored.lender, extracted.lender)) return true;
  if (extracted.kindStated === true && extracted.kind !== stored.kind) return true;
  return namesAnotherRegistered(stored, extracted, debts, openDebtId);
}

const DROPPED = ['kindStated', 'openedOn', 'asked', 'unknown'];

/**
 * The extraction of a message without what it did not say (nulls, empty lists, the default `none` system), so it fits next to the open case in
 * the pending. Presets keep their nulls: there a null is «mentioned without an amount».
 * @param {object} extracted `normaliseDebtExtraction(...).setup`.
 * @returns {object} A plain object that `expandCase` turns back into the case.
 */
export function compactCase(extracted) {
  const compact = {};
  for (const [key, value] of Object.entries(extracted)) {
    if (DROPPED.includes(key) || value === null || value === undefined || value === '') continue;
    if (key === 'system' && value === 'none') continue;
    if (key === 'principalMinor' && value === 0) continue;
    if (key === 'card') {
      const card = Object.fromEntries(Object.entries(value).filter(([, item]) => present(item)));
      if (Object.keys(card).length > 0) compact.card = card;
    } else if (Array.isArray(value)) {
      if (value.length > 0) compact[key] = value;
    } else if (key !== 'presets' || Object.keys(value).length > 0) compact[key] = value;
  }
  return compact;
}

/**
 * The case a `compactCase` result stands for: every field the message did not say is back to the value the extraction gives it.
 * @param {object} compact
 * @param {string} today `YYYY-MM-DD` of the new case's opening date.
 */
export function expandCase(compact, today) {
  const scheduled = compact.kind !== 'card' && compact.kind !== 'informal';
  return {
    name: '',
    lender: '',
    principalMinor: compact.kind === 'card' ? 0 : null,
    openedOn: today,
    rate: null,
    rateValue: null,
    n: null,
    periodicity: null,
    system: scheduled ? null : 'none',
    firstDueOn: null,
    presets: {},
    charges: [],
    lateStated: null,
    mentions: [],
    ...(compact.adjust ? { adjustKind: null, debtRef: null, changeOn: null } : {}),
    ...compact,
    card: { statementDay: null, dueDay: null, minRule: null, minPct: null, minFloorMinor: null, ...compact.card },
  };
}
