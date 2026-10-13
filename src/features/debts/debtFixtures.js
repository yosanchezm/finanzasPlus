import { serializeTerms } from '@finance-core';

// Shared builders for the debt UI tests: a 12-installment French loan at 24% EA
// (installment 93,453; first interest 18,088, second 16,724).
export const INSTALLMENT = 93453;

export const TERMS = {
  kind: 'consumer', principalMinor: 1000000, openedOn: '2026-01-05', system: 'french', periodicity: 'monthly', n: 12, firstDueOn: '2026-02-05',
  rate: { value: 24, basis: 'effective', periodicity: 'annual', timing: 'arrears' },
};

export const makeDebt = (overrides = {}, terms = {}) => ({
  $id: 'd1', householdId: 'h1', name: 'Crédito de consumo', lender: 'Banco Andino', kind: 'consumer', ownerScope: 'you', status: 'active',
  currency: 'COP', principalMinor: 1000000, openedOn: '2026-01-05', termsVersion: 1, actorId: 'u1', termsJson: serializeTerms({ ...TERMS, ...terms }), ...overrides,
});

export const makeEvent = (id, kind, effectiveOn, amountMinor, payload = {}) => ({
  $id: id, $createdAt: `${effectiveOn}T10:00:00.000Z`, debtId: 'd1', kind, effectiveOn, amountMinor, payloadJson: JSON.stringify(payload), actorId: 'u1', source: 'web', dedupeKey: `k${id}`,
});

export const makePayment = (id, effectiveOn, amountMinor = INSTALLMENT) => makeEvent(id, 'payment', effectiveOn, amountMinor);

// The spec's reference loan: 10,000,000 at 24% EA over 36 months with a 10,000 fee per installment.
// First installment 390,381 = principal 199,505 + interest 180,876 + fee 10,000 (cost 190,876).
export const makeBigLoan = () => makeDebt({ principalMinor: 10000000 }, {
  principalMinor: 10000000, n: 36,
  charges: [{ id: 'fee', kind: 'fee', label: 'Comisión', basis: 'fixed', value: 10000, cadence: 'per_installment' }],
});
