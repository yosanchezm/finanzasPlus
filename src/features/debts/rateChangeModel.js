import { ValidationError, isIsoDate, previewChange } from '@finance-core';
import { formatDueDate } from './debtLabels';
import { rateEcho, toRate, usuryModality } from './wizard/wizardModel';

// Pure model of the "Cambiar tasa" dialog. The form holds strings, like the inputs; the preview is the core's
// `previewChange`, so what the dialog shows equals the projection once the event is saved.

export const INSTALLMENT_TOO_LOW = 'Con la nueva tasa, la cuota actual ya no cubre los intereses o el plan pasaría de 2000 cuotas. Elegimos «Mantener el plazo» para recalcular la cuota.';
export const KEEP_TERM_ONLY = 'Este sistema mantiene el plazo.';
const INVALID_DATE = 'Elige una fecha válida.';
const CANNOT_AMORTIZE = 'Con esa tasa el plan no se puede calcular: los intereses superan la cuota o el plan pasaría de 2000 cuotas. Prueba con otra tasa.';
const CANNOT_PREVIEW = 'No se pudo calcular el cambio con esos datos. Revisa la tasa y la fecha.';

const KEEP_TERM = 'keep_term';
const KEEP_INSTALLMENT = 'keep_installment';
const IMPACT_LABELS = { payment: 'Pago', extra_payment: 'Abono extra' };

/** Modes the dialog offers: cards have none, and `keep_installment` only exists for French (fixed-installment) loans. */
export function modesFor(projection) {
  if (projection.card) return [];
  return projection.terms.system === 'french' ? [KEEP_TERM, KEEP_INSTALLMENT] : [KEEP_TERM];
}

/** The form a fresh dialog starts with: the rate in force, effective today, keeping the term. */
export function initialRateForm(projection, today) {
  const { value, basis, periodicity, timing } = projection.terms.rate;
  return { effectiveOn: today, rate: { value: String(value), basis, periodicity, timing }, mode: KEEP_TERM };
}

const sameFigures = (before, after) => before.installmentMinor === after.installmentMinor
  && before.remainingPeriods === after.remainingPeriods
  && before.remainingInterestMinor === after.remainingInterestMinor;

const impactedFor = (impacted) => impacted.map(({ eventId, kind, effectiveOn, costBeforeMinor, costAfterMinor }) => ({
  eventId, label: `${IMPACT_LABELS[kind] ?? 'Movimiento'} del ${formatDueDate(effectiveOn)}`, costBeforeMinor, costAfterMinor,
}));

function attempt(debt, events, draft, today) {
  try {
    return { result: previewChange(debt, events, draft, { on: today }) };
  } catch (error) {
    if (error instanceof ValidationError) return { error };
    throw error;
  }
}

/**
 * Preview of a rate change form. `form` is `{ effectiveOn, rate: { value, basis, periodicity, timing }, mode }` (strings
 * for the inputs), `projection` the debt as of today. Returns the EA `echo` (with the informational usury notice for the
 * effective date), the offered `modes` and the `mode` really used, and, once the form is valid, the `draft` to save, the
 * `before` and `after` snapshots, `backdated`, the `impacted` payments and `unchanged` (no figure moves). When
 * `keep_installment` is asked and the installment no longer covers the interest, `tooLow` is true and `keep_term` is used.
 */
export function previewRateChange({ debt, events, projection, form, today }) {
  const modes = modesFor(projection);
  const isCard = Boolean(projection.card);
  const requested = modes.includes(form.mode) ? form.mode : KEEP_TERM;
  const echo = rateEcho(form.rate, usuryModality(projection.terms.kind), isIsoDate(form.effectiveOn) ? form.effectiveOn : today, debt.legal);
  const none = { modes, mode: requested, tooLow: false, isCard, echo, issue: null, draft: null, before: null, after: null, unchanged: false, backdated: false, impacted: [] };
  if (!echo.ok) return none;
  if (!isIsoDate(form.effectiveOn)) return { ...none, issue: INVALID_DATE };

  const draftFor = (mode) => ({ kind: 'rate_change', effectiveOn: form.effectiveOn, rate: toRate(form.rate), mode });
  let mode = requested;
  let tooLow = false;
  let tried = attempt(debt, events, draftFor(mode), today);
  if (tried.error?.code === 'installment_too_low' && mode === KEEP_INSTALLMENT) {
    mode = KEEP_TERM;
    tooLow = true;
    tried = attempt(debt, events, draftFor(mode), today);
  }
  if (tried.error) return { ...none, mode, issue: tried.error.code === 'installment_too_low' ? CANNOT_AMORTIZE : CANNOT_PREVIEW };

  const { before, after, backdated, impacted } = tried.result;
  return { ...none, mode, tooLow, draft: draftFor(mode), before, after, unchanged: sameFigures(before, after), backdated, impacted: impactedFor(impacted) };
}
