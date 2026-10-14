import { ValidationError, isIsoDate, previewChange, project, rateLabel } from '../../../packages/finance-core/index.js';
import { pesos } from './format.js';
import { describeCoreError, usuryLines } from './preview.js';

// Plan changes of Nia (NI2, NI7): `rate_change` now and `charge_change` next. The model only extracts; every
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
