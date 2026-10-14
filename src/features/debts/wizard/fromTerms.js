import { draftsFromCharges } from '../chargesEditorModel';
import { toRate } from './wizardModel';

// The inverse of the wizard's `toTerms` for the plan fields: DebtTerms to the strings the plan inputs hold (`PlanStep`,
// `RateField`, the charges editor), and back to the numeric fields a `restructure` builds its terms from. Both are pure.

const num = (text) => (String(text).trim() === '' ? NaN : Number(text));
const pesos = (text) => Math.round(num(text));
const GRACE_SYSTEMS = ['french', 'german'];

/**
 * The editable draft of the terms in force. Field names follow the wizard state (`rate`, `system`, `periodicity`, `n`,
 * `firstDueOn`, `grace`, `balloon`, `manualPlan`), plus `chargeRows`, the drafts of the charges editor.
 * @param {object} terms Validated DebtTerms (`projection.terms`).
 */
export function fromTerms(terms) {
  const { value, basis, periodicity, timing } = terms.rate;
  return {
    rate: { value: String(value), basis, periodicity, timing },
    system: terms.system,
    periodicity: terms.periodicity,
    n: terms.n === undefined ? '' : String(terms.n),
    firstDueOn: terms.firstDueOn ?? '',
    grace: { periods: String(terms.grace?.periods ?? 0), type: terms.grace?.type ?? 'total' },
    balloon: terms.balloonMinor === undefined ? '' : String(terms.balloonMinor),
    manualPlan: (terms.manualPlan ?? []).map(([dueOn, amount]) => ({ dueOn, amount: String(amount) })),
    chargeRows: draftsFromCharges(terms.charges),
  };
}

/**
 * The numeric plan fields of a draft, ready to lay over the terms in force: rate, system, periodicity, then the number
 * of installments and the first due date (or the manual rows), the grace a French or German plan supports and the balloon
 * of an interest-only plan. A blank number is `NaN`, so the core rejects it instead of guessing. Charges are not here:
 * `validateCharges` turns the rows into real ones.
 * @param {object} draft See `fromTerms`; `firstDueOn` must already be filled in.
 */
export function toPlanFields(draft) {
  const fields = { rate: toRate(draft.rate), system: draft.system, periodicity: draft.periodicity };
  if (draft.system === 'manual') fields.manualPlan = draft.manualPlan.map((row) => [row.dueOn, pesos(row.amount)]);
  else {
    fields.n = num(draft.n);
    fields.firstDueOn = draft.firstDueOn;
  }
  if (GRACE_SYSTEMS.includes(draft.system) && num(draft.grace.periods) > 0) fields.grace = { periods: num(draft.grace.periods), type: draft.grace.type };
  if (draft.system === 'interest_only' && String(draft.balloon).trim() !== '') fields.balloonMinor = pesos(draft.balloon);
  return fields;
}
