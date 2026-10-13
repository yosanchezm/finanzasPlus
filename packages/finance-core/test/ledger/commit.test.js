// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { CommitError, ValidationError } from '../../src/errors.js';
import { commitPlan, planCommit } from '../../src/ledger/commit.js';

const EA = (value) => ({ value, basis: 'effective', periodicity: 'annual', timing: 'arrears' });
const FEE = { id: 'fee', kind: 'fee', label: 'Admin fee', basis: 'fixed', value: 10_000 };
const terms = (overrides = {}) => ({
  kind: 'consumer',
  principalMinor: 10_000_000,
  openedOn: '2026-01-15',
  rate: EA(24),
  system: 'french',
  periodicity: 'monthly',
  n: 36,
  firstDueOn: '2026-02-15',
  charges: [FEE],
  ...overrides,
});
const debt = (overrides = {}) => ({ $id: 'd1', householdId: 'h1', name: 'Crédito Vehículo', ownerScope: 'partner', terms: terms(), ...overrides });
const ctx = (overrides = {}) => ({ eventId: 'ev1', dedupeKey: 'web:n1', actorId: 'u1', source: 'web', ...overrides });
const draft = (overrides = {}) => ({ kind: 'payment', effectiveOn: '2026-02-15', amountMinor: 390_381, ...overrides });

const conflict = () => Object.assign(new Error('document already exists'), { code: 409 });
const notFound = () => Object.assign(new Error('not found'), { code: 404 });

function fakePort({ failCostRows = 0 } = {}) {
  const state = { calls: [], events: new Map(), rows: new Map(), failCostRows };
  return {
    state,
    ensureCostCategory: async (householdId) => {
      state.calls.push('category');
      return `cf${householdId}`;
    },
    createEvent: async ({ id, data }) => {
      state.calls.push('createEvent');
      if (state.events.has(data.dedupeKey)) throw conflict();
      const row = { $id: id, ...data };
      state.events.set(data.dedupeKey, row);
      return row;
    },
    findEventByDedupe: async (dedupeKey) => {
      state.calls.push('findEvent');
      return state.events.get(dedupeKey) ?? null;
    },
    createCostRow: async ({ id, data }) => {
      state.calls.push('createCostRow');
      if (state.failCostRows > 0) {
        state.failCostRows -= 1;
        throw new Error('network down');
      }
      if (state.rows.has(id)) throw conflict();
      const row = { $id: id, ...data };
      state.rows.set(id, row);
      return row;
    },
    deleteCostRow: async (id) => {
      state.calls.push('deleteCostRow');
      if (!state.rows.delete(id)) throw notFound();
    },
  };
}

describe('planCommit: payments', () => {
  it('writes the cost of the split (charges + interest = 190,876), never the principal', () => {
    const plan = planCommit(debt(), [], draft(), ctx());
    expect(plan.allocation).toMatchObject({ charges: 10_000, interest: 180_876, principal: 199_505, surplus: 0 });
    expect(plan.costMinor).toBe(190_876);
    expect(plan.event).toEqual({
      id: 'ev1',
      data: {
        householdId: 'h1',
        debtId: 'd1',
        kind: 'payment',
        effectiveOn: '2026-02-15',
        amountMinor: 390_381,
        payloadJson: '{}',
        actorId: 'u1',
        source: 'web',
        dedupeKey: 'web:n1',
      },
    });
    expect(plan.costRow).toEqual({
      id: 'dcev1',
      data: {
        householdId: 'h1',
        actorId: 'u1',
        ownerScope: 'partner',
        type: 'expense',
        amountMinor: 190_876,
        currency: 'COP',
        occurredAt: '2026-02-15T12:00:00.000Z',
        merchant: 'Crédito Vehículo',
        categoryId: null,
        note: 'Intereses y cargos',
        source: 'debt',
        confidence: 1,
        status: 'confirmed',
        providerRef: 'debt:ev1',
        dedupeKey: 'debt:ev1',
        debtId: 'd1',
      },
    });
    expect(plan.deleteCostRowId).toBeNull();
  });

  it('includes taxes and counts a short payment by what it actually covers', () => {
    const iva = { id: 'iva', kind: 'tax', label: 'IVA', basis: 'pctOfCharge', refId: 'fee', value: 19 };
    const plan = planCommit(debt({ terms: terms({ charges: [FEE, iva] }) }), [], draft({ amountMinor: 100_000 }), ctx());
    expect(plan.allocation).toMatchObject({ charges: 10_000, taxes: 1_900, interest: 88_100, principal: 0 });
    expect(plan.costRow.data.amountMinor).toBe(100_000);
  });

  it('a payment that only covers principal costs nothing and creates no row', () => {
    const principalFirst = debt({ terms: terms({ allocationOrder: ['principal', 'interest', 'charges'] }) });
    const plan = planCommit(principalFirst, [], draft({ amountMinor: 150_000 }), ctx());
    expect(plan.allocation.principal).toBe(150_000);
    expect(plan.costMinor).toBe(0);
    expect(plan.costRow).toBeNull();
    expect(plan.event.data.amountMinor).toBe(150_000);
  });

  it('accounts for earlier events and returns the projection after the payment for previews', () => {
    const first = planCommit(debt(), [], draft(), ctx());
    const stored = [{ $id: 'ev1', ...first.event.data, $createdAt: '2026-02-15T10:00:00.000Z' }];
    const second = planCommit(debt(), stored, draft({ effectiveOn: '2026-03-15', amountMinor: 100_000 }), ctx({ eventId: 'ev2', dedupeKey: 'web:n2' }));
    expect(second.allocation).toMatchObject({ charges: 10_000, interest: 90_000, principal: 0 });
    expect(second.projection).toMatchObject({ asOf: '2026-03-15', balanceMinor: 10_000_000 - 199_505 });
    expect(second.projection.plan[1]).toMatchObject({ status: 'partial', paidMinor: 100_000 });
  });

  it('keeps extra payments and bank splits in the payload', () => {
    const split = { charges: 10_000, interest: 150_000, principal: 230_381 };
    const withSplit = planCommit(debt(), [], draft({ bankSplit: split }), ctx());
    expect(JSON.parse(withSplit.event.data.payloadJson)).toEqual({ bankSplit: split });
    expect(withSplit.costMinor).toBe(160_000);
    const extra = planCommit(debt(), [], draft({ kind: 'extra_payment', effectiveOn: '2026-02-01', amountMinor: 2_000_000, strategy: 'reduce_term' }), ctx());
    expect(JSON.parse(extra.event.data.payloadJson)).toEqual({ strategy: 'reduce_term' });
    expect(extra.costMinor).toBe(0);
    expect(extra.costRow).toBeNull();
  });
});

describe('planCommit: other events', () => {
  const payment = planCommit(debt(), [], draft(), ctx());
  const stored = [{ $id: 'ev1', ...payment.event.data, $createdAt: '2026-02-15T10:00:00.000Z' }];

  it('a void appends a void event keyed by its target and deletes the cost row dc{id}', () => {
    const plan = planCommit(debt(), stored, { kind: 'void', effectiveOn: '2026-02-20', targetEventId: 'ev1', reason: 'typo' }, ctx({ eventId: 'ev2', dedupeKey: undefined }));
    expect(plan.event.data).toMatchObject({ kind: 'void', amountMinor: 0, dedupeKey: 'void:ev1', debtId: 'd1' });
    expect(JSON.parse(plan.event.data.payloadJson)).toEqual({ targetEventId: 'ev1', reason: 'typo' });
    expect(plan.costRow).toBeNull();
    expect(plan.deleteCostRowId).toBe('dcev1');
    expect(plan.projection.balanceMinor).toBe(10_000_000);
  });

  it('refuses to void a missing, already voided or void event', () => {
    const voided = [...stored, { $id: 'ev2', ...planCommit(debt(), stored, { kind: 'void', effectiveOn: '2026-02-20', targetEventId: 'ev1' }, ctx({ eventId: 'ev2' })).event.data }];
    for (const [events, target] of [[stored, 'ghost'], [voided, 'ev1'], [voided, 'ev2']]) {
      expect(() => planCommit(debt(), events, { kind: 'void', effectiveOn: '2026-03-01', targetEventId: target }, ctx({ eventId: 'ev3' }))).toThrow(
        expect.objectContaining({ code: 'invalid_void_target' }),
      );
    }
  });

  it('plans plan-changing events without a cost row', () => {
    const plan = planCommit(debt(), stored, { kind: 'rate_change', effectiveOn: '2026-03-01', rate: EA(30), mode: 'keep_term' }, ctx({ eventId: 'ev3', dedupeKey: 'web:n3' }));
    expect(plan.costRow).toBeNull();
    expect(plan.projection.terms.rate).toEqual(EA(30));
    expect(JSON.parse(plan.event.data.payloadJson).mode).toBe('keep_term');
  });
});

describe('planCommit: validation', () => {
  const code = (fn) => {
    try {
      fn();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      return error.code;
    }
    return 'no error';
  };

  it('needs an event id, actor, a known source and a dedupe key', () => {
    expect(code(() => planCommit(debt(), [], draft(), ctx({ eventId: '' })))).toBe('invalid_commit');
    expect(code(() => planCommit(debt(), [], draft(), ctx({ eventId: 'has space' })))).toBe('invalid_commit');
    expect(code(() => planCommit(debt(), [], draft(), ctx({ eventId: 'x'.repeat(40) })))).toBe('invalid_commit');
    expect(code(() => planCommit(debt(), [], draft(), ctx({ actorId: undefined })))).toBe('invalid_commit');
    expect(code(() => planCommit(debt(), [], draft(), ctx({ source: 'sms' })))).toBe('invalid_commit');
    expect(code(() => planCommit(debt(), [], draft(), ctx({ dedupeKey: '' })))).toBe('invalid_commit');
    expect(code(() => planCommit({ ...debt(), householdId: undefined }, [], draft(), ctx()))).toBe('invalid_commit');
  });

  it('rejects invalid drafts through the core validation and oversized payloads', () => {
    expect(code(() => planCommit(debt(), [], draft({ amountMinor: -5 }), ctx()))).toBe('invalid_event');
    expect(code(() => planCommit(debt(), [], draft({ kind: 'refund' }), ctx()))).toBe('invalid_event');
    expect(code(() => planCommit(debt(), [], draft({ effectiveOn: '2026-02-31' }), ctx()))).toBe('invalid_date');
    const note = 'n'.repeat(8_100);
    expect(code(() => planCommit(debt(), [], { kind: 'adjustment', effectiveOn: '2026-03-01', note }, ctx()))).toBe('payload_too_large');
  });

  it('does not mutate its inputs', () => {
    const input = debt();
    const events = [];
    const snapshot = JSON.stringify([input, events]);
    planCommit(input, events, draft(), ctx());
    expect(JSON.stringify([input, events])).toBe(snapshot);
  });
});

describe('commitPlan', () => {
  const plan = () => planCommit(debt(), [], draft(), ctx());

  it('ensures the cost category, writes the event, then the cost row with that category', async () => {
    const port = fakePort();
    expect('atomic' in port).toBe(false);
    const result = await commitPlan(port, plan());
    expect(port.state.calls).toEqual(['category', 'createEvent', 'createCostRow']);
    expect(result.duplicate).toBe(false);
    expect(result.event).toMatchObject({ $id: 'ev1', kind: 'payment', dedupeKey: 'web:n1' });
    expect(result.costRow).toMatchObject({ $id: 'dcev1', amountMinor: 190_876, categoryId: 'cfh1', debtId: 'd1' });
    expect([...port.state.events.keys()]).toEqual(['web:n1']);
  });

  it('a zero-cost payment writes only the event', async () => {
    const port = fakePort();
    const free = planCommit(debt({ terms: terms({ allocationOrder: ['principal'] }) }), [], draft({ amountMinor: 100_000 }), ctx());
    const result = await commitPlan(port, free);
    expect(port.state.calls).toEqual(['createEvent']);
    expect(result.costRow).toBeNull();
  });

  it('retrying the same plan creates no second event and no second row', async () => {
    const port = fakePort();
    await commitPlan(port, plan());
    const retry = await commitPlan(port, plan());
    expect(retry.duplicate).toBe(true);
    expect(retry.event.$id).toBe('ev1');
    expect(port.state.events.size).toBe(1);
    expect(port.state.rows.size).toBe(1);
    expect(port.state.calls.filter((call) => call === 'findEvent')).toHaveLength(1);
  });

  it('a conflict on the cost row counts as success', async () => {
    const port = fakePort();
    await port.createCostRow({ id: 'dcev1', data: { amountMinor: 190_876 } });
    const result = await commitPlan(port, plan());
    expect(result.duplicate).toBe(false);
    expect(port.state.events.size).toBe(1);
    expect(port.state.rows.size).toBe(1);
  });

  it('a row failure after the event reports a failed save, and the retry completes it', async () => {
    const port = fakePort({ failCostRows: 1 });
    await expect(commitPlan(port, plan())).rejects.toMatchObject({ name: 'CommitError', code: 'cost_row_failed', partial: true, eventId: 'ev1' });
    expect(port.state.events.size).toBe(1);
    expect(port.state.rows.size).toBe(0);
    const retry = await commitPlan(port, plan());
    expect(retry.duplicate).toBe(true);
    expect(port.state.events.size).toBe(1);
    expect(port.state.rows.size).toBe(1);
    await expect(commitPlan(fakePort({ failCostRows: 1 }), plan())).rejects.toBeInstanceOf(CommitError);
  });

  it('writes the cost row under the id of the event that already exists for the dedupe key', async () => {
    const port = fakePort();
    port.state.events.set('web:n1', { $id: 'other', dedupeKey: 'web:n1' });
    const result = await commitPlan(port, plan());
    expect(result.event.$id).toBe('other');
    expect(result.costRow).toMatchObject({ $id: 'dcother', providerRef: 'debt:other', dedupeKey: 'debt:other' });
    expect([...port.state.rows.keys()]).toEqual(['dcother']);
  });

  it('surfaces other event errors untouched and writes nothing else', async () => {
    const port = fakePort();
    port.createEvent = async () => {
      throw Object.assign(new Error('forbidden'), { code: 401 });
    };
    await expect(commitPlan(port, plan())).rejects.toMatchObject({ code: 401, message: 'forbidden' });
    expect(port.state.rows.size).toBe(0);
    const orphan = fakePort();
    orphan.createEvent = async () => {
      throw conflict();
    };
    await expect(commitPlan(orphan, plan())).rejects.toMatchObject({ code: 409 });
  });

  describe('void', () => {
    const voidPlan = (events) => planCommit(debt(), events, { kind: 'void', effectiveOn: '2026-02-20', targetEventId: 'ev1', reason: 'typo' }, ctx({ eventId: 'ev2' }));

    it('appends the void event and deletes dc{id}; a missing row (404) is fine', async () => {
      const port = fakePort();
      const paid = await commitPlan(port, plan());
      const stored = [paid.event];
      const result = await commitPlan(port, voidPlan(stored));
      expect(result.event).toMatchObject({ $id: 'ev2', kind: 'void', dedupeKey: 'void:ev1' });
      expect(port.state.rows.size).toBe(0);
      expect(port.state.events.size).toBe(2);
      const retry = await commitPlan(port, voidPlan(stored));
      expect(retry.duplicate).toBe(true);
      expect(port.state.calls.filter((call) => call === 'deleteCostRow')).toHaveLength(2);
    });

    it('reports a failed save when the row cannot be deleted, and the retry finishes the job', async () => {
      const port = fakePort();
      const paid = await commitPlan(port, plan());
      const realDelete = port.deleteCostRow;
      port.deleteCostRow = async () => {
        throw new Error('network down');
      };
      await expect(commitPlan(port, voidPlan([paid.event]))).rejects.toMatchObject({ code: 'cost_row_failed', partial: true, eventId: 'ev2' });
      expect(port.state.rows.size).toBe(1);
      port.deleteCostRow = realDelete;
      await commitPlan(port, voidPlan([paid.event]));
      expect(port.state.rows.size).toBe(0);
      expect(port.state.events.size).toBe(2);
    });
  });
});
