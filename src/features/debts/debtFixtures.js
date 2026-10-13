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

// The core's independent card fixture: 28% EA, statement day 15, due day 30, 500,000 revolving, a 1,200,000 purchase in
// 12 installments at 0%, and a 9,000 fee plus IVA. Statement 1 (2026-04-15): minimum 146,102, pay in full 621,102.
export const CARD_TERMS = {
  kind: 'card', principalMinor: 500000, openedOn: '2026-04-01', system: 'none', periodicity: 'monthly',
  rate: { value: 28, basis: 'effective', periodicity: 'annual', timing: 'arrears' },
  charges: [
    { id: 'mgmt_fee', kind: 'fee', label: 'Cuota de manejo', basis: 'fixed', value: 9000 },
    { id: 'mgmt_iva', kind: 'tax', label: 'IVA', basis: 'pctOfCharge', refId: 'mgmt_fee', value: 19 },
  ],
  card: {
    statementDay: 15, dueDay: 30, minPayment: { rule: 'interest_fees_plus_pct', pct: 5, floorMinor: 20000 },
    deferred: [{ id: 'nevera', label: 'Nevera', principalMinor: 1200000, n: 12, rate: { convention: 'ZERO' } }],
  },
};

export const makeCard = (overrides = {}) => ({
  $id: 'c1', householdId: 'h1', name: 'Visa Gold', lender: 'Banco Andino', kind: 'card', ownerScope: 'you', status: 'active', currency: 'COP',
  principalMinor: 500000, openedOn: '2026-04-01', termsVersion: 1, actorId: 'u1', termsJson: serializeTerms(CARD_TERMS), ...overrides,
});
