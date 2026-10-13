// @vitest-environment node
import { project, serializeTerms } from '@finance-core';
import { describe, expect, it } from 'vitest';
import { planReconcile } from './reconcile';

const terms = {
  kind: 'consumer', principalMinor: 1000000, openedOn: '2026-01-05', system: 'french', periodicity: 'monthly', n: 12, firstDueOn: '2026-02-05',
  rate: { value: 24, basis: 'effective', periodicity: 'annual', timing: 'arrears' },
};
const debt = { $id: 'd1', householdId: 'h1', name: 'Crédito', ownerScope: 'you', status: 'active', termsVersion: 1, principalMinor: 1000000, termsJson: serializeTerms(terms) };
const INSTALLMENT = 93453; // first two rows: interest 18,088 then 16,724

const event = (id, kind, effectiveOn, amountMinor, payload = {}) => ({
  $id: id, $createdAt: `${effectiveOn}T10:00:00.000Z`, debtId: 'd1', kind, effectiveOn, amountMinor, payloadJson: JSON.stringify(payload), actorId: 'u1', source: 'web', dedupeKey: `k${id}`,
});
const payment = (id, on) => event(id, 'payment', on, INSTALLMENT);
const costRow = (eventId, amountMinor) => ({ $id: `dc${eventId}`, debtId: 'd1', source: 'debt', type: 'expense', amountMinor });

// Applies a plan to a list of rows, as the executor would.
const apply = (rows, plan) => [
  ...rows.filter((row) => !plan.remove.includes(row.$id)).map((row) => {
    const change = plan.update.find((item) => item.id === row.$id);
    return change ? { ...row, ...change.data } : row;
  }),
  ...plan.create.map((row) => ({ $id: row.id, ...row.data })),
];

describe('planReconcile', () => {
  it('creates a missing cost row once, with the full row the commit would have written', () => {
    const events = [payment('e1', '2026-02-05'), payment('e2', '2026-03-05')];
    const rows = [costRow('e1', 18088)];

    const plan = planReconcile(debt, events, rows);

    expect(plan.create).toHaveLength(1);
    expect(plan.create[0]).toMatchObject({
      id: 'dce2',
      data: { amountMinor: 16724, debtId: 'd1', source: 'debt', type: 'expense', ownerScope: 'you', merchant: 'Crédito', occurredAt: '2026-03-05T12:00:00.000Z', dedupeKey: 'debt:e2', householdId: 'h1', actorId: 'u1' },
    });
    expect(plan.update).toEqual([]);
    expect(plan.remove).toEqual([]);
    expect(planReconcile(debt, events, apply(rows, plan))).toEqual({ create: [], update: [], remove: [] });
  });

  it('updates a stale amount and leaves a correct row alone', () => {
    const events = [payment('e1', '2026-02-05'), payment('e2', '2026-03-05')];
    const rows = [costRow('e1', 18088), costRow('e2', 999)];

    const plan = planReconcile(debt, events, rows);

    expect(plan).toEqual({ create: [], update: [{ id: 'dce2', data: { amountMinor: 16724 } }], remove: [] });
    expect(planReconcile(debt, events, apply(rows, plan))).toEqual({ create: [], update: [], remove: [] });
  });

  it('fixes the cost of a later payment after a payment is backdated before it', () => {
    // e2 alone settles installment 1 (cost 18,088); a backdated payment takes installment 1, so e2 now settles installment 2.
    const events = [payment('e2', '2026-03-05'), payment('e3', '2026-02-05')];
    const rows = [costRow('e2', 18088)];

    const plan = planReconcile(debt, events, rows);

    expect(plan.update).toEqual([{ id: 'dce2', data: { amountMinor: 16724 } }]);
    expect(plan.create.map((row) => row.id)).toEqual(['dce3']);
    expect(plan.create[0].data.amountMinor).toBe(18088);
  });

  it('deletes the row of a voided payment and any orphan debt row, but never a row that is not a debt cost', () => {
    const events = [payment('e1', '2026-02-05'), payment('e2', '2026-03-05'), event('v1', 'void', '2026-03-06', 0, { targetEventId: 'e2', reason: 'duplicado' })];
    const rows = [
      costRow('e1', 18088),
      costRow('e2', 16724),
      costRow('ghost', 500),
      { $id: 'tx9', debtId: 'd1', source: 'manual', type: 'expense', amountMinor: 70000 },
    ];

    const plan = planReconcile(debt, events, rows);

    expect(plan.remove.sort()).toEqual(['dce2', 'dcghost']);
    expect(plan.create).toEqual([]);
    expect(plan.update).toEqual([]);
    expect(planReconcile(debt, events, apply(rows, plan))).toEqual({ create: [], update: [], remove: [] });
  });

  it('expects no rows when the payments carry no cost', () => {
    const free = { ...debt, termsJson: serializeTerms({ ...terms, rate: { convention: 'ZERO' } }) };
    const events = [payment('e1', '2026-02-05')].map((item) => ({ ...item, amountMinor: 83334 }));
    expect(project(free, events, '2026-03-01').applied[0].costMinor).toBe(0);

    expect(planReconcile(free, events, [])).toEqual({ create: [], update: [], remove: [] });
    expect(planReconcile(free, events, [costRow('e1', 10)]).remove).toEqual(['dce1']);
  });
});
