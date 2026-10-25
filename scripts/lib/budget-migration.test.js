// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { lineIds } from '../../packages/finance-core/index.js';
import { planBudgetMigration } from './budget-migration.mjs';

const H = 'household-1';
const category = (id, name, kind = 'need', extra = {}) => ({ id, householdId: H, name, kind, archived: false, ...extra });
const budget = (id, categoryId, month, plannedMinor) => ({ id, householdId: H, categoryId, month, plannedMinor, alertAtPercent: null });
const categories = [category('c-mercado', 'Mercado'), category('c-renta', 'Renta'), category('c-salario', 'Salario', 'income')];
const plan = (overrides = {}) => planBudgetMigration({ budgets: [], existingLineIds: [], categories, ...overrides });

describe('planBudgetMigration mapping', () => {
  it('maps a budget row 1:1 to a one-month fixed line', () => {
    const result = plan({ budgets: [budget('abc', 'c-mercado', '2026-09', 900000)], seed: false });
    expect(result.creates).toHaveLength(1);
    expect(result.creates[0]).toMatchObject({
      $id: 'blabc', householdId: H, targetType: 'category', targetId: 'c-mercado',
      rule: 'fixed', amountMinor: 900000, fromMonth: '2026-09', toMonth: '2026-09',
    });
    expect(result.summary).toMatchObject({ read: 1, create: 1, present: 0, skipped: 0 });
  });

  it('skips zero, missing month, missing category, income kind and over-long ids with reasons', () => {
    const long = 'x'.repeat(35);
    const result = plan({
      seed: false,
      budgets: [
        budget('z', 'c-mercado', '2026-09', 0),
        budget('nm', 'c-mercado', '', 5000),
        budget('mc', 'c-ghost', '2026-09', 5000),
        budget('nc', undefined, '2026-09', 5000),
        budget('inc', 'c-salario', '2026-09', 5000),
        budget(long, 'c-mercado', '2026-09', 5000),
        budget('ok', 'c-renta', '2026-09', 5000),
      ],
    });
    expect(result.creates.map((line) => line.$id)).toEqual(['blok']);
    expect(result.skipped.map(({ id, reason }) => [id, reason])).toEqual([
      ['z', 'zero_amount'], ['nm', 'missing_month'], ['mc', 'missing_category'],
      ['nc', 'missing_category'], ['inc', 'income_category'], [long, 'id_too_long'],
    ]);
    expect(result.summary).toMatchObject({ read: 7, create: 1, skipped: 6 });
  });

  it('lists existing ids as present and never recreates them', () => {
    const budgets = Array.from({ length: 4 }, (_, i) => budget(`r${i}`, 'c-mercado', `2026-0${i + 1}`, 1000));
    const result = plan({ budgets, existingLineIds: ['blr0', 'blr1'], seed: false });
    expect(result.creates.map((line) => line.$id)).toEqual(['blr2', 'blr3']);
    expect(result.present).toEqual(['blr0', 'blr1']);
    expect(result.summary).toMatchObject({ read: 4, create: 2, present: 2 });
  });
});

describe('planBudgetMigration seeding', () => {
  const rows = [
    budget('old', 'c-mercado', '2026-09', 100000),
    ...['c-mercado', 'c-renta'].map((id, i) => budget(`new${i}`, id, '2026-10', 500000 + i)),
  ];

  it('seeds open-ended fixed lines from the month after the latest mapped month', () => {
    const result = plan({ budgets: rows });
    expect(result.seeds.map((line) => line.$id).sort()).toEqual([
      lineIds.seeded({ targetType: 'category', targetId: 'c-mercado' }, '2026-11'),
      lineIds.seeded({ targetType: 'category', targetId: 'c-renta' }, '2026-11'),
    ].sort());
    expect(result.seeds.find((line) => line.targetId === 'c-renta')).toMatchObject({
      householdId: H, rule: 'fixed', amountMinor: 500001, fromMonth: '2026-11', toMonth: null,
    });
    expect(result.creates).toHaveLength(3);
    expect(result.summary.seed).toBe(2);
  });

  it('rolls December over to January of the next year', () => {
    const result = plan({ budgets: [budget('d', 'c-renta', '2026-12', 1000)] });
    expect(result.seeds[0].fromMonth).toBe('2027-01');
    expect(result.seeds[0].$id).toMatch(/^bs202701[0-9a-f]{16}$/);
  });

  it('uses the tie-break winner for duplicates and reports the others', () => {
    const result = plan({ budgets: [budget('a1', 'c-mercado', '2026-10', 700000), budget('a2', 'c-mercado', '2026-10', 900000)] });
    expect(result.seeds).toHaveLength(1);
    expect(result.seeds[0].amountMinor).toBe(900000);
    expect(result.duplicates).toEqual([{ targetId: 'c-mercado', month: '2026-10', keptId: 'bla2', ignoredIds: ['bla1'] }]);
    expect(result.summary.duplicates).toBe(1);
  });

  it('seeds nothing without mapped rows or with seed false', () => {
    expect(plan({ budgets: [budget('z', 'c-mercado', '2026-10', 0)] }).seeds).toEqual([]);
    expect(plan({ budgets: rows, seed: false }).seeds).toEqual([]);
  });

  it('skips seeds that already exist', () => {
    const id = lineIds.seeded({ targetType: 'category', targetId: 'c-mercado' }, '2026-11');
    const result = plan({ budgets: rows, existingLineIds: [id] });
    expect(result.seeds.map((line) => line.targetId)).toEqual(['c-renta']);
    expect(result.present).toContain(id);
  });
});

describe('planBudgetMigration cost category patches', () => {
  it('patches every Costos financieros category not yet debt, ignoring case, accents and archived', () => {
    const result = plan({
      categories: [
        category('f1', 'Costos financieros'),
        category('f2', 'COSTOS FINANCIEROS', 'want', { archived: true }),
        category('f3', 'costos financieros', 'debt'),
        category('o', 'Otro'),
      ],
    });
    expect(result.costCategoryPatches).toEqual([
      { id: 'f1', from: 'need', to: 'debt' },
      { id: 'f2', from: 'want', to: 'debt' },
    ]);
    expect(result.summary.patches).toBe(2);
  });

  it('plans zero patches once applied', () => {
    expect(plan({ categories: [category('f1', 'Costos financieros', 'debt')] }).costCategoryPatches).toEqual([]);
  });
});
