import { ValidationError, activeEvents, compareIso, isIsoDate, previewChange, sortEvents } from '@finance-core';
import { draftsFromCharges, validateCharges } from './chargesEditorModel';
import { impactedFor } from './rateChangeModel';

// Pure model of the "Cambiar seguros y cargos" dialog. The form holds the charge drafts of the editor; the preview is
// the core's `previewChange` over a `charge_change` draft, so what the dialog shows equals the projection once the
// event is saved. The edited set replaces the old one from the effective date (`applyChargeChange` in the core).

const INVALID_DATE = 'Elige una fecha válida.';
const CANNOT_PREVIEW = 'No se pudo calcular el cambio con esos cargos. Revisa los valores y la fecha.';
export const PAYLOAD_TOO_LARGE = 'Son demasiados cargos para guardarlos en un solo cambio. Quita algunos.';
const EVENT_PAYLOAD_MAX_CHARS = 8000;

/**
 * The charges in force on `today`. A loan's projection already applies its stored changes, so its terms are the answer.
 * A card's projection keeps the original terms, so the active `charge_change` events up to today are folded in here.
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

/** The form a fresh dialog starts with: the charges in force as drafts, effective today. */
export function initialChargeForm(projection, events, today) {
  return { effectiveOn: today, rows: draftsFromCharges(chargesInForce(projection, events, today)) };
}

const sameFigures = (before, after) => before.nextTotalMinor === after.nextTotalMinor && before.remainingChargesMinor === after.remainingChargesMinor;

function attempt(debt, events, draft, today) {
  try {
    return { result: previewChange(debt, events, draft, { on: today }) };
  } catch (error) {
    if (error instanceof ValidationError) return { error };
    throw error;
  }
}

/**
 * Preview of a charge change form. `form` is `{ effectiveOn, rows }` (the editor's drafts), `projection` the debt as of
 * today. Returns the editor's `check` (its `issues` show inline), and, once the date and every row are valid and the set
 * differs from the one in force, the `draft` to save, the `before` and `after` snapshots (`nextTotalMinor`, a card's
 * minimum payment, and `remainingChargesMinor`), `backdated`, the `impacted` payments and `unchanged` (no figure moves).
 * `same` is true while the set equals the one in force; `issue` carries a form-level message.
 */
export function previewChargeChange({ debt, events, projection, form, today }) {
  const check = validateCharges(form.rows);
  const none = { isCard: Boolean(projection.card), check, issue: null, draft: null, before: null, after: null, same: false, unchanged: false, backdated: false, impacted: [] };
  if (!isIsoDate(form.effectiveOn)) return { ...none, issue: INVALID_DATE };
  if (!check.ok) return none;
  const current = JSON.stringify(chargesInForce(projection, events, today));
  if (JSON.stringify(check.charges) === current) return { ...none, same: true };

  const draft = { kind: 'charge_change', effectiveOn: form.effectiveOn, charges: check.charges };
  const tried = attempt(debt, events, draft, today);
  if (tried.error) return { ...none, issue: CANNOT_PREVIEW };
  const { before, after, backdated, impacted, payloadChars } = tried.result;
  if (payloadChars > EVENT_PAYLOAD_MAX_CHARS) return { ...none, issue: PAYLOAD_TOO_LARGE };
  return { ...none, draft, before, after, backdated, impacted: impactedFor(impacted), unchanged: sameFigures(before, after) };
}
