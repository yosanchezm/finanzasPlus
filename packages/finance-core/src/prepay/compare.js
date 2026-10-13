import { simulateExtra } from './simulate.js';

// Same outcome means the debt ends in the same state with the same savings.
const outcome = ({ after, savings }) => JSON.stringify({ after, savings });

/**
 * Simulates the same extra payment under the three strategies. Under a system
 * other than French both reduce strategies keep the term, so they can come out
 * identical: `identical` and a `strategies_identical` note say so instead of
 * presenting two different options.
 * @param {object} debt A `debts` row (see `project`).
 * @param {object[]} events The debt's `debt_events` rows.
 * @param {{ amountMinor: number, on: string }} request
 * @returns {{ on: string, amountMinor: number, kind: string, system: string, eaPercent: number, reduceTerm: object,
 *   reduceInstallment: object, advance: object, identical: boolean, notes: object[] }}
 * @throws {ValidationError}
 */
export function compareStrategies(debt, events, request) {
  const run = (strategy) => simulateExtra(debt, events, { ...request, strategy });
  const reduceTerm = run('reduce_term');
  const reduceInstallment = run('reduce_installment');
  const advance = run('advance_installments');
  const identical = outcome(reduceTerm) === outcome(reduceInstallment);
  const { on, amountMinor, kind, system, eaPercent } = reduceTerm;
  return {
    on,
    amountMinor,
    kind,
    system,
    eaPercent,
    reduceTerm,
    reduceInstallment,
    advance,
    identical,
    notes: identical ? [{ code: 'strategies_identical', system, paidOff: reduceTerm.paidOff }] : [],
  };
}
