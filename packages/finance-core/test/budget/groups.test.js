// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { CONSUMPTION, GROUPS, classifyTransaction, groupOfKind } from '../../src/budget/groups.js';

const categories = new Map([
  ['n', { $id: 'n', kind: 'need' }],
  ['w', { $id: 'w', kind: 'want' }],
  ['s', { $id: 's', kind: 'saving' }],
  ['i', { $id: 'i', kind: 'investment' }],
  ['d', { $id: 'd', kind: 'debt' }],
  ['inc', { $id: 'inc', kind: 'income' }],
  ['x', { $id: 'x', kind: 'ocio' }],
]);
const expense = (categoryId, extra = {}) => ({ type: 'expense', categoryId, ...extra });

describe('groupOfKind', () => {
  it('keeps the six known kinds and maps anything else to need', () => {
    expect(GROUPS).toEqual(['income', 'need', 'want', 'saving', 'investment', 'debt']);
    for (const kind of GROUPS) expect(groupOfKind(kind)).toBe(kind);
    expect(groupOfKind('ocio')).toBe('need');
    expect(groupOfKind(undefined)).toBe('need');
  });

  it('treats only need and want as consumption', () => {
    expect(CONSUMPTION).toEqual(['need', 'want']);
    expect(['saving', 'investment', 'debt'].some((kind) => CONSUMPTION.includes(groupOfKind(kind)))).toBe(false);
  });
});

describe('classifyTransaction', () => {
  it('uses the category kind for expenses, from a Map or a plain object', () => {
    expect(classifyTransaction(expense('w'), categories)).toBe('want');
    expect(classifyTransaction(expense('s'), categories)).toBe('saving');
    expect(classifyTransaction(expense('i'), categories)).toBe('investment');
    expect(classifyTransaction(expense('d'), categories)).toBe('debt');
    expect(classifyTransaction(expense('w'), { w: { kind: 'want' } })).toBe('want');
  });

  it('falls back to need for unknown kinds, missing categories and income-kind categories', () => {
    expect(classifyTransaction(expense('x'), categories)).toBe('need');
    expect(classifyTransaction(expense('nope'), categories)).toBe('need');
    expect(classifyTransaction(expense(null), categories)).toBe('need');
    expect(classifyTransaction(expense('inc'), categories)).toBe('need');
  });

  it('puts an expense with a debtId in debt whatever its category kind', () => {
    expect(classifyTransaction(expense('w', { debtId: 'debt1' }), categories)).toBe('debt');
    expect(classifyTransaction(expense('nope', { debtId: 'debt1' }), categories)).toBe('debt');
  });

  it('classifies income, ignores transfers and other types', () => {
    expect(classifyTransaction({ type: 'income', categoryId: 'inc' }, categories)).toBe('income');
    expect(classifyTransaction({ type: 'transfer', categoryId: 'n', debtId: 'debt1' }, categories)).toBeNull();
    expect(classifyTransaction({ type: 'adjustment', categoryId: 'n' }, categories)).toBeNull();
  });

  it('lands every transaction in exactly one group or none', () => {
    const rows = [expense('n'), expense('w'), expense('s'), expense('i'), expense('d'), expense('x'), { type: 'income' }, { type: 'transfer' }];
    const groups = rows.map((row) => classifyTransaction(row, categories));
    expect(groups).toEqual(['need', 'want', 'saving', 'investment', 'debt', 'need', 'income', null]);
  });
});
