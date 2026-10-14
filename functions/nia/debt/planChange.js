import { ValidationError, activeEvents, compareIso, isIsoDate, previewChange, project, rateLabel, removeCharge, sortEvents } from '../../../packages/finance-core/index.js';
import { fold } from './findDebt.js';
import { pesos } from './format.js';
import { describeCoreError, usuryLines } from './preview.js';

// Plan changes of Nia (NI2, NI7): `rate_change` and `charge_change` (edit or remove an existing charge; adding one is web-only). The model only extracts; every
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

export const ADD_IN_WEB = 'Por ahora solo puedo cambiar el valor de un seguro o cargo que ya existe, o quitarlo. Para agregar uno nuevo usa la web: en Deudas abre la deuda y elige «Más acciones» y «Cambiar seguros y cargos». No guardé nada.';
const CHARGE_GONE = 'Ese cargo ya no existe en la deuda, así que no registré nada. Pídeme el cambio de nuevo.';
const FIXED_WHOLE = 'El valor de un cargo fijo va en pesos enteros, sin decimales. Escríbelo de nuevo; no guardé nada.';
const PCT_MAX = 'Un porcentaje no puede ser mayor que 100. Escríbelo de nuevo; no guardé nada.';
const TOO_MANY = 'Son demasiados cargos para guardarlos en un solo cambio. Haz el cambio desde la web.';
const CANNOT_PREVIEW_CHARGES = 'No pude calcular el cambio con esos cargos. Revisa el valor y la fecha.';

const chargeText = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/**
 * Reads what the model extracted about a charge change: the charge as the user named it, the operation
 * (`set` a new value, `remove`, or `add`, which Nia refuses) and the value. `missing` names what to ask for and `problems`
 * what is invalid (a negative value). The date is today when not said or not a real date.
 * @param {object | null} raw The model's `planChange` object.
 * @param {{ today: string }} options
 */
export function readChargeChange(raw, { today }) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const given = typeof input.newValue === 'number' && Number.isFinite(input.newValue);
  const chargeRef = chargeText(input.chargeRef, 40) || null;
  const op = CHARGE_OPS.includes(input.op) ? input.op : given && input.newValue >= 0 ? 'set' : null;
  const missing = [];
  const problems = [];
  if (op !== 'add') {
    if (!chargeRef) missing.push('charge');
    if (op === null) missing.push('charge_action');
    if (op === 'set' && !given) missing.push('charge_value');
    if (op === 'set' && given && input.newValue < 0) problems.push('invalid_amount');
  }
  return { effectiveOn: isIsoDate(input.effectiveOn) ? input.effectiveOn : today, chargeRef, op, newValue: op === 'remove' || !given ? null : input.newValue, missing, problems };
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

/**
 * The charge set after the change, rebuilt from the charges in force (the pending stores only the charge id, the operation and
 * the value): a removal takes with it every charge that references the removed one (IVA on a fee).
 * @param {object[]} charges The charges in force now.
 * @param {{ chargeId: string, op: ('set' | 'remove'), newValue?: (number | null) }} change
 * @returns {{ gone: true } | { target: object, charges: object[], dependents: object[] }}
 */
export function rebuildCharges(charges, { chargeId, op, newValue }) {
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
  if (charges.length === 0) return { ok: false, issue: `${debt.name} no tiene seguros ni cargos registrados. Para agregar uno nuevo usa la web: en Deudas abre la deuda y elige «Más acciones» y «Cambiar seguros y cargos».` };
  let target;
  if (draft.chargeId) {
    target = charges.find((charge) => charge.id === draft.chargeId);
    if (!target) return { ok: false, issue: CHARGE_GONE };
  } else {
    const found = findCharge(charges, draft.chargeRef);
    if (found.candidates) return { ok: true, needsCharge: true, candidates: found.candidates, text: `¿Cuál cargo de ${debt.name} quieres ${draft.op === 'remove' ? 'quitar' : 'cambiar'}?` };
    if (found.none) return { ok: false, issue: `No encontré un seguro o cargo que se parezca a «${draft.chargeRef}» en ${debt.name}. Los que tiene: ${charges.map((charge) => charge.label).join(', ')}. Solo puedo cambiar el valor de uno que ya exista o quitarlo; para agregar uno nuevo usa la web.` };
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
