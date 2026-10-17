import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import DashboardView from './DashboardView';

const at = (day) => new Date(2026, 9, day, 12).toISOString();

const zeroHistory = () => ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']
  .map((month) => ({ month, income: 0, expenses: 0 }));

const withMonths = (overrides) => zeroHistory().map((entry) => ({ ...entry, ...(overrides[entry.month] || {}) }));

const baseProps = () => ({
  dateLabel: 'Lunes, 12 de octubre · quedan 19 días del mes',
  periodLabel: 'octubre de 2026',
  scope: 'total',
  onScopeChange: vi.fn(),
  totals: { income: 0, expenses: 0 },
  incomeCount: 0,
  expenseCount: 0,
  budget: { planned: 0, spent: 0 },
  remainingDays: 19,
  isCurrentMonth: true,
  cashflow: [],
  history: zeroHistory(),
  categoryStats: [],
  recentTransactions: [],
  goals: [],
  currentOwnerScope: 'you',
  onNavigate: vi.fn(),
  onAddTransaction: vi.fn(),
  onAddGoal: vi.fn(),
  onOpenAssistant: vi.fn(),
});

const renderDashboard = (overrides = {}) => {
  const props = { ...baseProps(), ...overrides };
  render(<DashboardView {...props} />);
  return { props, user: userEvent.setup() };
};

const kpi = (name) => screen.getByRole('article', { name });

describe('DashboardView', () => {
  it('exposes the scope as a pressed-button group and reports changes', async () => {
    const { props, user } = renderDashboard();
    const group = screen.getByRole('group', { name: 'Ver datos de' });

    expect(within(group).getByRole('button', { name: 'Hogar' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: 'Tú' })).toHaveAttribute('aria-pressed', 'false');

    await user.click(within(group).getByRole('button', { name: 'Pareja' }));
    expect(props.onScopeChange).toHaveBeenCalledWith('partner');
  });

  it('renders empty states instead of crashing when there is no data', async () => {
    const { props, user } = renderDashboard();

    expect(screen.getByRole('heading', { level: 1, name: 'Resumen' })).toBeInTheDocument();
    expect(screen.getByText('Sin movimientos en los últimos 6 meses.')).toBeInTheDocument();
    expect(screen.getByText('Sin gastos registrados este mes.')).toBeInTheDocument();
    expect(screen.getByText('Aún no hay movimientos en este periodo.')).toBeInTheDocument();
    expect(screen.getByText('Todavía no han creado metas.')).toBeInTheDocument();
    expect(screen.getByText('Sin presupuesto definido')).toBeInTheDocument();
    expect(screen.getByText('Define presupuestos para ver el ritmo del hogar.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Día a día' }));
    expect(screen.getByText('Sin movimientos este mes.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Crear meta' }));
    expect(props.onAddGoal).toHaveBeenCalled();
  });

  it('shows the KPIs, the budget insight and real data', () => {
    renderDashboard({
      totals: { income: 5200000, expenses: 1200000 },
      incomeCount: 1,
      expenseCount: 2,
      budget: { planned: 2400000, spent: 1200000 },
      categoryStats: [
        { $id: 'c1', name: 'Mercado', color: '#0B6E4F', value: 900000 },
        { $id: 'c2', name: 'Transporte', color: '#7A5AF8', value: 300000 },
      ],
      recentTransactions: [
        { $id: 't1', merchant: 'Nómina', categoryName: 'Ingresos', type: 'income', amountMinor: 5200000, currency: 'COP', ownerScope: 'you', occurredAt: at(1) },
      ],
      goals: [{ $id: 'g1', name: 'Fondo de emergencia', targetMinor: 15000000, currentMinor: 8400000, ownerScope: 'shared' }],
    });

    expect(within(kpi('Balance del mes')).getByText('$ 4.000.000')).toBeInTheDocument();
    expect(within(kpi('Gastos')).getByText('2 movimientos')).toBeInTheDocument();
    expect(within(kpi('Presupuesto usado')).getByText('50 %')).toBeInTheDocument();
    expect(screen.getByText('Han usado el 50% del presupuesto.')).toBeInTheDocument();
    expect(within(screen.getByRole('figure', { name: /Gastos por categoría/ })).getByText('75 %')).toBeInTheDocument();
    expect(within(screen.getByRole('article', { name: 'Últimos movimientos' })).getByText('+ $ 5.200.000')).toBeInTheDocument();
    expect(screen.getByText('56 %')).toBeInTheDocument();
  });

  it('compares the KPIs with the previous month', () => {
    renderDashboard({
      totals: { income: 5200000, expenses: 1200000 },
      history: withMonths({ '2026-09': { income: 4000000, expenses: 1500000 }, '2026-10': { income: 5200000, expenses: 1200000 } }),
    });

    expect(kpi('Ingresos')).toHaveTextContent('+30 % vs. septiembre');
    expect(kpi('Gastos')).toHaveTextContent('−20 % vs. septiembre');
    expect(kpi('Balance del mes')).toHaveTextContent('+ $ 1.500.000 vs. septiembre');
  });

  it('shows the absolute change when the previous month was zero, and equality when unchanged', () => {
    renderDashboard({
      totals: { income: 5200000, expenses: 0 },
      history: withMonths({ '2026-10': { income: 5200000, expenses: 0 } }),
    });

    expect(kpi('Ingresos')).toHaveTextContent('+ $ 5.200.000 vs. septiembre');
    expect(within(kpi('Gastos')).getByText('Igual que septiembre')).toBeInTheDocument();
  });

  it('defaults to the 6-month chart with a data table that shows months without data as zero', () => {
    renderDashboard({
      history: withMonths({ '2026-08': { income: 1000, expenses: 500 }, '2026-10': { income: 2000, expenses: 0 } }),
    });

    const view = screen.getByRole('group', { name: 'Vista del flujo de caja' });
    expect(within(view).getByRole('button', { name: '6 meses' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('figure', { name: 'Ingresos y gastos de los últimos 6 meses' })).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Ingresos y gastos de los últimos 6 meses' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toHaveTextContent('Mayo 2026$ 0$ 0');
    expect(rows[3]).toHaveTextContent('Agosto 2026$ 1.000$ 500');
  });

  it('switches to the daily cumulative chart with its own text alternative', async () => {
    const { user } = renderDashboard({
      cashflow: [{ day: 1, income: 5200000, expenses: 0 }, { day: 2, income: 5200000, expenses: 1200000 }],
      history: withMonths({ '2026-10': { income: 5200000, expenses: 1200000 } }),
    });

    await user.click(screen.getByRole('button', { name: 'Día a día' }));

    expect(screen.getByRole('figure', { name: /Flujo de caja acumulado/ })).toBeInTheDocument();
    expect(within(screen.getByRole('table', { name: /Flujo de caja acumulado/ })).getAllByRole('row')).toHaveLength(3);
  });

  it('opens Nia from the insight card', async () => {
    const { props, user } = renderDashboard();

    await user.click(screen.getByRole('button', { name: 'Preguntarle a Nia' }));

    expect(props.onOpenAssistant).toHaveBeenCalled();
  });
});

describe('DashboardView on a phone and transaction detail', () => {
  const recent = [
    { $id: 't1', merchant: 'Nómina', categoryName: 'Ingresos', type: 'income', amountMinor: 5200000, currency: 'COP', ownerScope: 'you', occurredAt: at(1) },
    { $id: 't2', merchant: 'Taxi', categoryName: 'Transporte', type: 'expense', amountMinor: 48900, currency: 'COP', ownerScope: 'partner', occurredAt: at(2) },
  ];

  it('keeps recent transactions as a list at 375px', () => {
    window.innerWidth = 375;
    renderDashboard({ recentTransactions: recent });
    const card = screen.getByRole('article', { name: 'Últimos movimientos' });

    expect(within(card).getAllByRole('listitem')).toHaveLength(2);
    expect(within(card).queryByRole('table')).not.toBeInTheDocument();
  });

  it('opens the detail from a recent transaction', async () => {
    const onOpenDetail = vi.fn();
    const { user } = renderDashboard({ recentTransactions: recent, onOpenDetail });

    await user.click(screen.getByRole('button', { name: 'Ver detalle de Taxi' }));

    expect(onOpenDetail).toHaveBeenCalledWith(recent[1]);
  });
});

describe('interactive charts in the dashboard', () => {
  const spread = [
    ['c1', 'Hogar', 1100000], ['c2', 'Tecnología', 560000], ['c3', 'Salud', 540000], ['c4', 'Servicios', 500000],
    ['c5', 'Alimentación', 490000], ['c6', 'Mercado', 430000], ['c7', 'Ocio', 40000],
  ].map(([$id, name, value]) => ({ $id, name, value, color: '#0B6E4F' }));
  const legend = () => within(screen.getByRole('figure', { name: /Gastos por categoría/ }));

  it('names the 5 biggest categories and folds the rest into an expandable Otros', async () => {
    const { user } = renderDashboard({ categoryStats: spread });

    expect(legend().getAllByRole('button', { name: /^Ver movimientos de/ }).map((button) => button.textContent)).toEqual([
      'Hogar$ 1,1 M30 %', 'Tecnología$ 560 k15 %', 'Salud$ 540 k15 %', 'Servicios$ 500 k14 %', 'Alimentación$ 490 k13 %',
    ]);
    const other = legend().getByRole('button', { name: /^Otros \(2\)/ });
    expect(other).toHaveAttribute('aria-expanded', 'false');

    await user.click(other);

    expect(other).toHaveAttribute('aria-expanded', 'true');
    expect(legend().getByRole('button', { name: /^Ver movimientos de Mercado/ })).toBeInTheDocument();
    expect(legend().getByRole('button', { name: /^Ver movimientos de Ocio/ })).toBeInTheDocument();
  });

  it('shows the hovered or focused category in the center of the donut', async () => {
    const { user } = renderDashboard({ categoryStats: spread });
    expect(legend().getByText('gastado')).toBeInTheDocument();

    await user.hover(legend().getByRole('button', { name: /^Ver movimientos de Tecnología/ }));
    expect(legend().getByTestId('donut-center')).toHaveTextContent('Tecnología$ 560 k15 %');

    await user.unhover(legend().getByRole('button', { name: /^Ver movimientos de Tecnología/ }));
    expect(legend().getByTestId('donut-center')).toHaveTextContent('$ 3,7 Mgastado');
  });

  it('opens the movements of a category, folded ones included', async () => {
    const onSelectCategory = vi.fn();
    const { user } = renderDashboard({ categoryStats: spread, onSelectCategory });

    await user.click(legend().getByRole('button', { name: /^Ver movimientos de Hogar/ }));
    await user.click(legend().getByRole('button', { name: /Otros/ }));
    await user.click(legend().getByRole('button', { name: /^Ver movimientos de Ocio/ }));

    expect(onSelectCategory.mock.calls).toEqual([['c1'], ['c7']]);
  });

  it('toggles the cash flow series from the legend but never hides both', async () => {
    const { user } = renderDashboard({ history: withMonths({ '2026-10': { income: 2000, expenses: 500 } }) });
    const series = screen.getByRole('group', { name: 'Series del flujo de caja' });
    const income = within(series).getByRole('button', { name: 'Ingresos' });
    const expenses = within(series).getByRole('button', { name: 'Gastos' });
    expect(income).toHaveAttribute('aria-pressed', 'true');

    await user.click(expenses);

    expect(expenses).toHaveAttribute('aria-pressed', 'false');
    expect(income).toBeDisabled();
    await user.click(expenses);
    expect(income).toBeEnabled();
  });
});
