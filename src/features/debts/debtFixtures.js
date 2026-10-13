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
