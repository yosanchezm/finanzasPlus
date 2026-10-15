import { compareIso, isIsoDate } from '../calendar.js';
import { ValidationError } from '../errors.js';
import { modalityOf } from '../late/policy.js';
import { termsOfDebt, validateTerms } from '../terms.js';
import { activeEvents, normalizeCorrectionFields, readEvents, sortEvents } from './events.js';

// terms_correction (DL1 to DL4, G9 to G11): data that was wrong from the start. A correction is bound to the
// terms version in force when it was recorded ('opening' or a restructure id) and applies as if it had held
// from the start of that version. It is folded into the terms before the replay, so the projectors never see it.

const isCorrection = (event) => event.kind === 'terms_correction';
const OPENING = 'opening';

/**
 * Applies correction fields to terms and returns validated terms. Pure: the input is not touched.
 * @param {object} terms Validated DebtTerms.
 * @param {{ rate?: object, modality?: string, card?: object }} fields Normalized correction fields.
 * @returns {object} Validated DebtTerms.
 * @throws {ValidationError} `correction_not_applicable` for card fields on another kind of debt, otherwise what `validateTerms` throws
 */
export function applyCorrection(terms, fields) {
  if (fields.card !== undefined && terms.kind !== 'card') {
    throw new ValidationError('correction_not_applicable', 'statement day, due day and minimum payment only exist on a card');
  }
  const next = { ...terms };
  if (fields.rate !== undefined) next.rate = fields.rate;
  if (fields.modality !== undefined) next.modality = fields.modality;
  if (fields.card !== undefined) {
    const { minPayment, ...days } = fields.card;
    next.card = { ...terms.card, ...days, minPayment: { ...terms.card.minPayment, ...minPayment } };
  }
  return validateTerms(next);
}

// Folds corrections one after another (the later one wins per field). One that no longer validates is skipped.
function foldInto(terms, corrections) {
  let next = terms;
  const used = [];
  const skipped = [];
  for (const event of corrections) {
    try {
      next = applyCorrection(next, event.payload.fields);
      used.push(event);
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      skipped.push({ eventId: event.id, reason: 'invalid' });
    }
  }
  return { terms: next, used, skipped };
}

function byTarget(corrections) {
  const targets = new Map();
  for (const event of corrections) {
    const list = targets.get(event.payload.appliesTo) ?? [];
    list.push(event);
    targets.set(event.payload.appliesTo, list);
  }
  return targets;
}

/**
 * Folds the active corrections (every date: a correction is retroactive, and voids are honoured whatever their date)
 * into the opening terms and hands the restructure-bound ones to their restructure event as `corrections`.
 * Internal: not exported by the package barrel.
 * @param {object} terms The opening terms of the debt.
 * @param {object[]} known Normalized events of every date and kind.
 * @returns {{ terms: object, events: object[], bound: Map<string, object[]>, applied: Array<{ eventId: string, appliesTo: string }>,
 *   skipped: Array<{ eventId: string, reason: string }> }} `events` is `known` without the corrections; `bound` maps a restructure id to the
 *   fields of its corrections, in order (see `attachBound`).
 */
export function foldCorrections(terms, known) {
  if (!known.some(isCorrection)) return { terms, events: known, bound: new Map(), applied: [], skipped: [] };
  const active = sortEvents(activeEvents(known));
  const targets = byTarget(active.filter(isCorrection));
  const opening = foldInto(terms, targets.get(OPENING) ?? []);
  const applied = opening.used.map((event) => ({ eventId: event.id, appliesTo: OPENING }));
  const skipped = opening.skipped.slice();
  const bound = new Map();
  for (const event of active) {
    if (event.kind !== 'restructure' || !targets.has(event.id)) continue;
    const folded = foldInto(event.payload.terms, targets.get(event.id));
    bound.set(event.id, folded.used.map((entry) => entry.payload.fields));
    for (const entry of folded.used) applied.push({ eventId: entry.id, appliesTo: event.id });
    skipped.push(...folded.skipped);
  }
  const alive = new Set(active.filter((event) => event.kind === 'restructure').map((event) => event.id));
  for (const [target, list] of targets) {
    if (target !== OPENING && !alive.has(target)) for (const event of list) skipped.push({ eventId: event.id, reason: 'restructure_voided' });
  }
  const order = new Map(active.map((event, index) => [event.id, index]));
  const byOrder = (a, b) => order.get(a.eventId) - order.get(b.eventId);
  return { terms: opening.terms, events: known.filter((event) => !isCorrection(event)), bound, applied: applied.sort(byOrder), skipped: skipped.sort(byOrder) };
}

/**
 * Hands each restructure its bound corrections as `corrections`, for `applyRestructure`. Runs on the sorted active events,
 * because normalizing an event again drops fields it does not know. Internal: not exported by the package barrel.
 * @param {object[]} events Normalized active events.
 * @param {Map<string, object[]>} bound From `foldCorrections`.
 * @returns {object[]}
 */
export function attachBound(events, bound) {
  if (bound.size === 0) return events;
  return events.map((event) => (bound.has(event.id) ? { ...event, corrections: bound.get(event.id) } : event));
}

// The terms of one version (opening, or the restructure with that id) with its active corrections.
function termsOfVersion(debt, active, appliesTo) {
  const corrections = active.filter((event) => isCorrection(event) && event.payload.appliesTo === appliesTo);
  if (appliesTo === OPENING) return foldInto(termsOfDebt(debt), corrections).terms;
  const restructure = active.find((event) => event.kind === 'restructure' && event.id === appliesTo);
  if (!restructure) throw new ValidationError('correction_target_missing', `the restructure ${appliesTo} does not exist or was voided`);
  return foldInto(restructure.payload.terms, corrections).terms;
}

/**
 * The terms version a correction recorded on `on` belongs to, with the corrections already in force: the opening
 * terms, or the terms of the last active restructure dated on or before `on`. This is what a correction is compared
 * with (`projection.terms` also carries later rate changes). Internal: not exported by the package barrel.
 * @param {object} debt A `debts` row.
 * @param {object[]} events The debt's `debt_events` rows.
 * @param {string} on `YYYY-MM-DD`.
 * @returns {{ appliesTo: string, terms: object }}
 */
export function versionTermsAt(debt, events, on) {
  const active = sortEvents(activeEvents(readEvents(events).known));
  const restructures = active.filter((event) => event.kind === 'restructure' && compareIso(event.effectiveOn, on) <= 0);
  const appliesTo = restructures.length > 0 ? restructures[restructures.length - 1].id : OPENING;
  return { appliesTo, terms: termsOfVersion(debt, active, appliesTo) };
}

const sameRate = (a, b) => a.value === b.value && a.basis === b.basis && a.periodicity === b.periodicity && a.timing === b.timing;

/**
 * The values `fields` names, read from `terms` in the same shape. Pure.
 * @param {object} terms Validated DebtTerms.
 * @param {{ rate?: object, modality?: string, card?: object }} fields
 * @returns {{ rate?: object, modality?: string, card?: object }}
 */
export function correctionValues(terms, fields) {
  const values = {};
  if (fields.rate !== undefined) values.rate = terms.rate;
  if (fields.modality !== undefined) values.modality = modalityOf(terms);
  if (fields.card !== undefined && terms.card !== undefined) {
    values.card = {};
    for (const key of ['statementDay', 'dueDay']) if (fields.card[key] !== undefined) values.card[key] = terms.card[key];
    if (fields.card.minPayment !== undefined) {
      values.card.minPayment = {};
      for (const key of Object.keys(fields.card.minPayment)) values.card.minPayment[key] = terms.card.minPayment[key];
    }
  }
  return values;
}

// Only the parts of `fields` that differ from `terms`, in the same shape.
function changedParts(terms, fields) {
  const current = correctionValues(terms, fields);
  const changed = {};
  if (fields.rate !== undefined && !sameRate(fields.rate, current.rate)) changed.rate = fields.rate;
  if (fields.modality !== undefined && fields.modality !== current.modality) changed.modality = fields.modality;
  if (fields.card !== undefined) {
    const card = {};
    for (const key of ['statementDay', 'dueDay']) if (fields.card[key] !== undefined && fields.card[key] !== current.card[key]) card[key] = fields.card[key];
    const minPayment = {};
    for (const key of Object.keys(fields.card.minPayment ?? {})) {
      if (fields.card.minPayment[key] !== current.card.minPayment[key]) minPayment[key] = fields.card.minPayment[key];
    }
    if (Object.keys(minPayment).length > 0) card.minPayment = minPayment;
    if (Object.keys(card).length > 0) changed.card = card;
  }
  return changed;
}

/**
 * Builds the draft of a `terms_correction`: validates the fields, binds the draft to the terms version in force on `on`,
 * keeps only the parts that really change and records the values they replace. Pure and read-only. The draft has the
 * shape `planCommit` and `previewChange` take.
 * @param {object} debt A `debts` row.
 * @param {object[]} events The debt's `debt_events` rows.
 * @param {{ rate?: object, modality?: string, card?: { statementDay?: number, dueDay?: number, minPayment?: { rule?: string, pct?: number, floorMinor?: number } } }} fields
 *   The corrected values; the rate is given as the bank states it (`{ convention, value }` or the structured form).
 * @param {{ on: string }} options `on` is the recording date (the event date), `YYYY-MM-DD`.
 * @returns {{ kind: 'terms_correction', effectiveOn: string, amountMinor: 0, fields: object, previous: object, appliesTo: string }}
 * @throws {ValidationError} `correction_empty`, `correction_unsupported_field`, `correction_not_applicable`, `no_change`,
 *   `invalid_card`, `invalid_rate`, `invalid_terms` or `invalid_date`
 */
export function buildCorrection(debt, events, fields, { on } = {}) {
  if (!isIsoDate(on)) throw new ValidationError('invalid_date', `on must be a real YYYY-MM-DD date, got ${String(on)}`);
  const wanted = normalizeCorrectionFields(fields);
  const { appliesTo, terms } = versionTermsAt(debt, events, on);
  applyCorrection(terms, wanted);
  const changed = changedParts(terms, wanted);
  if (Object.keys(changed).length === 0) throw new ValidationError('no_change', 'the corrected values are the ones already stored');
  return { kind: 'terms_correction', effectiveOn: on, amountMinor: 0, fields: changed, previous: correctionValues(terms, changed), appliesTo };
}

/**
 * Checks a normalized `terms_correction` event against the debt and returns the field values before and after.
 * `planCommit` and `previewChange` call it before projecting, so a correction that cannot be applied writes nothing.
 * Internal: not exported by the package barrel.
 * @param {object} debt A `debts` row.
 * @param {object[]} events The debt's stored events (without the candidate).
 * @param {{ payload: { fields: object, appliesTo: string } }} candidate A normalized `terms_correction` event.
 * @returns {{ before: object, after: object }}
 * @throws {ValidationError} `correction_target_missing`, `correction_not_applicable` or what `validateTerms` throws
 */
export function checkCorrection(debt, events, candidate) {
  const { fields, appliesTo } = candidate.payload;
  const terms = termsOfVersion(debt, sortEvents(activeEvents(readEvents(events).known)), appliesTo);
  const corrected = applyCorrection(terms, fields);
  return { before: correctionValues(terms, fields), after: correctionValues(corrected, fields) };
}
