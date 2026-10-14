// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildDebtDetail, voidRuleOf, voidSuccessMessage } from './debtDetailModel';
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

describe('voidRuleOf', () => {
  const at = (id, kind, effectiveOn, createdAt = '2026-01-01T10:00:00.000Z') => ({ id, kind, effectiveOn, createdAt });
  const FREE = { voidable: true, guarded: false, voidBlocked: null };
  const NEVER = { voidable: false, guarded: false, voidBlocked: null };

  it.each(['payment', 'extra_payment', 'charge', 'adjustment', 'rate_change', 'charge_change', 'late_policy'])('lets a %s be voided without conditions, even with events after it', (kind) => {
    const target = at('t', kind, '2026-03-01');
    expect(voidRuleOf(target, [target])).toEqual(FREE);
    expect(voidRuleOf(target, [target, at('later', 'payment', '2026-04-01')])).toEqual(FREE);
  });

  it.each(['disbursement', 'void', 'something_from_the_future'])('never lets a %s be voided', (kind) => {
    const target = at('t', kind, '2026-03-01');
    expect(voidRuleOf(target, [target])).toEqual(NEVER);
  });

  it('guards a restructure: allowed when nothing relevant follows it', () => {
    const restructure = at('r', 'restructure', '2026-03-01');
    expect(voidRuleOf(restructure, [restructure])).toEqual({ voidable: true, guarded: true, voidBlocked: null });
    const quiet = [at('p0', 'payment', '2026-02-01'), restructure, at('a1', 'adjustment', '2026-04-01'), at('c1', 'charge', '2026-04-02'), at('d1', 'disbursement', '2026-04-03')];
    expect(voidRuleOf(restructure, quiet)).toEqual({ voidable: true, guarded: true, voidBlocked: null });
  });

  it.each(['payment', 'extra_payment', 'rate_change', 'charge_change', 'late_policy', 'restructure'])('blocks the restructure when a later %s exists and names it', (kind) => {
    const restructure = at('r', 'restructure', '2026-03-01');
    const blocker = at('b', kind, '2026-04-15');
    expect(voidRuleOf(restructure, [restructure, blocker])).toEqual({
      voidable: true,
      guarded: true,
      voidBlocked: { code: 'later_events', events: [{ id: 'b', kind, effectiveOn: '2026-04-15' }] },
    });
  });

  it('lists every blocker in chronological order and ignores the ones before the restructure', () => {
    const restructure = at('r', 'restructure', '2026-03-01');
    const events = [at('p0', 'payment', '2026-02-10'), restructure, at('p1', 'payment', '2026-04-05'), at('rc', 'rate_change', '2026-05-01')];
    const { voidBlocked } = voidRuleOf(restructure, events);
    expect(voidBlocked.events.map((entry) => entry.id)).toEqual(['p1', 'rc']);
  });

  it('orders events of the same day by creation time', () => {
    const restructure = at('r', 'restructure', '2026-03-01', '2026-03-01T10:00:00.000Z');
    const sameDayAfter = at('p2', 'payment', '2026-03-01', '2026-03-01T11:00:00.000Z');
    const sameDayBefore = at('p1', 'payment', '2026-03-01', '2026-03-01T09:00:00.000Z');
    expect(voidRuleOf(restructure, [sameDayBefore, restructure, sameDayAfter]).voidBlocked.events.map((entry) => entry.id)).toEqual(['p2']);
    expect(voidRuleOf(restructure, [sameDayBefore, restructure]).voidBlocked).toBeNull();
  });
});

describe('voidSuccessMessage', () => {
  it('names what was voided', () => {
    expect(voidSuccessMessage('payment')).toBe('Pago anulado.');
    expect(voidSuccessMessage('extra_payment')).toBe('Abono anulado.');
    expect(voidSuccessMessage('rate_change')).toBe('Cambio de tasa anulado.');
    expect(voidSuccessMessage('charge_change')).toBe('Cambio de cargos anulado.');
    expect(voidSuccessMessage('restructure')).toBe('Reestructuración anulada.');
    expect(voidSuccessMessage('late_policy')).toBe('Política de mora anulada.');
    expect(voidSuccessMessage('adjustment')).toBe('Extracto anulado.');
    expect(voidSuccessMessage('charge')).toBe('Compra anulada.');
    expect(voidSuccessMessage('whatever')).toBe('Movimiento anulado.');
  });
});

describe('buildDebtDetail: plan-change history', () => {
  const EA = (value) => ({ value, basis: 'effective', periodicity: 'annual', timing: 'arrears' });
  const rateChange = makeEvent('rc1', 'rate_change', '2026-11-01', 0, { rate: EA(20), mode: 'keep_term' });
  const fee = { id: 'fee', kind: 'fee', label: 'Comisión', basis: 'fixed', value: 10000, cadence: 'per_installment' };
  const insurance = { id: 'ins', kind: 'insurance', label: 'Seguro de vida', basis: 'pctOutstanding', value: 0.05, cadence: 'per_installment' };
  const newTerms = { kind: 'consumer', principalMinor: 900000, openedOn: '2026-03-01', system: 'french', periodicity: 'monthly', n: 24, firstDueOn: '2026-04-05', rate: EA(24) };

  it('summarizes a rate change with the EA before and after instead of an amount', () => {
    const { history } = buildDebtDetail({ debt: makeDebt(), events: [disbursement, rateChange], asOf: '2026-11-10' });
    expect(history[0]).toMatchObject({
      id: 'rc1',
      kind: 'rate_change',
      summary: 'Tasa: 24,00 % → 20,00 % E.A. desde 1 nov · mantiene plazo',
      canVoid: true,
      guardedVoid: false,
      voidBlocked: null,
    });
    expect(history[1]).toMatchObject({ id: 'e0', summary: null });
  });

  it('summarizes a charge change against the charges in force at that moment and keeps voided ones summarized', () => {
    const first = makeEvent('c1', 'charge_change', '2026-03-01', 0, { charges: [fee] });
    const second = makeEvent('c2', 'charge_change', '2026-06-01', 0, { charges: [fee, insurance] });
    const dropped = makeEvent('c3', 'charge_change', '2026-08-01', 0, { charges: [insurance] });
    const voidDropped = makeEvent('v1', 'void', '2026-08-02', 0, { targetEventId: 'c3', reason: 'x' });
    const { history } = buildDebtDetail({ debt: makeDebt(), events: [disbursement, first, second, dropped, voidDropped], asOf: '2026-09-01' });
    expect(history.map((entry) => entry.summary)).toEqual(['Cargos: sin Comisión', 'Cargos: Seguro de vida', 'Cargos: Comisión', null]);
    expect(history[0]).toMatchObject({ voided: true, canVoid: false });
  });

  it('flags a restructure as guarded and blocked by a later payment, and lets it go once nothing follows', () => {
    const restructure = makeEvent('rs1', 'restructure', '2026-03-01', 0, { terms: newTerms });
    const blocked = buildDebtDetail({ debt: makeDebt(), events: [disbursement, restructure, makePayment('p9', '2026-04-05')], asOf: '2026-04-10' });
    const entry = blocked.history.find((item) => item.id === 'rs1');
    expect(entry).toMatchObject({ canVoid: true, guardedVoid: true, voidBlocked: { code: 'later_events', events: [{ id: 'p9', kind: 'payment', effectiveOn: '2026-04-05' }] } });
    expect(entry.summary).toMatch(/^Reestructuración: \$ [\d.]+ a 24 cuotas$/);
    const open = buildDebtDetail({ debt: makeDebt(), events: [disbursement, restructure], asOf: '2026-04-10' });
    expect(open.history.find((item) => item.id === 'rs1')).toMatchObject({ guardedVoid: true, voidBlocked: null });
  });

  it('does not count a voided payment as a blocker', () => {
    const events = [disbursement, makeEvent('rs1', 'restructure', '2026-03-01', 0, { terms: newTerms }), makePayment('p9', '2026-04-05'), makeEvent('v1', 'void', '2026-04-06', 0, { targetEventId: 'p9', reason: 'x' })];
    const { history } = buildDebtDetail({ debt: makeDebt(), events, asOf: '2026-04-10' });
    expect(history.find((item) => item.id === 'rs1').voidBlocked).toBeNull();
  });
});
