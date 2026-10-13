// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildDebtDetail } from './debtDetailModel';
import { INSTALLMENT, makeDebt, makeEvent, makePayment } from './debtFixtures';

const disbursement = makeEvent('e0', 'disbursement', '2026-01-05', 1000000);

describe('buildDebtDetail', () => {
  it('projects the debt and totals the real cost over the whole plan', () => {
    const { projection, cost } = buildDebtDetail({ debt: makeDebt(), events: [disbursement, makePayment('e1', '2026-02-05')], asOf: '2026-02-20' });

    expect(projection.plan).toHaveLength(12);
    expect(cost.interestMinor).toBe(projection.plan.reduce((sum, row) => sum + row.interestMinor, 0));
    expect(cost.paidMinor).toBe(18088); // only the first installment's interest so far
    expect(cost.totalMinor).toBe(cost.interestMinor + cost.chargesMinor + cost.taxesMinor);
    expect(cost.chargesMinor).toBe(0);
  });

  it('lists the history newest first, flags voided events with their reason and hides the void events', () => {
    const events = [
      disbursement,
      makePayment('e1', '2026-02-05'),
      makePayment('e2', '2026-03-05'),
      makeEvent('v1', 'void', '2026-03-06', 0, { targetEventId: 'e2', reason: 'Registrado dos veces' }),
    ];

    const { history } = buildDebtDetail({ debt: makeDebt(), events, asOf: '2026-03-10' });

    expect(history.map((entry) => entry.id)).toEqual(['e2', 'e1', 'e0']);
    expect(history[0]).toMatchObject({ kind: 'payment', amountMinor: INSTALLMENT, voided: true, voidReason: 'Registrado dos veces', canVoid: false, costMinor: 0 });
    expect(history[1]).toMatchObject({ kind: 'payment', voided: false, canVoid: true, costMinor: 18088 });
    expect(history[2]).toMatchObject({ kind: 'disbursement', canVoid: false });
  });

  it('returns the balance and the plan to their earlier values once the payment is voided', () => {
    const before = buildDebtDetail({ debt: makeDebt(), events: [disbursement, makePayment('e1', '2026-02-05')], asOf: '2026-02-10' });
    const voided = buildDebtDetail({ debt: makeDebt(), events: [disbursement, makePayment('e1', '2026-02-05'), makeEvent('v1', 'void', '2026-02-06', 0, { targetEventId: 'e1', reason: 'x' })], asOf: '2026-02-10' });
    const never = buildDebtDetail({ debt: makeDebt(), events: [disbursement], asOf: '2026-02-10' });

    expect(before.projection.balanceMinor).toBeLessThan(never.projection.balanceMinor);
    expect(voided.projection.balanceMinor).toBe(never.projection.balanceMinor);
    expect(voided.projection.plan.map((row) => row.status)).toEqual(never.projection.plan.map((row) => row.status));
    expect(voided.cost.paidMinor).toBe(0);
  });

  it('keeps the plan empty for a balance-only debt', () => {
    const informal = makeDebt({}, { system: 'none', n: undefined, firstDueOn: undefined, periodicity: undefined, rate: { convention: 'ZERO' } });
    const { projection, cost } = buildDebtDetail({ debt: informal, events: [disbursement], asOf: '2026-02-01' });

    expect(projection.plan).toEqual([]);
    expect(projection.balanceMinor).toBe(1000000);
    expect(cost.totalMinor).toBe(0);
  });
});
