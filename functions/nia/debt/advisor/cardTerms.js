import { ValidationError, addExplicitCharge, defaultLateFor, lastStatementOn, presetCharges, validateTerms } from '../../../../packages/finance-core/index.js';
import { MIN_RULES } from '../extract.js';
import { buildTerms } from '../preview.js';

// Terms of a described debt (the advisor, S5). The pending stores the case, not the terms: they are rebuilt here at the preview and again
// at Confirm (design G13). Anything the user has not decided is an error, never a provisional value. Pure and Node 16 safe.

/** IVA rate when the user says «más IVA» or «IVA incluido» without a percentage. */
export const DEFAULT_IVA_PCT = 19;
const DEFAULT_MIN_PCT = 5;

/** The question for a preset that was mentioned without an amount. */
export const AMOUNT_ASK = {
  fee: '¿Cuánto es la cuota de manejo o comisión? Escríbela en pesos por cuota.',
  life: '¿Cuánto es el seguro de vida? Escríbelo como porcentaje del saldo, por ejemplo 0,05.',
  insurance: '¿Cuánto es el otro seguro? Escríbelo en pesos por cuota.',
};

const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const incomplete = (what) => new ValidationError('setup_incomplete', `the described debt is missing ${what}`);

/** The mora of the case: what the user stated, else the default of the kind (usury for cards and consumer loans, none for family). */
export function lateFor(setupCase) {
  if (setupCase.lateStated === 'none') return { mode: 'none', graceDays: 0 };
  if (setupCase.lateStated === 'usury') return { mode: 'usury', graceDays: 0 };
  return defaultLateFor(setupCase.kind);
}

// A price that includes the IVA holds the fee as round(stated / (1 + IVA / 100)); the reply labels it approximate.
function presetSelection(presets) {
  const selected = {};
  for (const key of ['fee', 'life', 'insurance']) if (has(presets, key)) selected[key] = presets[key];
  const included = presets.ivaIncluded === true;
  const iva = presets.iva === undefined && included ? DEFAULT_IVA_PCT : presets.iva;
  if (iva !== undefined) selected.iva = iva;
  if (included && typeof selected.fee === 'number') selected.fee = Math.round(selected.fee / (1 + iva / 100));
  if (presets.gmf === true) selected.gmf = true;
  return selected;
}

/**
 * The charges of a case: the presets through the core, then the explicit charges (a `pctOfCharge` resolves its `refLabel` by code).
 * @param {object} setupCase
 * @param {{ card: boolean }} options `card`: the ids and labels the web stores for a card fee.
 * @throws {ValidationError} `preset_amount_missing`, `preset_requires_fee`, `charge_ref_unknown`, `charge_ref_ambiguous`, `invalid_charge`
 */
export function setupCharges(setupCase, { card }) {
  let charges = presetCharges(presetSelection(setupCase.presets || {}), { card });
  for (const item of setupCase.charges || []) charges = addExplicitCharge(charges, item);
  return charges;
}

const isDay = (value) => Number.isInteger(value) && value >= 1 && value <= 31;

/**
 * The opening date of a described card. With a stated balance, the card is registered from its last statement (the latest statement day
 * on or before the day of the case), so the core bills that statement as the opening one and its minimum is due on the usual due date.
 * Without a balance it opens on the day of the case, as before.
 */
export function cardOpenedOn(setupCase) {
  const card = setupCase.card || {};
  if (!(setupCase.principalMinor > 0) || !isDay(card.statementDay)) return setupCase.openedOn;
  return lastStatementOn(card.statementDay, setupCase.openedOn);
}

/**
 * Validated terms of a described card: system `none`, monthly, the mora of the case and the card charges. No card limit is ever written.
 * @throws {ValidationError} `setup_incomplete` for a missing rate, day or minimum rule, plus the core's errors
 */
export function buildCardTerms(setupCase) {
  const card = setupCase.card || {};
  if (!setupCase.rate) throw incomplete('the rate');
  if (!MIN_RULES.includes(card.minRule)) throw incomplete('the minimum payment rule');
  if (card.statementDay === null || card.statementDay === undefined) throw incomplete('the statement day');
  if (card.dueDay === null || card.dueDay === undefined) throw incomplete('the due day');
  const late = lateFor(setupCase);
  return validateTerms({
    kind: 'card',
    principalMinor: setupCase.principalMinor || 0,
    openedOn: cardOpenedOn(setupCase),
    rate: setupCase.rate,
    system: 'none',
    periodicity: 'monthly',
    charges: setupCharges(setupCase, { card: true }),
    ...(late.mode === 'none' ? {} : { late }),
    card: {
      statementDay: card.statementDay,
      dueDay: card.dueDay,
      minPayment: { rule: card.minRule, pct: card.minPct ?? DEFAULT_MIN_PCT, floorMinor: card.minFloorMinor ?? 0 },
      // The minimum of the last statement, only when the case states one (the extraction does not ask it today).
      ...(Number.isSafeInteger(card.openingMinimumMinor) ? { openingMinimumMinor: card.openingMinimumMinor } : {}),
    },
  });
}

/**
 * Validated terms of a described loan. The plan defaults are the ones of a plain create: French and monthly, first installment one period after opening.
 * @throws {ValidationError} `setup_incomplete` for a missing rate, principal or term, plus the core's errors
 */
export function buildLoanTerms(setupCase) {
  if (!setupCase.rate) throw incomplete('the rate');
  if (!Number.isSafeInteger(setupCase.principalMinor) || setupCase.principalMinor <= 0) throw incomplete('the principal');
  const system = setupCase.system || (setupCase.kind === 'informal' ? 'none' : 'french');
  if (system !== 'none' && !setupCase.n) throw incomplete('the number of installments');
  return buildTerms({
    kind: setupCase.kind,
    principalMinor: setupCase.principalMinor,
    openedOn: setupCase.openedOn,
    rate: setupCase.rate,
    system,
    periodicity: setupCase.periodicity || 'monthly',
    n: setupCase.n,
    firstDueOn: setupCase.firstDueOn,
    charges: setupCharges(setupCase, { card: false }),
    late: lateFor(setupCase),
  });
}

/** The terms of any described debt: a card or a loan. */
export const buildSetupTerms = (setupCase) => (setupCase.kind === 'card' ? buildCardTerms(setupCase) : buildLoanTerms(setupCase));
