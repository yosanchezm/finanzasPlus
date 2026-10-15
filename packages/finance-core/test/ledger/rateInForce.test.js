// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { rateInForce } from '../../src/ledger/rateInForce.js';
import { project } from '../../src/ledger/project.js';

// The rate a debt has in force on the projection date. A loan's projection already applies its rate changes into its terms;
// a card's keeps the original terms, so the rate comes from its revolving tranche.

const EA = (value) => ({ value, basis: 'effective', periodicity: 'annual', timing: 'arrears' });
const loan = { $id: 'd1', householdId: 'h1', name: 'Credito', ownerScope: 'shared', terms: { kind: 'consumer', principalMinor: 10_000_000, openedOn: '2026-01-15', rate: EA(24), system: 'french', periodicity: 'monthly', n: 36, firstDueOn: '2026-02-15' } };
const card = {
  $id: 'c1', householdId: 'h1', name: 'Visa', ownerScope: 'shared',
  terms: { kind: 'card', principalMinor: 500_000, openedOn: '2026-04-01', system: 'none', periodicity: 'monthly', rate: EA(28), card: { statementDay: 15, dueDay: 30, minPayment: { rule: 'interest_fees_plus_pct', pct: 5, floorMinor: 20_000 } } },
};
const ev = (debtId, id, kind, effectiveOn, payload) => ({ $id: id, debtId, kind, effectiveOn, amountMinor: 0, payloadJson: JSON.stringify(payload), $createdAt: '2026-01-01T00:00:00.000Z' });
const rateChange = (debtId, id, effectiveOn, value) => ev(debtId, id, 'rate_change', effectiveOn, { rate: EA(value), mode: 'keep_term' });
const voidOf = (debtId, id, targetEventId) => ev(debtId, id, 'void', '2026-05-02', { targetEventId, reason: 'x' });

describe('rateInForce', () => {
  it('is the rate of the terms for a loan, which has already applied its rate changes', () => {
    const events = [{ ...ev('d1', 'e0', 'disbursement', '2026-01-15', {}), amountMinor: 10_000_000 }, rateChange('d1', 'r1', '2026-02-01', 20)];
    const projection = project(loan, events, '2026-03-10');

    expect(rateInForce(projection)).toEqual(projection.terms.rate);
    expect(rateInForce(projection).value).toBe(20);
  });

  it('follows the active rate changes of a card and skips voided and future ones', () => {
    const events = [rateChange('c1', 'r1', '2026-04-20', 24), rateChange('c1', 'r2', '2026-05-01', 22), voidOf('c1', 'v1', 'r2'), rateChange('c1', 'r3', '2026-08-01', 18)];
    const projection = project(card, events, '2026-05-20');

    expect(projection.terms.rate.value).toBe(28); // the card projection keeps the original terms
    expect(rateInForce(projection).value).toBe(24);
  });

  it('is the original rate of a card without any active rate change', () => {
    const events = [rateChange('c1', 'r1', '2026-04-20', 24), voidOf('c1', 'v1', 'r1')];

    expect(rateInForce(project(card, events, '2026-05-20')).value).toBe(28);
    expect(rateInForce(project(card, [], '2026-05-20')).value).toBe(28);
  });
});
