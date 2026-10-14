import { ValidationError, buildRestructureTerms, compareIso, isIsoDate, previewChange, restructureCarry } from '@finance-core';
import { validateCharges } from './chargesEditorModel';
import { impactedFor } from './rateChangeModel';
import { fromTerms, toPlanFields } from './wizard/fromTerms';
import { SYSTEMS_BY_KIND, firstDueOf, rateEcho, usuryModality } from './wizard/wizardModel';

// Pure model of the "Reestructurar" dialog (three steps). The form holds strings, like the inputs. Step 1 reads the arrears
// the restructure refinances (`restructureCarry`), step 2 builds the new terms (`buildRestructureTerms`) and step 3 previews
// them (`previewChange`), so what the dialog shows equals the projection once the event is saved.

export const STEPS = [
  { key: 'situation', title: 'Situación actual' },
  { key: 'terms', title: 'Nuevas condiciones' },
  { key: 'summary', title: 'Resumen' },
];

const MAX_PERIODS = 2000; // as in the core
const EVENT_PAYLOAD_MAX_CHARS = 8000; // size of the event payload column
const INVALID_DATE = 'Elige una fecha válida.';
const NO_BALANCE = 'Esta deuda ya no tiene saldo para reestructurar.';
const CANNOT_PREVIEW = 'No se pudo calcular la reestructuración con esas condiciones. Revisa la tasa, las cuotas y las fechas.';
const CANNOT_READ = 'No se pudo leer el estado de la deuda en esa fecha.';
export const PAYLOAD_TOO_LARGE = 'Esta reestructuración es demasiado grande para guardarla en un solo cambio. Quita algunos cargos o reduce el número de cuotas.';

const ISSUE_MESSAGES = {
  n: 'Escribe cuántas cuotas tendrá el nuevo plan (entre 1 y 2000).',
  firstDueOn: 'La primera cuota debe ser después de la fecha de la reestructuración.',
  rate: 'Escribe la tasa de interés (0 si no cobra intereses).',
  grace: 'Las cuotas de gracia deben ser menos que el número de cuotas.',
  balloon: 'El pago final debe ser mayor que cero y no superar el saldo que se refinancia.',
  charges: 'Revisa los cargos señalados.',
  general: 'Revisa las condiciones del nuevo plan: no se pueden guardar así.',
};
// The field each core error belongs to; anything else is a general problem.
const ISSUE_FIELD = {
  invalid_first_due: 'firstDueOn', invalid_date: 'firstDueOn', invalid_grace: 'grace', grace_unsupported: 'grace',
  invalid_balloon: 'balloon', balloon_unsupported: 'balloon', invalid_rate: 'rate', invalid_charge: 'charges',
};

/** Payment systems the dialog offers for a debt kind: the wizard's, without a manual plan or a missing one. */
export function systemsFor(kind) {
  const offered = (SYSTEMS_BY_KIND[kind] ?? []).filter((system) => system !== 'manual' && system !== 'none');
  return offered.length > 0 ? offered : ['french'];
}

/**
 * The form a fresh dialog starts with: effective today, the terms in force as drafts (rate, system, periodicity, charges),
 * the installments still to pay as the number of installments, and no grace, balloon or fixed first due date (the old ones
 * belong to the old calendar). A first due date left blank follows the effective date.
 */
export function initialRestructureForm(projection, today) {
  const { terms } = projection;
  const draft = fromTerms(terms);
  const systems = systemsFor(terms.kind);
  const left = projection.remainingPeriods;
  return {
    effectiveOn: today,
    waiveLate: false,
    ...draft,
    system: systems.includes(draft.system) ? draft.system : systems[0],
    n: String(left > 0 ? left : terms.n ?? 1),
    firstDueOn: '',
    grace: { periods: '0', type: 'total' },
    balloon: '',
    manualPlan: [],
  };
}

function situationOf(debt, events, effectiveOn) {
  const none = { ok: false, issue: null, rows: [], totalMinor: 0, carry: null };
  if (!isIsoDate(effectiveOn)) return { ...none, issue: INVALID_DATE };
  let carry;
  try {
    carry = restructureCarry(debt, events, effectiveOn);
  } catch (error) {
    if (error instanceof ValidationError) return { ...none, issue: CANNOT_READ };
    throw error;
  }
  if (carry.carriedMinor <= 0) return { ...none, issue: NO_BALANCE };
  const { arrears } = carry;
  return {
    ok: true,
    issue: null,
    carry,
    rows: [
      { key: 'principal', label: 'Capital pendiente', minor: carry.balanceMinor },
      { key: 'interest', label: 'Intereses vencidos', minor: arrears.interest },
      { key: 'charges', label: 'Cargos e impuestos vencidos', minor: arrears.charges + arrears.taxes },
      { key: 'late', label: 'Intereses de mora', minor: arrears.lateInterest },
    ],
    totalMinor: carry.carriedMinor,
  };
}

const isWholeNumber = (text) => /^\d+$/.test(String(text).trim());

// Local checks first, so each message names its field; the core has the last word (`buildRestructureTerms`).
function buildPlan({ projection, form, carriedMinor, echo }) {
  const issues = {};
  const charges = validateCharges(form.chargeRows);
  if (!charges.ok) issues.charges = ISSUE_MESSAGES.charges;
  if (!echo.ok) issues.rate = ISSUE_MESSAGES.rate;
  const firstDueOn = form.firstDueOn || firstDueOf({ firstDueOn: '', openedOn: form.effectiveOn, periodicity: form.periodicity });
  const periods = Number(form.n);
  if (!isWholeNumber(form.n) || periods < 1 || periods > MAX_PERIODS) issues.n = ISSUE_MESSAGES.n;
  if (!isIsoDate(firstDueOn) || compareIso(firstDueOn, form.effectiveOn) <= 0) issues.firstDueOn = ISSUE_MESSAGES.firstDueOn;
  if (!issues.n && ['french', 'german'].includes(form.system) && Number(form.grace.periods) >= periods) issues.grace = ISSUE_MESSAGES.grace;
  if (Object.keys(issues).length > 0) return { ok: false, issues, terms: null };
  try {
    const overrides = { ...toPlanFields({ ...form, firstDueOn }), charges: charges.charges };
    const terms = buildRestructureTerms(projection.terms, { effectiveOn: form.effectiveOn, carriedMinor, overrides });
    return { ok: true, issues, terms };
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    const field = ISSUE_FIELD[error.code] ?? 'general';
    return { ok: false, issues: { [field]: ISSUE_MESSAGES[field] }, terms: null };
  }
}

/**
 * Everything steps 1 and 2 show, from the form. `situation` is the arrears breakdown (`rows` and their `totalMinor`, which
 * is the balance a restructure carries); `waivable` says whether there is mora to forgive, `waive` whether the choice is in
 * effect, and `carriedMinor` is the balance the new terms start from (less the mora when waived). `plan` is
 * `{ ok, issues, terms }`: the validated new terms, or the message of each field that is wrong. `echo` is the rate echo with
 * the informational usury notice for the effective date.
 * @param {{ debt: object, events: object[], projection: object, form: object }} input `projection` is the debt as of today.
 */
export function restructureView({ debt, events, projection, form }) {
  const situation = situationOf(debt, events, form.effectiveOn);
  const waivableMinor = situation.ok ? situation.carry.waivableLateMinor : 0;
  const waivable = waivableMinor > 0;
  const waive = waivable && form.waiveLate === true;
  const carriedMinor = situation.ok ? situation.totalMinor - (waive ? waivableMinor : 0) : 0;
  const echo = situation.ok ? rateEcho(form.rate, usuryModality(projection.terms.kind), form.effectiveOn, debt.legal) : { ok: false };
  const plan = situation.ok ? buildPlan({ projection, form, carriedMinor, echo }) : { ok: false, issues: {}, terms: null };
  return { situation, waivable, waivableMinor, waive, carriedMinor, echo, plan };
}

/**
 * The summary of step 3: the `restructure` draft to save and the debt before and after (`previewChange`), whether the
 * date is in the past (`backdated`, with the `impacted` payments), and `tooLarge` when the payload would not fit the event
 * column (then there is no draft and `issue` says why). Without a valid plan there is nothing to preview.
 */
export function previewRestructure({ debt, events, view, form, today }) {
  const none = { draft: null, before: null, after: null, backdated: false, impacted: [], payloadChars: 0, tooLarge: false, issue: null };
  if (!view.plan.ok) return none;
  const draft = { kind: 'restructure', effectiveOn: form.effectiveOn, terms: view.plan.terms, ...(view.waive ? { waiveLate: true } : {}) };
  let result;
  try {
    result = previewChange(debt, events, draft, { on: today });
  } catch (error) {
    if (error instanceof ValidationError) return { ...none, issue: CANNOT_PREVIEW };
    throw error;
  }
  const { before, after, backdated, impacted, payloadChars } = result;
  const tooLarge = payloadChars > EVENT_PAYLOAD_MAX_CHARS;
  return { ...none, draft: tooLarge ? null : draft, before, after, backdated, impacted: impactedFor(impacted), payloadChars, tooLarge, issue: tooLarge ? PAYLOAD_TOO_LARGE : null };
}

/** Whether the step's own data is good enough to leave it (step 3: whether there is something to save). */
export function canAdvance(step, view, preview) {
  if (step === 'situation') return view.situation.ok;
  if (step === 'terms') return view.situation.ok && view.plan.ok;
  return Boolean(preview?.draft);
}
