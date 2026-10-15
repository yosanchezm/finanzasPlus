import { PERIODICITIES, ValidationError, activeEvents, addExplicitCharge, addPresetCharge, buildRestructureTerms, compareIso, evaluateCharges, isIsoDate, periodDates, previewChange, project, rateLabel, removeCharge, restructureCarry, sortEvents } from '../../../packages/finance-core/index.js';
import { fold } from './findDebt.js';
import { pesos } from './format.js';
import { PERIOD_LABELS, SYSTEM_LABELS, describeCoreError, usuryLines } from './preview.js';

// Plan changes of Nia (NI2, NI3, NI7): `rate_change`, `charge_change` (add a preset or an explicit charge, edit or remove one) and `restructure`. The model only extracts; every
// figure comes from the core's `previewChange`, the same replay the web dialogs use, so a preview equals the
// projection once the event is saved. Nothing here writes. Pure and Node 16 safe.

export const MODES = ['keep_term', 'keep_installment'];
const KEEP_TERM = 'keep_term';
const KEEP_INSTALLMENT = 'keep_installment';

export const BACKDATED_NOTE = 'Los costos de pagos anteriores se actualizarán cuando abras la deuda en la web.';
export const TOO_LOW_NOTE = 'Con la nueva tasa, la cuota actual ya no cubre los intereses o el plan pasaría de 2000 cuotas. Te muestro «mantener el plazo», que recalcula la cuota.';
export const KEEP_TERM_ONLY_NOTE = 'Este sistema mantiene el plazo, así que recalculé la cuota.';
export const TOO_LOW_CONFIRM = 'Con la tasa nueva la cuota actual ya no cubre los intereses o el plan pasaría de 2000 cuotas, así que no registré nada. Pídeme el cambio de nuevo y elige «mantener el plazo».';
const CANNOT_AMORTIZE = 'Con esa tasa el plan no se puede calcular: los intereses superan la cuota o el plan pasaría de 2000 cuotas. Prueba con otra tasa.';
const CANNOT_PREVIEW = 'No pude calcular el cambio con esos datos. Revisa la tasa y la fecha.';
const MODE_LINES = {
  [KEEP_TERM]: 'Se mantiene el plazo: la cuota se recalcula.',
  [KEEP_INSTALLMENT]: 'Se mantiene la cuota: el plazo se recalcula.',
};

/**
 * Reads what the model extracted about a plan change: the effective date (today when not said or not a real date)
 * and the mode (`null` when not said). The rate itself is read by the extractor, which owns the convention rules.
 * @param {object | null} raw The model's `planChange` object.
 * @param {{ today: string }} options
 * @returns {{ effectiveOn: string, mode: (string | null) }}
 */
export function readPlanChange(raw, { today }) {
  const input = raw && typeof raw === 'object' ? raw : {};
  return {
    effectiveOn: isIsoDate(input.effectiveOn) ? input.effectiveOn : today,
    mode: MODES.includes(input.mode) ? input.mode : null,
  };
}

/** Modes a debt offers: a card has none, and `keep_installment` only exists for French (fixed installment) loans. */
export function modesFor(projection) {
  if (projection.card) return [];
  return projection.terms.system === 'french' ? [KEEP_TERM, KEEP_INSTALLMENT] : [KEEP_TERM];
}

function attempt(debt, events, draft, today) {
  try {
    return { result: previewChange(debt, events, draft, { on: today }) };
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    return { error };
  }
}

const money = (before, after) => `${pesos(before)} → ${pesos(after)}`;

function rateLines(projection, before, after, mode) {
  const lines = [];
  if (projection.card) {
    lines.push(`Próximo pago mínimo: ${money(before.nextTotalMinor, after.nextTotalMinor)}`);
  } else {
    lines.push(MODE_LINES[mode]);
    lines.push(`Cuota: ${money(before.installmentMinor, after.installmentMinor)}`);
    lines.push(`Cuotas restantes: ${before.remainingPeriods} → ${after.remainingPeriods}`);
  }
  lines.push(`Intereses por pagar: ${money(before.remainingInterestMinor, after.remainingInterestMinor)}`);
  const delta = after.remainingCostMinor - before.remainingCostMinor;
  lines.push(`Costo restante (intereses y cargos): ${money(before.remainingCostMinor, after.remainingCostMinor)} (${delta <= 0 ? 'ahorras' : 'pagas de más'} ${pesos(Math.abs(delta))})`);
  return lines;
}

/**
 * Preview of a rate change: what the new rate does to the installment, the remaining installments and the cost, with the
 * informational usury notice from the household tables (`debt.legal`) and the backdated note. A mode the debt does not
 * offer is replaced by `keep_term` (a card sends `keep_term` too); `keep_installment` that cannot cover the new interest
 * falls back to `keep_term` with an explanation (`tooLow`). Read-only.
 * @param {{ debt: object, events: object[], today: string, draft: { effectiveOn: string, rate: object, mode?: (string | null) } }} input
 *   `debt` is a `debts` row decorated with `legal`; `events` its event rows.
 * @returns {{ ok: true, needsMode: true, modes: string[], text: string }
 *   | { ok: true, needsMode?: false, mode: string, tooLow: boolean, draft: { effectiveOn: string, rate: object, mode: string }, text: string }
 *   | { ok: false, issue: string }} `needsMode`: a French loan with no mode yet; the caller asks with `modeKeyboard(modes)`.
 */
export function previewRateChange({ debt, events, today, draft }) {
  let projection;
  try {
    projection = project(debt, events, today);
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    return { ok: false, issue: describeCoreError(error) };
  }
  const offered = modesFor(projection);
  if (offered.length > 1 && !draft.mode) {
    const text = `Vas a cambiar la tasa de ${debt.name} a ${rateLabel(draft.rate)} desde ${draft.effectiveOn}. ¿Quieres mantener el plazo (la cuota se recalcula) o mantener la cuota (el plazo se recalcula)?`;
    return { ok: true, needsMode: true, modes: offered, text };
  }
  const requested = offered.includes(draft.mode) ? draft.mode : KEEP_TERM;
  const draftFor = (mode) => ({ kind: 'rate_change', effectiveOn: draft.effectiveOn, rate: draft.rate, mode });
  let mode = requested;
  let tooLow = false;
  let tried = attempt(debt, events, draftFor(mode), today);
  if (tried.error && tried.error.code === 'installment_too_low' && mode === KEEP_INSTALLMENT) {
    mode = KEEP_TERM;
    tooLow = true;
    tried = attempt(debt, events, draftFor(mode), today);
  }
  if (tried.error) return { ok: false, issue: tried.error.code === 'installment_too_low' ? CANNOT_AMORTIZE : CANNOT_PREVIEW };

  const { before, after, impacted } = tried.result;
  const lines = [`📉 Cambio de tasa en ${debt.name}`, `Desde: ${draft.effectiveOn}`, `Nueva tasa: ${rateLabel(draft.rate)}`];
  if (tooLow) lines.push('', `ℹ️ ${TOO_LOW_NOTE}`, '');
  else if (!projection.card && draft.mode === KEEP_INSTALLMENT && !offered.includes(KEEP_INSTALLMENT)) lines.push('', `ℹ️ ${KEEP_TERM_ONLY_NOTE}`, '');
  lines.push(...rateLines(projection, before, after, mode));
  lines.push(...usuryLines(draft.rate, projection.terms.kind, draft.effectiveOn, debt.legal));
  if (impacted.length > 0) lines.push(`ℹ️ ${BACKDATED_NOTE}`);
  lines.push('', '¿Quieres registrar el cambio así? Aún no se guarda.');
  return { ok: true, mode, tooLow, draft: { effectiveOn: draft.effectiveOn, rate: draft.rate, mode }, text: lines.join('\n') };
}

/**
 * The reply after a rate change was written, with the figures of the debt as it is now.
 * @param {object} debt The live `debts` row.
 * @param {{ effectiveOn: string, rate: object }} draft What was written.
 * @param {ReturnType<typeof previewChange>} figures The core replay of the written change over the live events.
 */
export function describeRateChange(debt, draft, figures) {
  const { before, after } = figures;
  const lines = [`✅ Listo: registré el cambio de tasa de ${debt.name} a ${rateLabel(draft.rate)} desde ${draft.effectiveOn}.`];
  if (debt.kind === 'card') lines.push(`Próximo pago mínimo: ${money(before.nextTotalMinor, after.nextTotalMinor)}`);
  else lines.push(`Cuota: ${money(before.installmentMinor, after.installmentMinor)} · Cuotas restantes: ${after.remainingPeriods}`);
  if (figures.impacted.length > 0) lines.push(BACKDATED_NOTE);
  return lines.join('\n');
}

// ---- charge change (NI2, NI6) ----

const CHARGE_OPS = ['set', 'remove', 'add'];
const EVENT_PAYLOAD_MAX_CHARS = 8000;
const MAX_CHARGE_CANDIDATES = 6;
// Words people use for each kind of charge (already folded), like the debt kinds of `findDebt`.
const CHARGE_KIND_WORDS = {
  insurance: ['seguro', 'seguros', 'poliza'],
  fee: ['comision', 'manejo', 'cargo', 'cargos'],
  tax: ['impuesto', 'impuestos', 'iva', 'gmf'],
};
const BASIS_LABELS = { pctOutstanding: 'del saldo', pctOriginal: 'del monto original', pctOfBase: 'de la base', pctOfSubtotal: 'del total de la cuota', pctOfCharge: 'de otro cargo' };

// Adding a charge (S6a): a preset the user named (fee, iva, life, insurance, gmf) or explicit fields. The core's `addPresetCharge` and
// `addExplicitCharge` validate the result against the charges in force, and a failure becomes a Spanish issue (nothing is written).
const ADD_KINDS = ['insurance', 'fee', 'tax', 'other'];
const ADD_BASES = ['fixed', 'pctOutstanding', 'pctOriginal', 'pctOfSubtotal', 'pctOfCharge'];
const ADD_CADENCES = ['per_installment', 'annual', 'once'];
const PRESET_ORDER = ['fee', 'iva', 'life', 'insurance', 'gmf'];
const AMOUNT_PRESETS = ['fee', 'life', 'insurance'];
const DEFAULT_IVA = 19;
const ADD_ISSUES = {
  preset_exists: 'Ese cargo ya existe en la deuda. Si quieres cambiar su valor, pídeme “cambia el cargo a …”. No guardé nada.',
  preset_requires_fee: 'El IVA va sobre una cuota de manejo o comisión, y la deuda no tiene ninguna. Dime también el valor de la cuota de manejo. No guardé nada.',
  charge_ref_unknown: 'Ese cargo dice que se calcula sobre otro cargo que no existe en la deuda. Dime sobre cuál va. No guardé nada.',
  charge_ref_ambiguous: 'Hay más de un cargo que podría ser ese. Dime con cuál va. No guardé nada.',
  preset_amount_missing: 'Me falta el valor del cargo. Escríbelo de nuevo con su valor; no guardé nada.',
  charge_value_missing: 'Me falta el valor del cargo. Escríbelo de nuevo con su valor; no guardé nada.',
  invalid_charge: 'El valor de un cargo fijo va en pesos enteros, sin decimales, y un porcentaje no puede ser negativo. Escríbelo de nuevo; no guardé nada.',
};
const CHARGE_GONE = 'Ese cargo ya no existe en la deuda, así que no registré nada. Pídeme el cambio de nuevo.';
const FIXED_WHOLE = 'El valor de un cargo fijo va en pesos enteros, sin decimales. Escríbelo de nuevo; no guardé nada.';
const PCT_MAX = 'Un porcentaje no puede ser mayor que 100. Escríbelo de nuevo; no guardé nada.';
const TOO_MANY = 'Son demasiados cargos para guardarlos en un solo cambio. Haz el cambio desde la web.';
const CANNOT_PREVIEW_CHARGES = 'No pude calcular el cambio con esos cargos. Revisa el valor y la fecha.';

const chargeText = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

// The explicit fields of an added charge, as the model gave them; the value is `null` when it was not given.
function readExplicitCharge(input) {
  const label = chargeText(input.label, 40);
  if (!label || !ADD_BASES.includes(input.basis)) return null;
  return {
    kind: ADD_KINDS.includes(input.kind) ? input.kind : 'other',
    label,
    basis: input.basis,
    value: typeof input.newValue === 'number' && Number.isFinite(input.newValue) ? input.newValue : null,
    cadence: ADD_CADENCES.includes(input.cadence) ? input.cadence : 'per_installment',
    ...(input.basis === 'pctOfCharge' ? { refLabel: chargeText(input.refLabel, 40) } : {}),
  };
}

/**
 * Reads what the model extracted about a charge change: the charge as the user named it, the operation
 * (`set` a new value, `remove` or `add`) and the value. `missing` names what to ask for and `problems`
 * what is invalid (a negative value). The date is today when not said or not a real date. An `add` carries `add: { presets, charge }`:
 * the presets the user named (already read by the extractor) or the explicit fields (`kind`, `label`, `basis`, `newValue`, `cadence`, `refLabel`).
 * @param {object | null} raw The model's `planChange` object.
 * @param {{ today: string, presets?: object }} options
 */
export function readChargeChange(raw, { today, presets = {} }) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const given = typeof input.newValue === 'number' && Number.isFinite(input.newValue);
  const chargeRef = chargeText(input.chargeRef, 40) || null;
  const op = CHARGE_OPS.includes(input.op) ? input.op : given && input.newValue >= 0 ? 'set' : null;
  const missing = [];
  const problems = [];
  const result = { effectiveOn: isIsoDate(input.effectiveOn) ? input.effectiveOn : today, chargeRef, op, newValue: op === 'remove' || !given ? null : input.newValue, missing, problems };
  if (op === 'add') {
    const charge = readExplicitCharge(input);
    if (PRESET_ORDER.every((key) => !Object.prototype.hasOwnProperty.call(presets, key)) && !charge) missing.push('charge_spec');
    else if ((charge && charge.value === null) || AMOUNT_PRESETS.some((key) => presets[key] === null)) missing.push('charge_value');
    if (charge && charge.value !== null && charge.value < 0) problems.push('invalid_amount');
    return { ...result, add: { presets, charge } };
  }
  if (!chargeRef) missing.push('charge');
  if (op === null) missing.push('charge_action');
  if (op === 'set' && !given) missing.push('charge_value');
  if (op === 'set' && given && input.newValue < 0) problems.push('invalid_amount');
  return result;
}

/**
 * The charges in force on `today`. A loan's projection already applies its stored changes, so its terms are the answer.
 * A card's projection keeps the original terms, so the active `charge_change` events up to today are folded in here
 * (the same rule as the web's `chargesInForce`).
 * @param {object} projection `project(debt, events, today)`.
 * @param {object[]} events The debt's event rows (voided ones are ignored).
 * @param {string} today `YYYY-MM-DD`.
 * @returns {object[]} Normalized charges.
 */
export function chargesInForce(projection, events, today) {
  if (!projection.card) return projection.terms.charges;
  return sortEvents(activeEvents(events)).reduce(
    (charges, event) => (event.kind === 'charge_change' && compareIso(event.effectiveOn, today) <= 0 ? event.payload.charges : charges),
    projection.terms.charges,
  );
}

const hasWord = (ref, word) => ` ${ref} `.includes(` ${word} `);

const CHARGE_TIERS = [
  (charge, ref) => fold(charge.label) === ref,
  (charge, ref) => (fold(charge.label).length >= 3 && fold(charge.label).includes(ref)) || hasWord(ref, fold(charge.label)),
  (charge, ref) => (CHARGE_KIND_WORDS[charge.kind] || []).some((word) => hasWord(ref, word)),
];

/**
 * Finds the charge a message talks about, by label and then by kind, ignoring case and accents.
 * @param {object[]} charges The charges in force.
 * @param {string} reference What the user called it ("seguro de vida", "manejo").
 * @returns {{ match: object } | { candidates: object[] } | { none: true }} Priority: exact label, then label containing the words, then kind words.
 */
export function findCharge(charges, reference) {
  const ref = fold(reference);
  if (ref === '' || ref.length < 3) return { none: true };
  for (const tier of CHARGE_TIERS) {
    const found = charges.filter((charge) => tier(charge, ref));
    if (found.length === 1) return { match: found[0] };
    if (found.length > 1) return { candidates: found.slice(0, MAX_CHARGE_CANDIDATES) };
  }
  return { none: true };
}

// The charges an add brings to the set in force: the presets in the order of the core (the IVA after its fee), then the explicit charge.
// A price that includes the IVA holds the fee as round(stated / (1 + IVA / 100)), as when a debt is created.
function addToSet(charges, add, card) {
  const presets = (add && add.presets) || {};
  const included = presets.ivaIncluded === true;
  const iva = presets.iva === undefined && included ? DEFAULT_IVA : presets.iva;
  let next = charges;
  for (const key of PRESET_ORDER) {
    let value = key === 'iva' ? iva : presets[key];
    if (value === undefined || (key === 'gmf' && value !== true)) continue;
    if (key === 'fee' && included && typeof value === 'number') value = Math.round(value / (1 + iva / 100));
    next = addPresetCharge(next, key, value, { card });
  }
  if (add && add.charge) next = addExplicitCharge(next, add.charge);
  const known = new Set(charges.map((charge) => charge.id));
  return { charges: next, added: next.filter((charge) => !known.has(charge.id)) };
}

function rebuildAdd(charges, add, card) {
  try {
    return addToSet(charges, add, card);
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    return { issue: ADD_ISSUES[error.code] || CANNOT_PREVIEW_CHARGES };
  }
}

/**
 * The charge set after the change, rebuilt from the charges in force (the pending stores only the charge id, the operation and
 * the value, or the preset and fields of an add): a removal takes with it every charge that references the removed one (IVA on a fee).
 * An add returns the new set and the charges it added, or an `issue` when the result is not valid.
 * @param {object[]} charges The charges in force now.
 * @param {{ chargeId?: string, op: ('set' | 'remove' | 'add'), newValue?: (number | null), add?: object }} change
 * @param {{ card?: boolean }} [options] `card`: the ids and labels a card stores for its management fee and IVA.
 * @returns {{ gone: true } | { target: object, charges: object[], dependents: object[] } | { charges: object[], added: object[] } | { issue: string }}
 */
export function rebuildCharges(charges, { chargeId, op, newValue, add }, { card = false } = {}) {
  if (op === 'add') return rebuildAdd(charges, add, card);
  const target = charges.find((charge) => charge.id === chargeId);
  if (!target) return { gone: true };
  if (op === 'remove') {
    const kept = removeCharge(charges, chargeId);
    return { target, charges: kept, dependents: charges.filter((charge) => charge.id !== chargeId && !kept.includes(charge)) };
  }
  return { target, charges: charges.map((charge) => (charge.id === chargeId ? { ...charge, value: newValue } : charge)), dependents: [] };
}

const describeValue = (charge, value) => (charge.basis === 'fixed' ? pesos(value) : `${value}% ${BASIS_LABELS[charge.basis] || ''}`.trim());

function valueIssue(charge, value) {
  if (charge.basis === 'fixed') return Number.isSafeInteger(value) ? null : FIXED_WHOLE;
  return value > 100 ? PCT_MAX : null;
}

const nextLabel = (isCard) => (isCard ? 'Próximo pago mínimo' : 'Próxima cuota (con cargos)');

// What the added charges cost in the next period, from the core's evaluation of the whole resulting set (an IVA needs its fee).
function addedLines(projection, before, charges, added) {
  const { terms } = projection;
  const ctx = { period: 1, openingMinor: projection.balanceMinor, installmentMinor: before.installmentMinor || 0, originalMinor: terms.principalMinor, periodsPerYear: PERIODICITIES[terms.periodicity].perYear, unit: 1 };
  const evaluated = evaluateCharges(charges, ctx).lines;
  const text = (charge) => {
    const line = evaluated.find((item) => item.id === charge.id);
    return `${charge.label}: ${line ? pesos(line.amountMinor) : describeValue(charge, charge.value)}${charge.basis === 'fixed' ? '' : ` (${describeValue(charge, charge.value)})`}`;
  };
  return added.length === 1 ? [`Se agrega: ${text(added[0])}`] : ['Se agregan:', ...added.map((charge) => `• ${text(charge)}`)];
}

function previewAdd({ debt, events, today, draft, projection, charges }) {
  const rebuilt = rebuildCharges(charges, draft, { card: Boolean(projection.card) });
  if (rebuilt.issue) return { ok: false, issue: rebuilt.issue };
  let figures;
  try {
    figures = previewChange(debt, events, { kind: 'charge_change', effectiveOn: draft.effectiveOn, charges: rebuilt.charges }, { on: today });
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    return { ok: false, issue: CANNOT_PREVIEW_CHARGES };
  }
  if (figures.payloadChars > EVENT_PAYLOAD_MAX_CHARS) return { ok: false, issue: TOO_MANY };
  const { before, after, impacted } = figures;
  const lines = [`🧾 Cambio de cargos en ${debt.name}`, `Desde: ${draft.effectiveOn}`, ...addedLines(projection, before, rebuilt.charges, rebuilt.added)];
  lines.push(`${nextLabel(Boolean(projection.card))}: ${money(before.nextTotalMinor, after.nextTotalMinor)}`);
  lines.push(`Cargos por pagar: ${money(before.remainingChargesMinor, after.remainingChargesMinor)}`);
  if (impacted.length > 0) lines.push(`ℹ️ ${BACKDATED_NOTE}`);
  lines.push('', '¿Quieres registrar el cambio así? Aún no se guarda.');
  return { ok: true, draft: { effectiveOn: draft.effectiveOn, op: 'add', add: draft.add }, text: lines.join('\n') };
}

/**
 * Preview of a charge change: the charge named (or chosen) is given a new value or removed from the effective date, and the
 * core replays the debt to show the next installment (a card's minimum payment) before and after. Nothing is added: the
 * handler refuses `add` before this. Read-only.
 * @param {{ debt: object, events: object[], today: string,
 *   draft: { effectiveOn: string, op: ('set' | 'remove'), newValue?: (number | null), chargeRef?: string, chargeId?: string } }} input
 * @returns {{ ok: true, needsCharge: true, candidates: object[], text: string }
 *   | { ok: true, needsCharge?: false, draft: { effectiveOn: string, chargeId: string, op: string, newValue: (number | null) }, text: string }
 *   | { ok: false, issue: string }}
 */
export function previewChargeChange({ debt, events, today, draft }) {
  let projection;
  try {
    projection = project(debt, events, today);
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    return { ok: false, issue: describeCoreError(error) };
  }
  const charges = chargesInForce(projection, events, today);
  if (draft.op === 'add') return previewAdd({ debt, events, today, draft, projection, charges });
  if (charges.length === 0) return { ok: false, issue: `${debt.name} no tiene seguros ni cargos registrados. Si quieres agregar uno, dime cuál es y de cuánto.` };
  let target;
  if (draft.chargeId) {
    target = charges.find((charge) => charge.id === draft.chargeId);
    if (!target) return { ok: false, issue: CHARGE_GONE };
  } else {
    const found = findCharge(charges, draft.chargeRef);
    if (found.candidates) return { ok: true, needsCharge: true, candidates: found.candidates, text: `¿Cuál cargo de ${debt.name} quieres ${draft.op === 'remove' ? 'quitar' : 'cambiar'}?` };
    if (found.none) return { ok: false, issue: `No encontré un seguro o cargo que se parezca a «${draft.chargeRef}» en ${debt.name}. Los que tiene: ${charges.map((charge) => charge.label).join(', ')}. Puedo cambiar el valor de uno que ya exista, quitarlo o agregar uno nuevo si me dices cuál es y de cuánto.` };
    target = found.match;
  }
  const remove = draft.op === 'remove';
  if (!remove) {
    const issue = valueIssue(target, draft.newValue);
    if (issue) return { ok: false, issue };
    if (draft.newValue === target.value) return { ok: false, issue: `${target.label} ya tiene ese valor; no hay nada que cambiar.` };
  }
  const rebuilt = rebuildCharges(charges, { chargeId: target.id, op: draft.op, newValue: draft.newValue });
  let figures;
  try {
    figures = previewChange(debt, events, { kind: 'charge_change', effectiveOn: draft.effectiveOn, charges: rebuilt.charges }, { on: today });
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    return { ok: false, issue: CANNOT_PREVIEW_CHARGES };
  }
  if (figures.payloadChars > EVENT_PAYLOAD_MAX_CHARS) return { ok: false, issue: TOO_MANY };

  const { before, after, impacted } = figures;
  const lines = [`🧾 Cambio de cargos en ${debt.name}`, `Desde: ${draft.effectiveOn}`];
  if (remove) {
    lines.push(`Se quita: ${target.label} (${describeValue(target, target.value)})`);
    if (rebuilt.dependents.length > 0) lines.push(`También se quita lo que depende de él: ${rebuilt.dependents.map((charge) => charge.label).join(', ')}`);
  } else {
    lines.push(`${target.label}: ${describeValue(target, target.value)} → ${describeValue(target, draft.newValue)}`);
  }
  lines.push(`${nextLabel(Boolean(projection.card))}: ${money(before.nextTotalMinor, after.nextTotalMinor)}`);
  lines.push(`Cargos por pagar: ${money(before.remainingChargesMinor, after.remainingChargesMinor)}`);
  if (impacted.length > 0) lines.push(`ℹ️ ${BACKDATED_NOTE}`);
  lines.push('', '¿Quieres registrar el cambio así? Aún no se guarda.');
  return { ok: true, draft: { effectiveOn: draft.effectiveOn, chargeId: target.id, op: draft.op, newValue: remove ? null : draft.newValue }, text: lines.join('\n') };
}

export const CHARGE_GONE_TEXT = CHARGE_GONE;

/**
 * The reply after a charge change was written, with the next installment of the debt as it is now.
 * @param {object} debt The live `debts` row.
 * @param {object} target The charge that was changed or removed (as it was).
 * @param {{ effectiveOn: string, op: string, newValue?: (number | null) }} draft What was written.
 * @param {ReturnType<typeof previewChange>} figures The core replay of the written change over the live events.
 * @param {object[]} [dependents] The charges that went with a removed one.
 */
export function describeChargeChange(debt, target, draft, figures, dependents = []) {
  const { before, after } = figures;
  const what = draft.op === 'remove'
    ? `quité ${target.label}${dependents.length > 0 ? ` (y ${dependents.map((charge) => charge.label).join(', ')})` : ''}`
    : `${target.label} ahora vale ${describeValue(target, draft.newValue)}`;
  const lines = [`✅ Listo: registré el cambio de cargos de ${debt.name} desde ${draft.effectiveOn}: ${what}.`, `${nextLabel(debt.kind === 'card')}: ${money(before.nextTotalMinor, after.nextTotalMinor)}`];
  if (figures.impacted.length > 0) lines.push(BACKDATED_NOTE);
  return lines.join('\n');
}

/**
 * The reply after charges were added, with the next installment of the debt as it is now.
 * @param {object} debt The live `debts` row.
 * @param {object[]} added The charges that were added.
 * @param {{ effectiveOn: string }} draft What was written.
 * @param {ReturnType<typeof previewChange>} figures The core replay of the written change over the live events.
 */
export function describeChargeAdd(debt, added, draft, figures) {
  const { before, after } = figures;
  const lines = [`✅ Listo: registré el cambio de cargos de ${debt.name} desde ${draft.effectiveOn}: agregué ${added.map((charge) => charge.label).join(', ')}.`, `${nextLabel(debt.kind === 'card')}: ${money(before.nextTotalMinor, after.nextTotalMinor)}`];
  if (figures.impacted.length > 0) lines.push(BACKDATED_NOTE);
  return lines.join('\n');
}

// ---- restructure (NI3) ----
// The pending keeps only the overrides the user stated (`restructureDraft`). Everything else, the carried balance included, is
// rebuilt from the live debt by `rebuildRestructure`, both for the preview and at Confirm, so a payment recorded in between
// changes what is written.

export const SYSTEMS = ['french', 'german', 'bullet', 'interest_only'];

const hasKey = (object, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(object, key);

const RESTRUCTURE_CARD = 'Por ahora no puedo reestructurar una tarjeta: no tiene un plan de cuotas que rehacer. No guardé nada.';
const RESTRUCTURE_NO_BALANCE = 'Esta deuda no tiene saldo por reestructurar. No guardé nada.';
const RESTRUCTURE_TOO_BIG = 'El plan nuevo es demasiado grande para guardarlo en un solo cambio (por ejemplo, por tener demasiados cargos). Haz la reestructuración desde la web. No guardé nada.';
const RESTRUCTURE_NEEDS_TERM = 'Necesito el número de cuotas del plan nuevo, en número entero. No guardé nada.';
const RESTRUCTURE_INVALID = 'No pude armar el nuevo plan con esos datos. Revisa las cuotas, la tasa, la periodicidad y las fechas. No guardé nada.';
const RESTRUCTURE_FIRST_DUE = (on) => `La primera cuota debe ser posterior a la fecha de la reestructuración (${on}). Dime otra fecha para la primera cuota. No guardé nada.`;
const READ_CODES = ['invalid_terms_json', 'invalid_debt', 'unsupported_schema_version', 'invalid_date', 'invalid_rate'];

/**
 * Reads what the model extracted about a restructure: the effective date (today when not said or not a real date), the number of
 * installments of the new plan (`null` when not a positive whole number), the system, periodicity and first due date when they are
 * valid, and `waiveLate` (true only when the model said true). The rate rides in `rate` and the charges in `charges`.
 * @param {object | null} raw The model's `planChange` object.
 * @param {{ today: string }} options
 */
export function readRestructure(raw, { today }) {
  const input = raw && typeof raw === 'object' ? raw : {};
  return {
    effectiveOn: isIsoDate(input.effectiveOn) ? input.effectiveOn : today,
    n: Number.isSafeInteger(input.n) && input.n > 0 ? input.n : null,
    system: SYSTEMS.includes(input.system) ? input.system : null,
    periodicity: hasKey(PERIODICITIES, input.periodicity) ? input.periodicity : null,
    firstDueOn: isIsoDate(input.firstDueOn) ? input.firstDueOn : null,
    waiveLate: input.waiveLate === true,
  };
}

/**
 * The overrides a restructure pending stores (AD14): the date, the number of installments and only what the user stated. While the
 * convention of the rate is missing, `rateValue` stands in for `rate`.
 * @param {object} planChange `normaliseDebtExtraction(...).planChange` of a restructure.
 */
export function restructureDraft(planChange) {
  const { effectiveOn, n, system, periodicity, firstDueOn, waiveLate, rate, rateValue, charges } = planChange;
  return {
    effectiveOn,
    n,
    ...(system ? { system } : {}),
    ...(periodicity ? { periodicity } : {}),
    ...(firstDueOn ? { firstDueOn } : {}),
    ...(rate ? { rate } : typeof rateValue === 'number' ? { rateValue } : {}),
    ...(Array.isArray(charges) && charges.length > 0 ? { charges } : {}),
    ...(waiveLate ? { waiveLate: true } : {}),
  };
}

function restructureIssue(error, draft) {
  if (error.code === 'restructure_unsupported') return RESTRUCTURE_CARD;
  if (error.code === 'invalid_first_due') return RESTRUCTURE_FIRST_DUE(draft.effectiveOn);
  if (error.code === 'payload_too_large') return RESTRUCTURE_TOO_BIG;
  if (READ_CODES.includes(error.code)) return describeCoreError(error);
  return RESTRUCTURE_INVALID;
}

/**
 * Rebuilds a restructure from the LIVE debt: what it refinances (`restructureCarry`, with the mora when `waiveLate` is off), the
 * terms in force with the carried balance as principal and the overrides on top (`buildRestructureTerms`), and the core replay of
 * the event. `n` is always passed (the core does not carry the old grace, balloon, manual plan or due day), and a first due date
 * that was not stated is one period after the effective date. Nothing is written. Invalid terms, an unreadable event, a payload
 * over 8000 characters or a card give `{ ok: false, issue }`.
 * @param {{ debt: object, events: object[], today: string, draft: { effectiveOn: string, n: number, rate?: object, system?: string,
 *   periodicity?: string, firstDueOn?: string, charges?: object[], waiveLate?: boolean } }} input `debt` is decorated with `legal`.
 * @returns {{ ok: true, draft: object, carry: object, carriedMinor: number, waivedLateMinor: number, overdueMinor: number,
 *   terms: object, eventDraft: object, figures: ReturnType<typeof previewChange> } | { ok: false, issue: string }}
 */
export function rebuildRestructure({ debt, events, today, draft }) {
  if (!Number.isSafeInteger(draft.n) || draft.n < 1) return { ok: false, issue: RESTRUCTURE_NEEDS_TERM };
  const { effectiveOn } = draft;
  try {
    const carry = restructureCarry(debt, events, effectiveOn);
    const waivedLateMinor = draft.waiveLate ? carry.waivableLateMinor : 0;
    const carriedMinor = carry.carriedMinor - waivedLateMinor;
    if (carriedMinor <= 0) return { ok: false, issue: RESTRUCTURE_NO_BALANCE };
    const inForce = project(debt, events, effectiveOn);
    const periodicity = draft.periodicity || inForce.terms.periodicity || 'monthly';
    const overrides = { rate: draft.rate, system: draft.system, periodicity: draft.periodicity, n: draft.n, firstDueOn: draft.firstDueOn || periodDates(effectiveOn, periodicity, 2)[1], charges: draft.charges };
    const terms = buildRestructureTerms(inForce.terms, { effectiveOn, carriedMinor, overrides });
    const eventDraft = { kind: 'restructure', effectiveOn, terms, ...(draft.waiveLate ? { waiveLate: true } : {}) };
    const figures = previewChange(debt, events, eventDraft, { on: today });
    if (figures.payloadChars > EVENT_PAYLOAD_MAX_CHARS) return { ok: false, issue: RESTRUCTURE_TOO_BIG };
    return { ok: true, draft, carry, carriedMinor, waivedLateMinor, overdueMinor: inForce.pastDueMinor - waivedLateMinor, terms, eventDraft, figures };
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    return { ok: false, issue: restructureIssue(error, draft) };
  }
}

function restructureLines(debt, built) {
  const { carry, carriedMinor, waivedLateMinor, overdueMinor, terms, figures, draft } = built;
  const { before, after } = figures;
  const { arrears } = carry;
  const lines = [`🔁 Reestructuración de ${debt.name}`, `Desde: ${draft.effectiveOn}`, '', 'Lo que se refinancia:'];
  lines.push(`Saldo de capital: ${pesos(carry.balanceMinor)}`, `Intereses vencidos: ${pesos(arrears.interest)}`, `Cargos vencidos: ${pesos(arrears.charges)}`);
  if (arrears.taxes > 0) lines.push(`Impuestos vencidos: ${pesos(arrears.taxes)}`);
  if (waivedLateMinor > 0) lines.push(`Mora condonada: ${pesos(waivedLateMinor)} (no se suma)`);
  else if (arrears.lateInterest > 0) lines.push(`Mora: ${pesos(arrears.lateInterest)}`);
  if (overdueMinor > 0) lines.push(`Cuotas vencidas que se refinancian: ${pesos(overdueMinor)}`);
  lines.push(`Saldo que pasa al nuevo plan: ${pesos(carriedMinor)}`);
  if (arrears.interest + arrears.charges + arrears.taxes + arrears.lateInterest > 0) lines.push('Lo vencido se suma al saldo y desde ahora genera intereses.');
  lines.push('');
  lines.push(terms.system === 'none' ? 'Plan nuevo: solo se lleva el saldo, sin cuotas' : `Plan nuevo: ${terms.n} cuotas ${PERIOD_LABELS[terms.periodicity]} · ${SYSTEM_LABELS[terms.system]}`);
  lines.push(`Tasa: ${rateLabel(terms.rate)}`);
  if (terms.system !== 'none') lines.push(`Primera cuota: ${terms.firstDueOn}`);
  lines.push(`Cuota: ${money(before.installmentMinor, after.installmentMinor)}`);
  lines.push(`Cuotas restantes: ${before.remainingPeriods} → ${after.remainingPeriods}`);
  lines.push(`Intereses por pagar: ${money(before.remainingInterestMinor, after.remainingInterestMinor)}`);
  const delta = after.remainingCostMinor - before.remainingCostMinor;
  lines.push(`Costo restante (intereses y cargos): ${money(before.remainingCostMinor, after.remainingCostMinor)} (${delta <= 0 ? 'ahorras' : 'pagas de más'} ${pesos(Math.abs(delta))})`);
  return lines;
}

/**
 * Preview of a restructure: what is refinanced (balance, overdue interest, charges, taxes and mora), the balance carried to the new
 * plan, the new installment and term, the cost before and after, the usury notice from the household tables (`debt.legal`) and the
 * backdated note. The returned `draft` is the overrides only, ready for the pending. Read-only.
 * @param {{ debt: object, events: object[], today: string, draft: object }} input As for `rebuildRestructure`; `draft.rateValue` is ignored.
 * @returns {{ ok: true, draft: object, text: string } | { ok: false, issue: string }}
 */
export function previewRestructure({ debt, events, today, draft }) {
  const { rateValue, ...overrides } = draft;
  const built = rebuildRestructure({ debt, events, today, draft: overrides });
  if (!built.ok) return built;
  const lines = restructureLines(debt, built);
  lines.push(...usuryLines(built.terms.rate, built.terms.kind, overrides.effectiveOn, debt.legal));
  if (built.figures.impacted.length > 0) lines.push(`ℹ️ ${BACKDATED_NOTE}`);
  lines.push('', '¿Quieres registrar la reestructuración así? Aún no se guarda.');
  return { ok: true, draft: overrides, text: lines.join('\n') };
}

/**
 * The reply after a restructure was written, with the figures of the debt as rebuilt from the live events.
 * @param {object} debt The live `debts` row.
 * @param {Extract<ReturnType<typeof rebuildRestructure>, { ok: true }>} built
 */
export function describeRestructure(debt, built) {
  const { carriedMinor, waivedLateMinor, terms, figures, draft } = built;
  const lines = [`✅ Listo: registré la reestructuración de ${debt.name} desde ${draft.effectiveOn}.`, `Saldo refinanciado: ${pesos(carriedMinor)}`];
  if (waivedLateMinor > 0) lines.push(`Mora condonada: ${pesos(waivedLateMinor)}`);
  lines.push(`Cuota: ${pesos(figures.after.installmentMinor)}`, `Cuotas restantes: ${figures.after.remainingPeriods}`);
  if (terms.system !== 'none') lines.push(`Primera cuota: ${terms.firstDueOn}`);
  if (figures.impacted.length > 0) lines.push(BACKDATED_NOTE);
  return lines.join('\n');
}
