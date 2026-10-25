// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { planLineEdit } from '../../src/budget/edit.js';
import { lineIds, targetKey } from '../../src/budget/ids.js';
import { resolveLines } from '../../src/budget/lines.js';

const categoriesById = new Map([['mercado', { $id: 'mercado', kind: 'need' }], ['salario', { $id: 'salario', kind: 'income' }]]);
const target = { targetType: 'category', targetId: 'mercado' };
const key = targetKey(target);
const line = (id, amountMinor, fromMonth, toMonth = null) => ({ $id: id, ...target, rule: 'fixed', amountMinor, percentBp: null, fromMonth, toMonth });
const request = (patch) => ({ target, rule: 'fixed', value: 700000, month: '2026-07', span: 'month', action: 'set', actorId: 'u1', source: 'web', categoriesById, ...patch });
const apply = (lines, plan) => {
  const byId = new Map(lines.map((l) => [l.$id, l]));
  for (const row of [...plan.creates, ...plan.updates]) byId.set(row.id, { ...byId.get(row.id), ...row.data, $id: row.id });
  return [...byId.values()];
};
const amountAt = (lines, month) => resolveLines(lines, month).get(key)?.amountMinor ?? null;

describe('planLineEdit set', () => {
  it('creates bo{M}{hash} when there is no one-month line', () => {
    const plan = planLineEdit([], request());
    expect(plan.ok).toBe(true);
    expect(plan.updates).toEqual([]);
    expect(plan.creates).toHaveLength(1);
    expect(plan.creates[0].id).toBe(lineIds.override(target, '2026-07'));
    expect(plan.creates[0].data).toMatchObject({ ...target, rule: 'fixed', amountMinor: 700000, fromMonth: '2026-07', toMonth: '2026-07', actorId: 'u1', source: 'web' });
  });

  it('reuses a migrated one-month line and creates nothing', () => {
    const lines = [line('blabc', 100, '2026-07', '2026-07')];
    const plan = planLineEdit(lines, request());
    expect(plan.creates).toEqual([]);
    expect(plan.updates.map((u) => u.id)).toEqual(['blabc']);
    expect(amountAt(apply(lines, plan), '2026-07')).toBe(700000);
  });

  it('keeps one row after repeated this-month edits', () => {
    const first = planLineEdit([], request());
    const lines = apply([], first);
    const second = planLineEdit(lines, request({ value: 800000 }));
    expect(second.creates).toEqual([]);
    expect(second.updates[0].id).toBe(first.creates[0].id);
  });

  it('closes a covering open-ended line and upserts br{M}{hash} for onward', () => {
    const lines = [line('base', 500000, '2026-01')];
    const plan = planLineEdit(lines, request({ span: 'onward' }));
    expect(plan.updates).toEqual([{ id: 'base', data: expect.objectContaining({ toMonth: '2026-06' }) }]);
    expect(plan.creates[0].id).toBe(lineIds.recurring(target, '2026-07'));
    expect(plan.creates[0].data).toMatchObject({ fromMonth: '2026-07', toMonth: null, amountMinor: 700000 });
    const after = apply(lines, plan);
    expect(amountAt(after, '2026-03')).toBe(500000);
    expect(amountAt(after, '2026-07')).toBe(700000);
    expect(amountAt(after, '2027-02')).toBe(700000);
  });

  it('closes across a year boundary', () => {
    const plan = planLineEdit([line('base', 5, '2025-06')], request({ span: 'onward', month: '2026-01' }));
    expect(plan.updates[0].data.toMonth).toBe('2025-12');
  });

  it('updates in place a line that starts at M', () => {
    const lines = [line('start', 500000, '2026-07')];
    const plan = planLineEdit(lines, request({ span: 'onward' }));
    expect(plan.creates).toEqual([]);
    expect(plan.updates).toEqual([{ id: 'start', data: expect.objectContaining({ amountMinor: 700000, toMonth: null }) }]);
  });

  it('upserts br{M}{hash} when nothing covers M, as an update if that row exists', () => {
    expect(planLineEdit([], request({ span: 'onward' })).creates[0].id).toBe(lineIds.recurring(target, '2026-07'));
    const existing = line(lineIds.recurring(target, '2026-07'), 1, '2026-07', '2026-07');
    expect(planLineEdit([existing], request({ span: 'onward' })).creates).toEqual([]);
  });

  it('sets a percent rule with percentBp and no amount', () => {
    const plan = planLineEdit([], request({ rule: 'percent', value: 1500 }));
    expect(plan.creates[0].data).toMatchObject({ rule: 'percent', percentBp: 1500, amountMinor: null });
  });

  it('keeps lines that start after M untouched', () => {
    const later = line('later', 900000, '2026-09', '2026-09');
    for (const span of ['month', 'onward']) {
      const plan = planLineEdit([line('base', 5, '2026-01'), later], request({ span }));
      expect([...plan.creates, ...plan.updates].some((r) => r.id === 'later')).toBe(false);
    }
  });
});

describe('planLineEdit remove', () => {
  it('writes a one-month tombstone for remove / month', () => {
    const plan = planLineEdit([], request({ action: 'remove', value: undefined }));
    expect(plan.creates[0].id).toBe(lineIds.override(target, '2026-07'));
    expect(plan.creates[0].data).toMatchObject({ rule: 'fixed', amountMinor: 0, fromMonth: '2026-07', toMonth: '2026-07' });
    const lines = [line('blabc', 100, '2026-07', '2026-07')];
    expect(planLineEdit(lines, request({ action: 'remove', span: 'month' })).updates[0]).toMatchObject({ id: 'blabc', data: { amountMinor: 0 } });
  });

  it('closes a covering line at M-1 for remove / onward', () => {
    const lines = [line('base', 500000, '2026-01')];
    const plan = planLineEdit(lines, request({ action: 'remove', span: 'onward' }));
    expect(plan.creates).toEqual([]);
    const after = apply(lines, plan);
    expect(amountAt(after, '2026-07')).toBe(null);
    expect(amountAt(after, '2026-03')).toBe(500000);
  });

  it('turns a line starting at M into an open-ended tombstone, leaving older closed lines', () => {
    const lines = [line('old', 300, '2026-01', '2026-06'), line('start', 500000, '2026-07')];
    const plan = planLineEdit(lines, request({ action: 'remove', span: 'onward' }));
    expect(plan.updates).toEqual([{ id: 'start', data: expect.objectContaining({ amountMinor: 0, toMonth: null }) }]);
    const after = apply(lines, plan);
    expect(amountAt(after, '2026-07')).toBe(0);
    expect(after.find((l) => l.$id === 'old').toMonth).toBe('2026-06');
  });

  it('also zeroes an existing one-month line for M on remove / onward', () => {
    const lines = [line('base', 500000, '2026-01'), line('blabc', 100, '2026-07', '2026-07')];
    const plan = planLineEdit(lines, request({ action: 'remove', span: 'onward' }));
    expect(plan.updates.map((u) => u.id).sort()).toEqual(['base', 'blabc']);
    expect(amountAt(apply(lines, plan), '2026-07')).toBe(0);
  });

  it('keeps later lines and never deletes', () => {
    const lines = [line('base', 5, '2026-01'), line('later', 9, '2026-09', '2026-09')];
    const plan = planLineEdit(lines, request({ action: 'remove', span: 'onward' }));
    expect(Object.keys(plan).sort()).toEqual(['creates', 'ok', 'updates']);
    expect(plan.updates.some((u) => u.id === 'later')).toBe(false);
  });
});

describe('planLineEdit validation', () => {
  it('plans nothing for an income target', () => {
    const plan = planLineEdit([line('base', 5, '2026-01')], request({ target: { targetType: 'category', targetId: 'salario' }, span: 'onward' }));
    expect(plan).toEqual({ ok: false, code: 'income_target', creates: [], updates: [] });
  });

  it('plans nothing when any row is invalid', () => {
    expect(planLineEdit([], request({ value: -5 })).ok).toBe(false);
    expect(planLineEdit([], request({ rule: 'percent', value: 20000 }))).toMatchObject({ ok: false, code: 'invalid_percent', creates: [], updates: [] });
  });
});
