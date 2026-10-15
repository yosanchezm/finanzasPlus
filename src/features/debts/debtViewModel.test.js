import { serializeTerms } from '@finance-core';
import { describe, expect, it } from 'vitest';
import { buildDebtList } from './debtViewModel';

const terms = (overrides) => serializeTerms({
  kind: 'consumer', principalMinor: 1200000, openedOn: '2026-09-01', rate: { convention: 'ZERO' },
  system: 'french', periodicity: 'monthly', n: 12, firstDueOn: '2026-11-05', ...overrides,
});

const debt = (id, overrides = {}, termsOverrides = {}) => ({
  $id: id, name: id, lender: 'Banco', kind: 'consumer', ownerScope: 'you', status: 'active', principalMinor: 1200000,
  termsJson: terms(termsOverrides), termsVersion: 1, ...overrides,
});

const payment = (id, debtId, amountMinor, effectiveOn) => ({
  $id: id, $createdAt: `${effectiveOn}T12:00:00.000Z`, debtId, kind: 'payment', effectiveOn, amountMinor, payloadJson: '{}',
});

const TODAY = '2026-10-12';
const A = debt('Libre inversión');
const B = debt('Moto', { principalMinor: 600000, kind: 'vehicle' }, { kind: 'vehicle', principalMinor: 600000, n: 6, firstDueOn: '2026-10-20' });

describe('buildDebtList', () => {
  it('projects each debt and sums the balance, the installments and the nearest due date', () => {
    const { items, totals } = buildDebtList({ debts: [A, B], events: [], asOf: TODAY });

    expect(items.map((item) => [item.name, item.balanceMinor, item.nextDue.amountMinor, item.nextDue.dueOn]))
      .toEqual([['Libre inversión', 1200000, 100000, '2026-11-05'], ['Moto', 600000, 100000, '2026-10-20']]);
    expect(totals).toEqual({ count: 2, balanceMinor: 1800000, installmentsMinor: 200000, nextDueOn: '2026-10-20' });
  });

  it('reflects recorded payments in the balance, the next installment and the progress', () => {
    const { items, totals } = buildDebtList({ debts: [A, B], events: [payment('p1', A.$id, 100000, '2026-10-05')], asOf: TODAY });

    const [first] = items;
    expect(first.balanceMinor).toBe(1100000);
    expect(first.nextDue.dueOn).toBe('2026-12-05');
    expect(first.progressPercent).toBeCloseTo(8.33, 1);
    expect(totals.balanceMinor).toBe(1700000);
  });

  it('exposes the effective annual rate and flags interest-free debts', () => {
    const paid = debt('Banco', {}, { rate: { value: 2.1, basis: 'effective', periodicity: 'monthly' } });
    const { items } = buildDebtList({ debts: [A, paid], events: [], asOf: TODAY });

    expect(items[0].eaPercent).toBe(0);
    expect(items[1].eaPercent).toBeCloseTo(28.32, 1);
  });

  it('exposes the rate a card has in force after an active rate change, not its original rate', () => {
    const card = { ...debt('Visa', { kind: 'card', principalMinor: 500000 }, { kind: 'card', principalMinor: 500000, openedOn: '2026-04-01', system: 'none', n: undefined, firstDueOn: undefined, rate: { value: 28, basis: 'effective', periodicity: 'annual', timing: 'arrears' }, card: { statementDay: 15, dueDay: 30, minPayment: { rule: 'interest_fees_plus_pct', pct: 5, floorMinor: 20000 } } }) };
    const change = (id, effectiveOn, payload = {}, kind = 'rate_change') => ({ $id: id, $createdAt: `${effectiveOn}T12:00:00.000Z`, debtId: 'Visa', kind, effectiveOn, amountMinor: 0, payloadJson: JSON.stringify(payload) });
    const to24 = change('r1', '2026-05-01', { rate: { value: 24, basis: 'effective', periodicity: 'annual', timing: 'arrears' }, mode: 'keep_term' });

    expect(buildDebtList({ debts: [card], events: [to24], asOf: TODAY }).items[0].eaPercent).toBeCloseTo(24, 6);
    expect(buildDebtList({ debts: [card], events: [to24, change('v1', '2026-05-02', { targetEventId: 'r1', reason: 'x' }, 'void')], asOf: TODAY }).items[0].eaPercent).toBeCloseTo(28, 6);
  });

  it('hides debts outside the scope filter and archived debts, and does not month-scope events', () => {
    const partner = debt('Tarjeta pareja', { ownerScope: 'partner' });
    const archived = debt('Vieja', { status: 'archived' });
    const oldPayment = payment('p0', A.$id, 100000, '2026-01-10');
    const inScope = (item) => item.ownerScope !== 'partner';

    const { items, totals } = buildDebtList({ debts: [A, partner, archived], events: [oldPayment], asOf: TODAY, inScope });

    expect(items.map((item) => item.name)).toEqual(['Libre inversión']);
    expect(totals.count).toBe(1);
    expect(items[0].balanceMinor).toBe(1100000);
  });

  it('keeps an unreadable debt visible but out of the totals', () => {
    const broken = { ...A, $id: 'rota', name: 'Rota', termsJson: 'no es json' };

    const { items, totals } = buildDebtList({ debts: [broken, B], events: [], asOf: TODAY });

    expect(items[0]).toMatchObject({ name: 'Rota', unreadable: true });
    expect(totals).toEqual({ count: 1, balanceMinor: 600000, installmentsMinor: 100000, nextDueOn: '2026-10-20' });
  });

  it('handles a debt without a plan (balance only)', () => {
    const informal = debt('Préstamo de papá', { kind: 'informal' }, { kind: 'informal', system: 'none', n: undefined, firstDueOn: undefined });
    const { items, totals } = buildDebtList({ debts: [informal], events: [], asOf: TODAY });

    expect(items[0]).toMatchObject({ balanceMinor: 1200000, nextDue: null });
    expect(totals).toEqual({ count: 1, balanceMinor: 1200000, installmentsMinor: 0, nextDueOn: null });
  });
});
