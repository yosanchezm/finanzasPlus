import { defaultLateFor, normalizeRate, toEffectiveAnnual } from '@finance-core';

// Pure form model of a mora (late interest) policy, shared by the wizard's Plan step and the "Configurar mora" dialog.
// A draft holds the strings the inputs hold; `lateFromDraft` converts them and lets the finance core judge the rest.

export const LATE_MODE_LABELS = {
  none: 'Sin mora',
  usury: 'Tasa máxima legal (usura)',
  fixed: 'Tasa fija',
  contract_multiple: 'Múltiplo de la tasa del contrato',
};

export const LATE_MODE_HINTS = {
  none: 'Las cuotas vencidas no generan intereses de mora.',
  usury: 'Las cuotas vencidas generan mora a la tasa máxima legal vigente.',
  fixed: 'Las cuotas vencidas generan mora a esta tasa, sin pasar el tope legal.',
  contract_multiple: 'Las cuotas vencidas generan mora a un múltiplo de la tasa del contrato, sin pasar el tope legal.',
};

export const MAX_MULTIPLE = 3;
export const MAX_GRACE_DAYS = 90;

const BLANK_LATE_RATE = { value: '', basis: 'effective', periodicity: 'annual', timing: 'arrears' };
const blank = (text) => String(text).trim() === '';
const num = (text) => (blank(text) ? NaN : Number(text));

/** The mora a new debt of this kind starts with, as form strings. */
export function defaultLateDraft(kind) {
  const { mode, graceDays } = defaultLateFor(kind);
  return { mode, graceDays: String(graceDays), multiple: '', rate: BLANK_LATE_RATE };
}

/** The form draft of a stored policy (`terms.late`); an absent policy is `none`. */
export function lateDraftOf(late) {
  return {
    mode: late?.mode ?? 'none',
    graceDays: String(late?.graceDays ?? 0),
    multiple: late?.multiple === undefined ? '' : String(late.multiple),
    rate: late?.rate ? { value: String(late.rate.value), basis: late.rate.basis, periodicity: late.rate.periodicity, timing: late.rate.timing } : BLANK_LATE_RATE,
  };
}

/** The raw policy of a draft, ready for the core's `normalizeLate`. A blank rate or multiple is `NaN`, so the core rejects it. */
export function lateFromDraft(draft) {
  const late = { mode: draft.mode, graceDays: blank(draft.graceDays) ? 0 : num(draft.graceDays) };
  if (draft.mode === 'fixed') late.rate = { value: num(draft.rate.value), basis: draft.rate.basis, periodicity: draft.rate.periodicity, timing: draft.rate.timing };
  if (draft.mode === 'contract_multiple') late.multiple = num(draft.multiple);
  return late;
}

const GRACE_MESSAGE = `Los días de gracia deben ser un número entero de 0 a ${MAX_GRACE_DAYS}.`;
const MULTIPLE_MESSAGE = `El múltiplo debe ser mayor que 0 y de hasta ${MAX_MULTIPLE} veces la tasa del contrato.`;

/** True when the draft's fixed rate is a real EA above zero (the core's rule for a `fixed` policy). */
function fixedRateAboveZero(rate) {
  try {
    return toEffectiveAnnual(normalizeRate({ value: num(rate.value), basis: rate.basis, periodicity: rate.periodicity, timing: rate.timing })) > 0;
  } catch {
    return false;
  }
}

/**
 * What is wrong with a draft, in friendly Spanish: `null` when it is valid, else `{ message, missing? }`
 * (`missing` marks a field that is still empty, which the form does not flag as an error yet).
 */
export function lateIssueOf(draft) {
  if (draft.mode === 'none') return null;
  const grace = blank(draft.graceDays) ? 0 : num(draft.graceDays);
  if (!Number.isInteger(grace) || grace < 0 || grace > MAX_GRACE_DAYS) return { message: GRACE_MESSAGE };
  if (draft.mode === 'fixed') {
    if (blank(draft.rate.value)) return { message: 'Escribe la tasa de la mora.', missing: true };
    if (!fixedRateAboveZero(draft.rate)) return { message: 'La tasa de la mora debe ser mayor que cero.' };
  }
  if (draft.mode === 'contract_multiple') {
    if (blank(draft.multiple)) return { message: 'Escribe el múltiplo de la tasa del contrato.', missing: true };
    const multiple = num(draft.multiple);
    if (!(multiple > 0 && multiple <= MAX_MULTIPLE)) return { message: MULTIPLE_MESSAGE };
  }
  return null;
}
