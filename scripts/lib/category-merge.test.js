// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { foldName, planMerge } from './category-merge.mjs';

const H = 'household-1';
const category = (id, name, extra = {}) => ({ id, householdId: H, name, kind: 'expense', color: '#000', icon: null, archived: false, ...extra });
const transaction = (id, categoryId) => ({ id, householdId: H, categoryId, amountMinor: 1000 });
const budget = (id, categoryId, month, plannedMinor, alertAtPercent = null) => ({ id, householdId: H, categoryId, month, plannedMinor, alertAtPercent });

// Applies a plan to in-memory rows the same way the CLI applies it over REST.
function applyPlan({ categories, transactions, budgets }, plan) {
  const nextTransactions = transactions.map((row) => {
    const update = plan.transactionUpdates.find((candidate) => candidate.id === row.id);
    return update ? { ...row, categoryId: update.to } : row;
  });
  let nextBudgets = budgets.map((row) => {
    const update = plan.budgetUpdates.find((candidate) => candidate.id === row.id);
    return update ? { ...row, categoryId: update.categoryId } : row;
  });
  for (const merge of plan.budgetMerges) {
    nextBudgets = nextBudgets
      .filter((row) => row.id !== merge.removeId)
      .map((row) => (row.id === merge.keepId ? { ...row, plannedMinor: merge.plannedMinor, alertAtPercent: merge.alertAtPercent } : row));
  }
  const nextCategories = categories.map((row) => (plan.archive.includes(row.id) ? { ...row, archived: true } : row));
  return { categories: nextCategories, transactions: nextTransactions, budgets: nextBudgets };
}

const fixture = () => ({
  categories: [
    category('c-comida', 'Comida'),
    category('c-alim', 'Alimentación'),
    category('c-casa', 'Casa'),
    category('c-hogar', 'Hogar'),
    category('c-otros', 'Otros'),
  ],
  transactions: [
    transaction('t1', 'c-comida'),
    transaction('t2', 'c-comida'),
    transaction('t3', 'c-alim'),
    transaction('t4', 'c-casa'),
    transaction('t5', null),
    transaction('t6', 'c-otros'),
  ],
  budgets: [
    budget('b1', 'c-comida', '2026-09', 50000),
    budget('b2', 'c-comida', '2026-10', 30000, 90),
    budget('b3', 'c-alim', '2026-10', 70000, 80),
    budget('b4', 'c-casa', '2026-10', 20000, 75),
    budget('b5', 'c-hogar', '2026-10', 10000),
  ],
});

const MERGES = [
  { from: 'comida', into: 'ALIMENTACION' },
  { from: '  Casa ', into: 'Hogar' },
];

describe('foldName', () => {
  it('trims, collapses whitespace, lowercases and strips diacritics', () => {
    expect(foldName('  Salud   y Cuidado  Personal ')).toBe('salud y cuidado personal');
    expect(foldName('Alimentación')).toBe('alimentacion');
    expect(foldName('NÓMINA')).toBe('nomina');
    expect(foldName('Pequeño')).toBe('pequeno');
  });
});

describe('planMerge', () => {
  it('matches names regardless of accents, case and spacing', () => {
    const plan = planMerge({ ...fixture(), merges: MERGES });
    expect(plan.summary).toEqual([
      { from: 'Comida', into: 'Alimentación', transactions: 2, budgets: 2 },
      { from: 'Casa', into: 'Hogar', transactions: 1, budgets: 1 },
    ]);
  });

  it('repoints every transaction of a duplicate to the kept category', () => {
    const plan = planMerge({ ...fixture(), merges: MERGES });
    expect(plan.transactionUpdates).toEqual([
      { id: 't1', from: 'c-comida', to: 'c-alim' },
      { id: 't2', from: 'c-comida', to: 'c-alim' },
      { id: 't4', from: 'c-casa', to: 'c-hogar' },
    ]);
  });

  it('repoints a duplicate budget when the kept category has none that month', () => {
    const plan = planMerge({ ...fixture(), merges: MERGES });
    expect(plan.budgetUpdates).toEqual([{ id: 'b1', categoryId: 'c-alim' }]);
  });

  it('sums same-month budgets into the kept one and removes the duplicate', () => {
    const plan = planMerge({ ...fixture(), merges: MERGES });
    expect(plan.budgetMerges).toEqual([
      // The kept budget keeps its own alert threshold.
      { keepId: 'b3', removeId: 'b2', plannedMinor: 100000, alertAtPercent: 80 },
      // The kept budget has no threshold, so the duplicate's one is used.
      { keepId: 'b5', removeId: 'b4', plannedMinor: 30000, alertAtPercent: 75 },
    ]);
  });

  it('accumulates several duplicates merged into the same budget', () => {
    const data = fixture();
    data.categories.push(category('c-mercado', 'Mercado'));
    data.budgets.push(budget('b6', 'c-mercado', '2026-10', 5000));
    const plan = planMerge({ ...data, merges: [...MERGES, { from: 'Mercado', into: 'Alimentación' }] });
    const intoAlim = plan.budgetMerges.filter((merge) => merge.keepId === 'b3');
    expect(intoAlim.at(-1)).toEqual({ keepId: 'b3', removeId: 'b6', plannedMinor: 105000, alertAtPercent: 80 });
    const after = applyPlan(data, plan);
    expect(after.budgets.find((row) => row.id === 'b3').plannedMinor).toBe(105000);
  });

  it('archives every duplicate and nothing else', () => {
    const plan = planMerge({ ...fixture(), merges: MERGES });
    expect(plan.archive).toEqual(['c-comida', 'c-casa']);
  });

  it('yields an empty plan when run again on the migrated data', () => {
    const data = fixture();
    const after = applyPlan(data, planMerge({ ...data, merges: MERGES }));
    const second = planMerge({ ...after, merges: MERGES });
    expect(second.transactionUpdates).toEqual([]);
    expect(second.budgetUpdates).toEqual([]);
    expect(second.budgetMerges).toEqual([]);
    expect(second.archive).toEqual([]);
    expect(second.summary).toEqual([
      { from: 'Comida', into: 'Alimentación', transactions: 0, budgets: 0 },
      { from: 'Casa', into: 'Hogar', transactions: 0, budgets: 0 },
    ]);
  });

  it('repoints leftovers that still point to an already archived duplicate', () => {
    const data = fixture();
    data.categories[0].archived = true;
    const plan = planMerge({ ...data, merges: MERGES });
    expect(plan.transactionUpdates.map((update) => update.id)).toEqual(['t1', 't2', 't4']);
    expect(plan.archive).toEqual(['c-casa']);
  });

  it('prefers the active category when an archived one shares its name', () => {
    const data = fixture();
    data.categories.push(category('c-comida-old', 'Comida', { archived: true }));
    const plan = planMerge({ ...data, merges: MERGES });
    expect(plan.archive).toEqual(['c-comida', 'c-casa']);
  });

  it('throws on an unknown name', () => {
    expect(() => planMerge({ ...fixture(), merges: [{ from: 'Mascotas', into: 'Hogar' }] })).toThrow(/Mascotas/);
    expect(() => planMerge({ ...fixture(), merges: [{ from: 'Casa', into: 'Vivienda' }] })).toThrow(/Vivienda/);
  });

  it('does not accept an archived category as the one that stays', () => {
    const data = fixture();
    data.categories[3].archived = true;
    expect(() => planMerge({ ...data, merges: MERGES })).toThrow(/Hogar/);
  });

  it('throws on an ambiguous name', () => {
    const data = fixture();
    data.categories.push(category('c-casa-2', 'casa'));
    expect(() => planMerge({ ...data, merges: MERGES })).toThrow(/ambig/i);
  });

  it('throws when a category would be merged into itself', () => {
    expect(() => planMerge({ ...fixture(), merges: [{ from: 'Hogar', into: 'hogar' }] })).toThrow(/itself/i);
  });

  it('throws on chains', () => {
    const merges = [{ from: 'Comida', into: 'Alimentación' }, { from: 'Alimentacion', into: 'Otros' }];
    expect(() => planMerge({ ...fixture(), merges })).toThrow(/chain/i);
  });

  it('throws when the same duplicate is merged twice', () => {
    const merges = [{ from: 'Comida', into: 'Alimentación' }, { from: 'comida', into: 'Otros' }];
    expect(() => planMerge({ ...fixture(), merges })).toThrow(/more than once/i);
  });
});
