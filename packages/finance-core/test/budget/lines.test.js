// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { coversMonth, linesFromLegacyBudgets, resolveLines, validateLine } from '../../src/budget/lines.js';
import { targetKey } from '../../src/budget/ids.js';

const categoriesById = new Map([['mercado', { $id: 'mercado', kind: 'need' }], ['salario', { $id: 'salario', kind: 'income' }]]);
const percent = { targetType: 'group', targetId: 'saving', rule: 'percent', percentBp: 2000, fromMonth: '2026-11', toMonth: null };
const fixed = (id, amountMinor, fromMonth, toMonth = null, targetId = 'mercado') => ({ $id: id, targetType: 'category', targetId, rule: 'fixed', amountMinor, fromMonth, toMonth });
const key = targetKey({ targetType: 'category', targetId: 'mercado' });
const winner = (lines, month) => resolveLines(lines, month).get(key)?.$id ?? null;

describe('validateLine', () => {
  it('accepts a recurring percent line and a fixed category line', () => {
    expect(validateLine(percent, categoriesById)).toEqual({ ok: true });
    expect(validateLine(fixed('a', 0, '2026-01', '2026-01'), categoriesById)).toEqual({ ok: true });
  });

  it.each([
    ['unknown targetType', { targetType: 'other' }],
    ['missing targetId', { targetId: '' }],
    ['percentBp 10001', { percentBp: 10001 }],
    ['negative percentBp', { percentBp: -1 }],
    ['non-integer percentBp', { percentBp: 10.5 }],
    ['negative amountMinor', { rule: 'fixed', amountMinor: -1 }],
    ['non-integer amountMinor', { rule: 'fixed', amountMinor: 1.5 }],
    ['unknown rule', { rule: 'ratio' }],
    ['toMonth before fromMonth', { toMonth: '2026-10' }],
    ['malformed fromMonth', { fromMonth: '2026-13' }],
    ['unknown group', { targetId: 'ocio' }],
  ])('rejects %s', (_label, patch) => {
    expect(validateLine({ ...percent, ...patch }, categoriesById).ok).toBe(false);
  });

  it('rejects income targets, as a group or as a category of kind income', () => {
    expect(validateLine(fixed('a', 10, '2026-01', null, 'salario'), categoriesById)).toEqual({ ok: false, code: 'income_target' });
    expect(validateLine({ ...percent, targetId: 'income' }, categoriesById)).toEqual({ ok: false, code: 'income_target' });
  });
});

describe('coversMonth', () => {
  it('is inclusive on both ends and open-ended when toMonth is null', () => {
    expect(coversMonth(fixed('a', 1, '2026-03', '2026-05'), '2026-03')).toBe(true);
    expect(coversMonth(fixed('a', 1, '2026-03', '2026-05'), '2026-05')).toBe(true);
    expect(coversMonth(fixed('a', 1, '2026-03', '2026-05'), '2026-06')).toBe(false);
    expect(coversMonth(fixed('a', 1, '2026-03'), '2030-01')).toBe(true);
    expect(coversMonth(fixed('a', 1, '2026-03'), '2026-02')).toBe(false);
  });
});

describe('resolveLines', () => {
  it('lets a one-month override beat the plan and the plan return after it', () => {
    const lines = [fixed('plan', 800000, '2026-01'), fixed('ovr', 950000, '2026-10', '2026-10')];
    expect(resolveLines(lines, '2026-10').get(key).amountMinor).toBe(950000);
    expect(resolveLines(lines, '2026-11').get(key).amountMinor).toBe(800000);
  });

  it('prefers the one-month line when fromMonth ties', () => {
    expect(winner([fixed('z', 1, '2026-10'), fixed('a', 2, '2026-10', '2026-10')], '2026-10')).toBe('a');
  });

  it('lets a later plan supersede an earlier one', () => {
    const lines = [fixed('p1', 500000, '2026-01'), fixed('p2', 600000, '2026-06')];
    expect(resolveLines(lines, '2026-03').get(key).amountMinor).toBe(500000);
    expect(resolveLines(lines, '2026-07').get(key).amountMinor).toBe(600000);
  });

  it('prefers the smaller toMonth among bounded lines and a bounded line over an open one', () => {
    expect(winner([fixed('a', 1, '2026-01', '2026-12'), fixed('b', 2, '2026-01', '2026-08')], '2026-05')).toBe('b');
    expect(winner([fixed('b', 1, '2026-01'), fixed('a', 2, '2026-01', '2026-12')], '2026-05')).toBe('a');
  });

  it('breaks the last tie with the greatest id in either input order', () => {
    const one = fixed('bl1', 1, '2026-01');
    const two = fixed('bl2', 2, '2026-01');
    expect(winner([one, two], '2026-05')).toBe('bl2');
    expect(winner([two, one], '2026-05')).toBe('bl2');
  });

  it('gives the same winner for any input order (seeded property check)', () => {
    let state = 7;
    const next = (max) => { state = (state * 1103515245 + 12345) % 2147483648; return state % max; };
    const months = ['2026-01', '2026-03', '2026-05'];
    for (let run = 0; run < 200; run += 1) {
      const lines = Array.from({ length: 2 + next(4) }, (_, i) => {
        const from = months[next(3)];
        return fixed(`l${i}`, next(1000), from, next(2) ? null : months[Math.min(2, months.indexOf(from) + next(2))]);
      });
      expect(winner(lines.slice().sort(() => next(3) - 1), '2026-05')).toBe(winner(lines, '2026-05'));
      expect(winner(lines.slice().reverse(), '2026-05')).toBe(winner(lines, '2026-05'));
    }
  });

  it('lets a zero one-month tombstone shadow the plan for that month only', () => {
    const lines = [fixed('plan', 500000, '2026-01'), fixed('tomb', 0, '2026-10', '2026-10')];
    expect(resolveLines(lines, '2026-10').get(key).amountMinor).toBe(0);
    expect(resolveLines(lines, '2026-11').get(key).amountMinor).toBe(500000);
  });

  it('resolves each target on its own and returns null when no line covers the month', () => {
    const lines = [fixed('a', 1, '2026-01', '2026-02'), fixed('b', 2, '2026-01', null, 'ropa')];
    const resolved = resolveLines(lines, '2026-06');
    expect(resolved.get(key)).toBeNull();
    expect(resolved.get('category:ropa').$id).toBe('b');
  });
});

describe('linesFromLegacyBudgets', () => {
  it('maps each row to a one-month fixed line bl{id} and skips rows without month or amount', () => {
    const rows = [
      { $id: 'abc', categoryId: 'mercado', month: '2026-09', plannedMinor: 900000, alertAtPercent: 80 },
      { $id: 'zero', categoryId: 'mercado', month: '2026-09', plannedMinor: 0 },
      { $id: 'nomonth', categoryId: 'mercado', plannedMinor: 5 },
    ];
    expect(linesFromLegacyBudgets(rows)).toEqual([
      { $id: 'blabc', targetType: 'category', targetId: 'mercado', rule: 'fixed', amountMinor: 900000, percentBp: null, fromMonth: '2026-09', toMonth: '2026-09', alertAtPercent: 80, actorId: 'migration', source: 'migration' },
    ]);
    expect(linesFromLegacyBudgets(undefined)).toEqual([]);
  });
});
