import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import BudgetView from './BudgetView';

const row = (categoryId, name, overrides = {}) => ({
  categoryId, name, color: '#0B6E4F', line: null, plannedMinor: 0, actualMinor: 0, remainingMinor: 0, overBudget: false, householdFixed: false, ...overrides,
});
const group = (categories, overrides = {}) => ({
  envelope: null, allocatedMinor: 0, subLimitsMinor: 0, actualMinor: 0, remainingMinor: 0, overBudget: false, categories, ...overrides,
});
const fixed = (amountMinor) => ({ rule: 'fixed', amountMinor, percentBp: null });
const percent = (percentBp) => ({ rule: 'percent', amountMinor: null, percentBp });

const budgetMonth = () => ({
  month: '2026-10',
  base: { source: 'actual', incomeMinor: 5000000 },
  groups: {
    need: group([
      row('c1', 'Mercado', { line: fixed(600000), plannedMinor: 600000, actualMinor: 845300, remainingMinor: -245300, overBudget: true, householdFixed: true }),
      row('c2', 'Arriendo', { line: percent(2000), plannedMinor: 1000000, actualMinor: 1000000 }),
      row('c3', 'Transporte', { line: fixed(0) }),
    ], { envelope: 2000000, allocatedMinor: 2000000, subLimitsMinor: 1600000, actualMinor: 1845300, remainingMinor: 154700 }),
    want: group([row('c4', 'Ocio')]),
    saving: group([row('c5', 'Fondo de emergencia', { line: fixed(300000), plannedMinor: 300000, actualMinor: 450000, remainingMinor: -150000, overBudget: true })], { allocatedMinor: 300000, subLimitsMinor: 300000, actualMinor: 450000, overBudget: true }),
    investment: group([row('c6', 'CDT')]),
    debt: group([row('c7', 'Tarjeta')]),
  },
  totals: { budgetUsed: { plannedMinor: 1600000, spentMinor: 1845300 } },
  warnings: [],
});

const CATEGORIES = [{ $id: 'c1', name: 'Mercado' }];

const renderView = (overrides = {}) => {
  const props = {
    budgetMonth: budgetMonth(),
    allCategories: CATEGORIES,
    month: '2026-10',
    isCurrentMonth: true,
    dayOfMonth: 28,
    daysInMonth: 31,
    canEdit: true,
    onCreateCategory: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  render(<BudgetView {...props} />);
  return { props, user: userEvent.setup() };
};

const section = (name) => screen.getByRole('region', { name });

describe('BudgetView group sections', () => {
  it('renders the five groups in order', () => {
    renderView();
    const names = screen.getAllByRole('region').map((region) => region.getAttribute('aria-label')).filter((label) => label.startsWith('Grupo '));
    expect(names).toEqual(['Grupo Necesidades', 'Grupo Gustos', 'Grupo Ahorro', 'Grupo Inversión', 'Grupo Deudas']);
  });

  it('shows planned, actual and remaining plus the rule chip of each category row', () => {
    renderView();
    const mercado = within(section('Grupo Necesidades')).getByRole('row', { name: /Mercado/ });
    expect(within(mercado).getByText('Fijo')).toBeInTheDocument();
    expect(within(mercado).getByText('$ 600.000')).toBeInTheDocument();
    expect(within(mercado).getByText('$ 845.300')).toBeInTheDocument();
    expect(within(mercado).getByText('− $ 245.300')).toBeInTheDocument();

    const arriendo = within(section('Grupo Necesidades')).getByRole('row', { name: /Arriendo/ });
    expect(within(arriendo).getByText('20 %')).toBeInTheDocument();
  });

  it('marks household fixed lines with a Hogar chip', () => {
    renderView();
    expect(within(within(section('Grupo Necesidades')).getByRole('row', { name: /Mercado/ })).getByText('Hogar')).toBeInTheDocument();
    expect(within(within(section('Grupo Necesidades')).getByRole('row', { name: /Arriendo/ })).queryByText('Hogar')).not.toBeInTheDocument();
  });

  it('styles an over-budget consumption row as over and a saving overshoot as achieved', () => {
    renderView();
    const mercado = within(section('Grupo Necesidades')).getByRole('row', { name: /Mercado/ });
    expect(within(mercado).getByText('Excedido')).toBeInTheDocument();

    const fondo = within(section('Grupo Ahorro')).getByRole('row', { name: /Fondo de emergencia/ });
    expect(within(fondo).queryByText('Excedido')).not.toBeInTheDocument();
    expect(within(fondo).getByText('Meta superada')).toBeInTheDocument();
    expect(within(fondo).getByText('+ $ 150.000')).toBeInTheDocument();
  });

  it('shows "Sin límite" for rows without a limit and for a removed line', () => {
    renderView();
    const transporte = within(section('Grupo Necesidades')).getByRole('row', { name: /Transporte/ });
    expect(within(transporte).getByText('Sin límite')).toBeInTheDocument();
    expect(within(within(section('Grupo Gustos')).getByRole('row', { name: /Ocio/ })).getByText('Sin límite')).toBeInTheDocument();
  });

  it('tells the group envelope apart from the sub-limits and warns when they exceed it', () => {
    renderView({ budgetMonth: { ...budgetMonth(), warnings: [{ code: 'sublimits_exceed_envelope', group: 'need', amountMinor: 100000 }] } });
    const need = section('Grupo Necesidades');
    expect(within(need).getByText('Tope del grupo')).toBeInTheDocument();
    expect(within(need).getByText('$ 2.000.000')).toBeInTheDocument();
    expect(within(need).getByText(/Los límites de las categorías suman \$ 100\.000 más que el tope/)).toBeInTheDocument();
    expect(within(section('Grupo Gustos')).queryByText(/suman/)).not.toBeInTheDocument();
  });

  it('warns when the debt data could not be read', () => {
    renderView({ budgetMonth: { ...budgetMonth(), warnings: [{ code: 'debt_data_unavailable' }] } });
    expect(screen.getByText(/No pudimos leer los pagos de deudas/)).toBeInTheDocument();
  });

  it('documents the credit-card double counting limitation', () => {
    renderView();
    expect(screen.getByText(/compra con tarjeta de crédito cuenta en su categoría/)).toBeInTheDocument();
  });

  it('has no copy-previous control and no limit inputs', () => {
    renderView();
    expect(screen.queryByRole('button', { name: /Copiar del mes anterior/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  it('offers the line editor hook only when editing is on and a handler exists', async () => {
    const onEditLine = vi.fn();
    const { user } = renderView({ onEditLine });
    await user.click(within(within(section('Grupo Necesidades')).getByRole('row', { name: /Mercado/ })).getByRole('button', { name: 'Editar límite de Mercado' }));
    expect(onEditLine).toHaveBeenCalledWith({ targetType: 'category', targetId: 'c1' });
  });

  it('hides the editor hook when editing is off', () => {
    renderView({ onEditLine: vi.fn(), canEdit: false });
    expect(screen.queryByRole('button', { name: /Editar límite/ })).not.toBeInTheDocument();
  });

  it('hides the editor hook without a handler', () => {
    renderView();
    expect(screen.queryByRole('button', { name: /Editar límite/ })).not.toBeInTheDocument();
  });
});

describe('BudgetView summary and header', () => {
  it('summarises planned, spent and available over the limited targets', () => {
    renderView();
    const summary = screen.getByRole('region', { name: 'Resumen del presupuesto' });
    expect(within(summary).getByText('$ 1.600.000')).toBeInTheDocument();
    expect(within(summary).getByText('$ 1.845.300')).toBeInTheDocument();
    expect(within(summary).getByText('− $ 245.300')).toBeInTheDocument();
    expect(within(summary).getByText('Día 28 de 31')).toBeInTheDocument();
  });

  it('labels a past month as closed', () => {
    renderView({ isCurrentMonth: false });
    expect(within(screen.getByRole('region', { name: 'Resumen del presupuesto' })).getByText('Mes cerrado')).toBeInTheDocument();
  });

  it('renders the header slot', () => {
    renderView({ header: <p>Encabezado de prueba</p> });
    expect(screen.getByText('Encabezado de prueba')).toBeInTheDocument();
  });

  it('opens the new category dialog', async () => {
    const { user } = renderView();
    await user.click(screen.getByRole('button', { name: 'Agregar categoría' }));
    expect(screen.getByRole('dialog', { name: 'Nueva categoría' })).toBeInTheDocument();
  });
});

describe('BudgetView on a phone', () => {
  it('renders each category as a stacked card instead of a table', () => {
    window.innerWidth = 375;
    renderView();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const cards = within(within(section('Grupo Necesidades')).getByRole('list', { name: 'Categorías de Necesidades' })).getAllByRole('listitem');
    expect(cards).toHaveLength(3);
    expect(cards[0]).toHaveTextContent('Mercado');
    expect(within(cards[0]).getByText('Excedido')).toBeInTheDocument();
    expect(within(cards[0]).getByText('Hogar')).toBeInTheDocument();
    expect(within(cards[0]).getByText('− $ 245.300')).toBeInTheDocument();
  });
});
