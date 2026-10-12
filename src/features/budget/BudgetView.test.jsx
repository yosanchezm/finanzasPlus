import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import BudgetView from './BudgetView';

const BUDGETS = [
  { $id: 'b1', categoryId: 'c1', month: '2026-10', plannedMinor: 600000 },
  { $id: 'b2', categoryId: 'c2', month: '2026-10', plannedMinor: 1800000 },
];

const PREVIOUS_BUDGETS = [
  { $id: 'p1', categoryId: 'c1', month: '2026-09', plannedMinor: 700000 },
];

const CATEGORIES = [
  { $id: 'c1', name: 'Restaurantes', color: '#E8875A', value: 845300, budget: 600000 },
  { $id: 'c2', name: 'Mercado', color: '#0B6E4F', value: 1480000, budget: 1800000 },
  { $id: 'c3', name: 'Ocio', color: '#7A5AF8', value: 0, budget: 0 },
];

const renderView = (overrides = {}) => {
  const props = {
    categories: CATEGORIES,
    allCategories: CATEGORIES,
    budgets: BUDGETS,
    month: '2026-10',
    isCurrentMonth: true,
    dayOfMonth: 28,
    daysInMonth: 31,
    onSave: vi.fn().mockResolvedValue(undefined),
    onCopyPrevious: vi.fn().mockResolvedValue(undefined),
    onCreateCategory: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  render(<BudgetView {...props} />);
  return { props, user: userEvent.setup() };
};

describe('BudgetView', () => {
  it('flags over-budget rows with "Excedido" and a negative remainder', () => {
    renderView();

    const over = screen.getByRole('row', { name: /Restaurantes/ });
    expect(within(over).getByText('Excedido')).toBeInTheDocument();
    expect(within(over).getByText('141 %')).toBeInTheDocument();
    expect(within(over).getByText('− $ 245.300')).toBeInTheDocument();

    const healthy = screen.getByRole('row', { name: /Mercado/ });
    expect(within(healthy).queryByText('Excedido')).not.toBeInTheDocument();
    expect(within(healthy).getByText('$ 320.000')).toBeInTheDocument();
  });

  it('summarises planned, spent, available and exceeded categories', () => {
    renderView();
    const summary = screen.getByRole('region', { name: 'Resumen del presupuesto' });

    expect(within(summary).getByText('$ 2.400.000')).toBeInTheDocument();
    expect(within(summary).getByText('$ 2.325.300')).toBeInTheDocument();
    expect(within(summary).getByText('$ 74.700')).toBeInTheDocument();
    expect(within(summary).getByText('1 de 2')).toBeInTheDocument();
    expect(within(summary).getByText('Día 28 de 31')).toBeInTheDocument();
  });

  it('labels a past month as closed', () => {
    renderView({ isCurrentMonth: false });

    expect(within(screen.getByRole('region', { name: 'Resumen del presupuesto' })).getByText('Mes cerrado')).toBeInTheDocument();
  });

  it('saves a changed limit when the field loses focus and confirms it', async () => {
    const { props, user } = renderView();
    const input = screen.getByLabelText('Límite de Mercado');

    await user.clear(input);
    await user.type(input, '2000000');
    await user.tab();

    expect(props.onSave).toHaveBeenCalledWith('c2', '2000000', BUDGETS[1]);
    expect(await within(screen.getByRole('row', { name: /Mercado/ })).findByText('Guardado')).toBeInTheDocument();
  });

  it('does not save when the value did not change', async () => {
    const { props, user } = renderView();

    await user.click(screen.getByLabelText('Límite de Mercado'));
    await user.tab();

    expect(props.onSave).not.toHaveBeenCalled();
  });

  it('saves once with Enter', async () => {
    const { props, user } = renderView();

    await user.type(screen.getByLabelText('Límite de Ocio'), '150000{Enter}');

    expect(props.onSave).toHaveBeenCalledTimes(1);
    expect(props.onSave).toHaveBeenCalledWith('c3', '150000', undefined);
  });

  it('locks the field while its save is in flight', async () => {
    let finish;
    const { user } = renderView({ onSave: vi.fn(() => new Promise((resolve) => { finish = resolve; })) });
    const input = screen.getByLabelText('Límite de Ocio');

    await user.type(input, '9000');
    await user.tab();

    expect(input).toHaveAttribute('readonly');
    expect(within(screen.getByRole('row', { name: /Ocio/ })).getByText('Guardando…')).toBeInTheDocument();
    finish();
    expect(await within(screen.getByRole('row', { name: /Ocio/ })).findByText('Guardado')).toBeInTheDocument();
    expect(input).not.toHaveAttribute('readonly');
  });

  it('shows an inline error when the save fails', async () => {
    const { user } = renderView({ onSave: vi.fn().mockRejectedValue(new Error('boom')) });
    const input = screen.getByLabelText('Límite de Ocio');

    await user.type(input, '9000');
    await user.tab();

    expect(await within(screen.getByRole('row', { name: /Ocio/ })).findByText('No se guardó')).toBeInTheDocument();
  });
});

describe('BudgetView copy from the previous month', () => {
  it('is disabled when the previous month has no limits', () => {
    renderView();

    expect(screen.getByRole('button', { name: 'Copiar del mes anterior' })).toBeDisabled();
  });

  it('asks for confirmation when the month already has limits', async () => {
    const { props, user } = renderView({ budgets: [...BUDGETS, ...PREVIOUS_BUDGETS] });

    await user.click(screen.getByRole('button', { name: 'Copiar del mes anterior' }));
    const dialog = screen.getByRole('alertdialog', { name: '¿Reemplazar los límites de octubre de 2026?' });
    expect(props.onCopyPrevious).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Copiar límites' }));

    expect(props.onCopyPrevious).toHaveBeenCalledTimes(1);
  });

  it('copies directly when the month has no limits yet', async () => {
    const { props, user } = renderView({ budgets: PREVIOUS_BUDGETS });

    await user.click(screen.getByRole('button', { name: 'Copiar del mes anterior' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(props.onCopyPrevious).toHaveBeenCalledTimes(1);
  });
});

describe('BudgetView add category', () => {
  it('opens the new category dialog', async () => {
    const { user } = renderView();

    await user.click(screen.getByRole('button', { name: 'Agregar categoría' }));

    expect(screen.getByRole('dialog', { name: 'Nueva categoría' })).toBeInTheDocument();
  });
});
