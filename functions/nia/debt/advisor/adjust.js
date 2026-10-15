import { ValidationError, normalizeLate, project, rateInForce, rateLabel, toEffectiveAnnual, versionTermsAt } from '../../../../packages/finance-core/index.js';
import { MIN_RULES } from '../extract.js';
import { findDebt } from '../findDebt.js';
import { CONVENTION_BUTTONS } from '../pending.js';
import { chargesInForce, rebuildCharges } from '../planChange.js';
import { conventionQuestion, describeCoreError } from '../preview.js';
import { AMOUNT_ASK } from './cardTerms.js';
import { unsupportedText } from './unsupported.js';

// The adjust mode of the advisor (S6b, design G13): compares the described case with the stored debt and lists the differences as steps. Pure and
// read-only. Data that was wrong from the start is a `terms_correction`; a real change is a `rate_change`, a `charge_change` or a `late_policy`;
// when it cannot tell it asks. Corrections go first, then rate, charges and mora (the order of the description). Each step becomes its own preview
// and its own Confirm in the chain (`chain.js`).

const AMOUNT_PRESETS = ['fee', 'life', 'insurance'];
const SAME_RATE_EA = 0.005;
const FIX_OR_CHANGE = (name) => `¿La tasa de ${name} estaba mal registrada desde el inicio (la corrijo desde la apertura) o cambió de verdad (por ejemplo, el banco la bajó o la subió)? Elige una opción:`;
const INVALID_DEBT = {
  debt_not_found: 'No encontré esa deuda entre las que tienes registradas. Dime su nombre y la ajusto; no guardé nada.',
};

const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const present = (value) => value !== null && value !== undefined;

// The stated card values that differ from the stored ones, and the words that name them for the label.
function cardDifferences(stated, stored) {
  const fields = {};
  const parts = [];
  const minPayment = {};
  if (present(stated.statementDay) && stated.statementDay !== stored.statementDay) { fields.statementDay = stated.statementDay; parts.push(`el día de corte a ${stated.statementDay}`); }
  if (present(stated.dueDay) && stated.dueDay !== stored.dueDay) { fields.dueDay = stated.dueDay; parts.push(`el día de pago a ${stated.dueDay}`); }
  if (MIN_RULES.includes(stated.minRule) && stated.minRule !== stored.minPayment.rule) { minPayment.rule = stated.minRule; parts.push('la regla del pago mínimo'); }
  if (present(stated.minPct) && stated.minPct !== stored.minPayment.pct) { minPayment.pct = stated.minPct; parts.push(`el porcentaje del pago mínimo a ${stated.minPct} %`); }
  if (present(stated.minFloorMinor) && stated.minFloorMinor !== stored.minPayment.floorMinor) { minPayment.floorMinor = stated.minFloorMinor; parts.push('el piso del pago mínimo'); }
  if (Object.keys(minPayment).length > 0) fields.minPayment = minPayment;
  return { fields, parts };
}

// One add per group: the presets with the first explicit charge, then one more for each other explicit charge.
function chargeGroups(c) {
  const explicit = c.charges || [];
  const groups = [{ presets: { ...(c.presets || {}) }, charge: explicit[0] || null }, ...explicit.slice(1).map((charge) => ({ presets: {}, charge }))];
  return groups.filter((group) => Object.keys(group.presets).length > 0 || group.charge);
}

function unsupportedOf(c) {
  const codes = (c.mentions || []).slice();
  if (c.lateStated === 'whole_installment' && !codes.includes('mora_base')) codes.push('mora_base');
  if (c.lateStated === 'fixed') codes.push('mora_fixed');
  return codes.filter((code) => unsupportedText([code]) !== '').map((code) => ({ code, text: unsupportedText([code]) }));
}

function rateDecision(c, debt, projection, plan) {
  if (!c.rate) {
    if (c.rateValue !== null && c.rateValue !== undefined) plan.questions.push({ field: 'convention', text: conventionQuestion(c.rateValue), blocking: true, options: CONVENTION_BUTTONS.slice() });
    return;
  }
  if (Math.abs(toEffectiveAnnual(c.rate) - toEffectiveAnnual(rateInForce(projection))) < SAME_RATE_EA) {
    plan.same = true;
  } else if (c.adjustKind === 'fix') {
    plan.corrections.rate = c.rate;
    plan.parts.push(`la tasa a ${rateLabel(c.rate)}`);
  } else if (c.adjustKind === 'change') {
    plan.later.push({ action: 'rate_change', draft: { effectiveOn: c.changeOn || plan.today, rate: c.rate }, label: `Cambiar la tasa a ${rateLabel(c.rate)}` });
  } else {
    plan.questions.push({ field: 'fix_or_change', text: FIX_OR_CHANGE(debt.name), blocking: true, options: ['fix', 'change'] });
  }
}

function chargeDecision(c, debt, projection, plan) {
  const charges = chargesInForce(projection, debt.events, plan.today);
  for (const key of AMOUNT_PRESETS) {
    if (c.presets && has(c.presets, key) && c.presets[key] === null) plan.questions.push({ field: `amount:${key}`, text: AMOUNT_ASK[key], blocking: true });
  }
  const asked = plan.questions.some((question) => question.field.startsWith('amount:'));
  if (asked) return;
  for (const add of chargeGroups(c)) {
    const rebuilt = rebuildCharges(charges, { op: 'add', add }, { card: Boolean(projection.card) });
    if (rebuilt.code === 'preset_exists') {
      plan.assumptions.push({ code: 'charge_exists', text: 'La deuda ya tiene ese cargo, así que no lo agrego. Si cambió su valor, pídeme “cambia el cargo a …”.' });
    } else if (rebuilt.issue) {
      plan.invalid.push({ code: rebuilt.code, text: rebuilt.issue });
    } else {
      plan.later.push({ action: 'charge_change', draft: { effectiveOn: c.changeOn || plan.today, op: 'add', add }, label: `Agregar ${rebuilt.added.map((charge) => charge.label).join(', ')}` });
    }
  }
}

function lateDecision(c, projection, plan) {
  if (c.lateStated !== 'usury' && c.lateStated !== 'none') return;
  const late = { mode: c.lateStated, graceDays: 0 };
  if (JSON.stringify(normalizeLate(projection.terms.late)) === JSON.stringify(normalizeLate(late))) {
    plan.assumptions.push({ code: 'late_same', text: 'La mora ya está así en la deuda; no la cambio.' });
    return;
  }
  plan.later.push({ action: 'late_policy', draft: { effectiveOn: c.changeOn || plan.today, late }, label: c.lateStated === 'usury' ? 'Poner la mora a la tasa de usura' : 'Quitar la mora' });
}

/**
 * @param {object} c The merged `SetupCase` with `adjust: true`, `debtRef`, `adjustKind` ('fix' | 'change' | null) and `changeOn`.
 * @param {object[]} debts The debts the user can adjust, each with its `events`.
 * @param {string} today `YYYY-MM-DD`
 * @returns {{ mode: 'adjust', draft: null, steps: { action: string, draft: object, label: string }[], assumptions: object[], questions: object[],
 *   unsupported: object[], invalid: object[], preview: null }} `steps` lists corrections first. `invalid` (the debt is unknown or ambiguous, a charge cannot be
 *   built) leaves no steps.
 */
export function proposeAdjust(c, debts, today) {
  const base = { mode: 'adjust', draft: null, steps: [], assumptions: [], questions: [], unsupported: unsupportedOf(c), invalid: [], preview: null };
  const found = findDebt(debts, c.debtRef);
  if (!found.match) {
    const invalid = found.candidates
      ? { code: 'debt_ambiguous', text: `Puede ser ${found.candidates.map((debt) => debt.name).join(', ')}. Dime cuál quieres ajustar; no guardé nada.` }
      : { code: 'debt_not_found', text: INVALID_DEBT.debt_not_found };
    return { ...base, unsupported: [], invalid: [invalid] };
  }
  const debt = found.match;
  let projection;
  let version;
  try {
    projection = project(debt, debt.events, today);
    version = versionTermsAt(debt, debt.events, today).terms;
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    return { ...base, unsupported: [], invalid: [{ code: error.code, text: describeCoreError(error) }] };
  }
  const plan = { today, corrections: {}, parts: [], later: [], assumptions: [], questions: [], invalid: [], same: false };
  if (projection.card) {
    const differences = cardDifferences(c.card || {}, version.card);
    if (Object.keys(differences.fields).length > 0) {
      plan.corrections.card = differences.fields;
      plan.parts.push(...differences.parts);
      if (c.adjustKind === 'change') plan.assumptions.push({ code: 'card_days_as_correction', text: 'El corte, el día de pago y el pago mínimo no tienen un cambio con fecha: los registro como corrección, que aplica desde el inicio de la deuda.' });
    } else if (Object.values(c.card || {}).some((value) => present(value) && value !== 'unknown')) {
      plan.same = true;
    }
  }
  rateDecision(c, debt, projection, plan);
  chargeDecision(c, debt, projection, plan);
  lateDecision(c, projection, plan);
  if (plan.invalid.length > 0) return { ...base, invalid: plan.invalid };
  const steps = [];
  if (Object.keys(plan.corrections).length > 0) steps.push({ action: 'terms_correction', draft: plan.corrections, label: `Corregir ${plan.parts.join(', ')}` });
  steps.push(...plan.later);
  const assumptions = [...plan.assumptions];
  if (steps.length === 0 && plan.questions.length === 0 && base.unsupported.length === 0 && (plan.same || assumptions.length === 0)) {
    assumptions.push({ code: 'same_as_stored', text: `Lo que describes ya coincide con lo registrado en ${debt.name}.` });
  }
  return { ...base, steps, assumptions, questions: plan.questions };
}
