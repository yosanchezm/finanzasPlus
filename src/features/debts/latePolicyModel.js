import { ValidationError, capOn, isIsoDate, lateEAOn, legalOf, modalityOf, normalizeLate, previewChange, toEffectiveAnnual } from '@finance-core';
import { formatDecimal, formatEa } from './debtLabels';
import { LATE_MODE_LABELS, lateDraftOf, lateFromDraft, lateIssueOf } from './lateModel';
import { impactedFor } from './rateChangeModel';

// Pure model of the "Configurar mora" dialog. The form holds strings, like the inputs; the preview is the core's
// `previewChange` with a `late_policy` draft, so what the dialog shows equals the projection once the event is saved.

const INVALID_DATE = 'Elige una fecha válida.';
const CANNOT_PREVIEW = 'No se pudo calcular la mora con esos datos. Revisa la política y la fecha.';

/** The form a fresh dialog starts with: the policy in force, effective today. */
export function initialLateForm(projection, today) {
  return { effectiveOn: today, late: lateDraftOf(projection.terms.late) };
}

const sameLate = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const laterOf = (a, b) => (a > b ? a : b);

// Annual rate (% EA) mora accrues at on `asOf` under a policy, or null when it is off.
function rateOn(terms, late, asOf, legal) {
  const { ea, notices } = lateEAOn({ ...terms, late }, asOf, legal);
  return { ea: normalizeLate(late).mode === 'none' ? null : ea, notices };
}

// The legal notices of the policy as of the measured day, from the projection and from the rate lookup itself: a cap table
// that stops before today is worth saying even when nothing is overdue yet.
function noticesFor(afterNotices, lookup) {
  const seen = new Set();
  return [...afterNotices, ...lookup].filter((notice) => notice.code.startsWith('late_') && !seen.has(notice.code) && seen.add(notice.code));
}

/**
 * Preview of a mora policy form. `form` is `{ effectiveOn, late }` (`late` is a `lateModel` draft), `projection` the debt as
 * of today. Returns `issue` (a message, or null while a field is merely empty), and once valid the `draft` to save, the
 * `before` and `after` snapshots measured at `asOf` (the later of today and the effective date), `backdated`, the `impacted`
 * payments, `unchanged`, the annual `rates` in force before and after (null when mora is off), the `capEA` of the modality
 * on that day (null when none is known) and the legal `notices` (stale or unknown cap, mortgage rules not applied).
 */
export function previewLatePolicy({ debt, events, projection, form, today }) {
  const none = { issue: null, draft: null, before: null, after: null, asOf: today, backdated: false, impacted: [], unchanged: false, rates: { before: null, after: null }, capEA: null, notices: [] };
  if (!isIsoDate(form.effectiveOn)) return { ...none, issue: INVALID_DATE };
  const problem = lateIssueOf(form.late);
  if (problem) return { ...none, issue: problem.missing ? null : problem.message };

  try {
    const late = normalizeLate(lateFromDraft(form.late));
    const draft = { kind: 'late_policy', effectiveOn: form.effectiveOn, late };
    const { before, after, backdated, impacted, notices } = previewChange(debt, events, draft, { on: today });
    const asOf = laterOf(today, form.effectiveOn);
    const { terms } = projection;
    const legal = legalOf(debt);
    const current = rateOn(terms, terms.late, asOf, legal);
    const next = rateOn(terms, late, asOf, legal);
    const cap = capOn(legal.usuryTable, modalityOf(terms), asOf);
    return {
      ...none, draft, before, after, asOf, backdated, impacted: impactedFor(impacted), unchanged: sameLate(normalizeLate(terms.late), late),
      rates: { before: current.ea, after: next.ea }, capEA: cap?.capEA ?? null, notices: noticesFor(notices, next.notices),
    };
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    return { ...none, issue: CANNOT_PREVIEW };
  }
}

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/** "tasa fija 36,00 % E.A. · gracia de 3 días": a stored policy in one line, for the dialog's header. */
export function describeLate(late) {
  const { mode, rate, multiple, graceDays } = normalizeLate(late);
  let text = LATE_MODE_LABELS[mode].toLowerCase();
  if (mode === 'fixed') text = `tasa fija ${formatEa(toEffectiveAnnual(rate))}`;
  else if (mode === 'contract_multiple') text = `${formatDecimal(multiple)} veces la tasa del contrato`;
  return graceDays > 0 && mode !== 'none' ? `${text} · gracia de ${plural(graceDays, 'día', 'días')}` : text;
}
