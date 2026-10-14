import { isIsoDate } from '../calendar.js';
import { ValidationError } from '../errors.js';
import { project } from '../ledger/project.js';
import { snapshot } from '../ledger/snapshot.js';
import { assertMinor, roundUnit } from '../money.js';
import { toEffectiveAnnual } from '../rates.js';

// Prepayment simulation (DPA-1): replay project() with and without a
// hypothetical extra_payment event. Nothing is written and no input is touched.

export const STRATEGIES = Object.freeze(['reduce_term', 'reduce_installment', 'advance_installments']);

// Sorts after every real event of the same day, so the simulated payment is the last one applied.
const SIMULATED = Object.freeze({ id: 'simulation:extra', createdAt: '9999-12-31T23:59:59.999Z' });

// Interest and charges over the whole life of the debt: already paid plus still to pay.
const lifetimeInterest = ({ totals }) => totals.interestPaid + totals.remainingInterest;
const lifetimeCharges = ({ totals }) => totals.chargesPaid + totals.taxesPaid + totals.remainingCharges + totals.remainingTaxes;

function validate({ amountMinor, strategy, on }) {
  if (assertMinor(amountMinor, 'amountMinor') <= 0) throw new ValidationError('invalid_amount', 'the extra amount must be greater than 0');
  if (!STRATEGIES.includes(strategy)) throw new ValidationError('invalid_strategy', `strategy must be one of ${STRATEGIES.join(', ')}, got ${String(strategy)}`);
  if (!isIsoDate(on)) throw new ValidationError('invalid_date', `on must be a real YYYY-MM-DD date, got ${String(on)}`);
}

/**
 * Simulates an extra payment on a debt and reports the plan before and after,
 * the interest and charges saved versus not prepaying, and the (informational)
 * prepayment penalty. The extra first covers what is already due, as in
 * `project()`; `reduce_term` only shortens the term of French loans (other
 * systems keep their term under both reduce strategies).
 * @param {object} debt A `debts` row (see `project`).
 * @param {object[]} events The debt's `debt_events` rows.
 * @param {{ amountMinor: number, strategy: 'reduce_term' | 'reduce_installment' | 'advance_installments', on: string }} request
 * @returns {object} `{ strategy, on, amountMinor, kind, system, eaPercent, before, after, savings: { interestMinor, chargesMinor },
 *   appliedMinor, extraPrincipalMinor, surplusMinor, paidOff, penaltyPct, penaltyMinor }`
 * @throws {ValidationError}
 */
export function simulateExtra(debt, events, request) {
  validate(request);
  const { amountMinor, strategy, on } = request;
  const baseline = project(debt, events, on);
  const draft = { id: SIMULATED.id, createdAt: SIMULATED.createdAt, kind: 'extra_payment', effectiveOn: on, amountMinor, payload: { strategy } };
  const simulated = project(debt, [...events, draft], on);
  const entry = simulated.applied.find((applied) => applied.eventId === SIMULATED.id);
  const surplusMinor = entry.allocation.surplus;
  const appliedMinor = amountMinor - surplusMinor;
  const extraPrincipalMinor = entry.extraPrincipalMinor ?? 0;
  const { terms } = simulated;
  const penaltyPct = terms.prepaymentPenaltyPct ?? 0;
  const penaltyBase = strategy === 'advance_installments' ? appliedMinor : extraPrincipalMinor;
  return {
    strategy,
    on,
    amountMinor,
    kind: terms.kind,
    system: terms.system,
    eaPercent: toEffectiveAnnual(terms.rate),
    before: snapshot(baseline, on),
    after: snapshot(simulated, on),
    savings: {
      interestMinor: lifetimeInterest(baseline) - lifetimeInterest(simulated),
      chargesMinor: lifetimeCharges(baseline) - lifetimeCharges(simulated),
    },
    appliedMinor,
    extraPrincipalMinor,
    surplusMinor,
    paidOff: simulated.balanceMinor === 0,
    penaltyPct,
    penaltyMinor: roundUnit((penaltyBase * penaltyPct) / 100, terms.roundingUnit ?? 1),
  };
}
