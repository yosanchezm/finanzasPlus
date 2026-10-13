import { buildSchedule } from '../../src/schedule/index.js';

// Compact fixtures shared by the prepayment and advice tests.

export const EA = (value) => ({ value, basis: 'effective', periodicity: 'annual', timing: 'arrears' });

export const french = (overrides = {}) => ({
  kind: 'consumer',
  principalMinor: 10_000_000,
  openedOn: '2026-01-15',
  rate: EA(24),
  system: 'french',
  periodicity: 'monthly',
  n: 36,
  firstDueOn: '2026-02-15',
  ...overrides,
});

export const interestFree = (overrides = {}) =>
  french({ kind: 'family', principalMinor: 1_200_000, n: 12, rate: { convention: 'ZERO' }, ...overrides });

export const debt = (terms, id = 'd1') => ({ $id: id, householdId: 'h1', name: 'Credito', ownerScope: 'shared', terms });

let counter = 0;
export const ev = (kind, effectiveOn, amountMinor, payload = {}, id = `e${(counter += 1)}`) => ({
  $id: id,
  debtId: 'd1',
  kind,
  effectiveOn,
  amountMinor,
  payloadJson: JSON.stringify(payload),
  $createdAt: '2026-01-01T00:00:00.000Z',
});

/** The first `count` installments paid in full on their due dates. */
export const onTime = (terms, count) =>
  buildSchedule(terms)
    .slice(0, count)
    .map((row, index) => ev('payment', row.dueOn, row.totalDueMinor, {}, `on${index + 1}`));

export function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}
