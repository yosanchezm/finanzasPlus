import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { computeBudgetMonth } from '@finance-core';
import { KpiCards } from './KpiCards';

const CATEGORIES = [
  { $id: 'in', name: 'Salario', kind: 'income' },
  { $id: 'mk', name: 'Mercado', kind: 'need' },
  { $id: 'fun', name: 'Ocio', kind: 'want' },
  { $id: 'sv', name: 'Ahorro', kind: 'saving' },
  { $id: 'iv', name: 'Fondos', kind: 'investment' },
];
const tx = (categoryId, amountMinor, type = 'expense', extra = {}) => ({ $id: `${categoryId}${amountMinor}`, type, categoryId, amountMinor, occurredAt: '2026-10-05T12:00:00.000Z', ...extra });
const line = (targetId, amountMinor) => ({ $id: `bo-${targetId}`, targetType: 'category', targetId, rule: 'fixed', amountMinor, percentBp: null, fromMonth: '2026-10', toMonth: null });
const month = (transactions, lines = [], previousMonthIncomeMinor = 0) => computeBudgetMonth({ month: '2026-10', lines, categories: CATEGORIES, transactions, previousMonthIncomeMinor });

const renderKpis = (budgetMonth, extra = {}) => render(<KpiCards budgetMonth={budgetMonth} incomeCount={1} expenseCount={2} history={[]} {...extra} />);
const kpi = (name) => screen.getByRole('article', { name });

describe('KpiCards', () => {
  it('labels Gastos as consumption and excludes saving, investment and debt', () => {
    renderKpis(month([tx('in', 4000000, 'income'), tx('mk', 1000000), tx('fun', 500000), tx('sv', 800000)]));
    expect(within(kpi('Gastos (consumo)')).getByText('$ 1.500.000')).toBeInTheDocument();
  });

  it('computes Balance from the budget month (income minus every outflow)', () => {
    renderKpis(month([tx('in', 4000000, 'income'), tx('mk', 1500000), tx('sv', 800000), tx('iv', 200000), tx('x', 500000, 'expense', { debtId: 'd1' })]));
    expect(within(kpi('Balance del mes')).getByText('$ 1.000.000')).toBeInTheDocument();
    expect(kpi('Balance del mes')).toHaveTextContent('Incluye ahorro, inversión y pagos de deuda');
  });

  it('shows Ahorro e inversión and a 20 % savings rate', () => {
    renderKpis(month([tx('in', 4000000, 'income'), tx('sv', 600000), tx('iv', 200000)]));
    expect(within(kpi('Ahorro e inversión')).getByText('$ 800.000')).toBeInTheDocument();
    expect(within(kpi('Tasa de ahorro')).getByText('20 %')).toBeInTheDocument();
  });

  it('shows the share of income that goes to debts', () => {
    renderKpis(month([tx('in', 4000000, 'income'), tx('x', 500000, 'expense', { debtId: 'd1' })]));
    expect(within(kpi('Deudas (% del ingreso)')).getByText('13 %')).toBeInTheDocument();
  });

  it('computes Presupuesto usado from limited consumption only', () => {
    renderKpis(month([tx('in', 4000000, 'income'), tx('mk', 500000), tx('fun', 900000)], [line('mk', 1000000)]));
    expect(within(kpi('Presupuesto usado')).getByText('50 %')).toBeInTheDocument();
  });

  it('shows empty states, never NaN or Infinity, with no income and no limits', () => {
    renderKpis(month([tx('mk', 100000)]));
    expect(within(kpi('Tasa de ahorro')).getByText('Sin ingresos este mes')).toBeInTheDocument();
    expect(within(kpi('Deudas (% del ingreso)')).getByText('Sin ingresos este mes')).toBeInTheDocument();
    expect(within(kpi('Presupuesto usado')).getByText('Sin presupuesto definido')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/);
  });

  it('shows Por asignar and flags an over-allocated plan', () => {
    renderKpis(month([tx('in', 1000000, 'income')], [line('mk', 1200000)]));
    expect(within(kpi('Por asignar')).getByText('− $ 200.000')).toBeInTheDocument();
    expect(kpi('Por asignar')).toHaveTextContent('Asignaste más de lo que ingresa');
  });

  it('shows the remaining amount when the plan fits', () => {
    renderKpis(month([tx('in', 1000000, 'income')], [line('mk', 400000)]));
    expect(within(kpi('Por asignar')).getByText('$ 600.000')).toBeInTheDocument();
    expect(kpi('Por asignar')).not.toHaveTextContent('Asignaste más');
  });

  it('marks a reference or missing income base on the income-based KPIs', () => {
    const { unmount } = renderKpis(month([], [line('mk', 400000)], 3000000));
    expect(kpi('Por asignar')).toHaveTextContent('Base: ingreso del mes anterior');
    expect(kpi('Tasa de ahorro')).toHaveTextContent('Base: ingreso del mes anterior');
    unmount();
    renderKpis(month([], [line('mk', 400000)]));
    expect(kpi('Por asignar')).toHaveTextContent('Sin ingreso de referencia');
  });

  it('does not mark an actual income base', () => {
    renderKpis(month([tx('in', 1000000, 'income')], [line('mk', 400000)]));
    expect(kpi('Por asignar')).not.toHaveTextContent('Base:');
  });

  it('compares Gastos with the previous month consumption, not outflow', () => {
    renderKpis(month([tx('in', 4000000, 'income'), tx('mk', 800000), tx('sv', 900000)]), {
      history: [{ month: '2026-09', income: 0, expenses: 3000000, consumption: 1000000 }, { month: '2026-10', income: 4000000, expenses: 1700000, consumption: 800000 }],
    });
    expect(kpi('Gastos (consumo)')).toHaveTextContent('−20 % vs. septiembre');
  });

  it('explains the credit-card double counting limit', () => {
    renderKpis(month([]));
    expect(screen.getByText(/tarjeta de crédito.*dos veces/i)).toBeInTheDocument();
  });
});
