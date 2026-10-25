import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import BudgetHeader from './BudgetHeader';

const monthWith = ({ source = 'actual', incomeMinor = 5000000, allocatedMinor = 3500000, warnings = [] } = {}) => ({
  month: '2026-10',
  base: { source, incomeMinor },
  totals: { allocatedMinor, porAsignarMinor: incomeMinor - allocatedMinor },
  warnings,
});

const renderHeader = (props = {}) => render(<BudgetHeader budgetMonth={monthWith()} scope="total" linesMode="lines" {...props} />);

describe('BudgetHeader', () => {
  it('shows the income base, Asignado and Por asignar', () => {
    renderHeader();
    expect(screen.getByText('Ingreso base').nextSibling).toHaveTextContent('$ 5.000.000');
    expect(screen.getByText('Asignado').nextSibling).toHaveTextContent('$ 3.500.000');
    expect(screen.getByText('Por asignar').nextSibling).toHaveTextContent('$ 1.500.000');
    expect(screen.queryByText(/Referencia/)).not.toBeInTheDocument();
    expect(screen.queryByText('Sobreasignado')).not.toBeInTheDocument();
  });

  it('flags a negative Por asignar as over-allocated', () => {
    renderHeader({ budgetMonth: monthWith({ allocatedMinor: 6000000, warnings: [{ code: 'over_allocated' }] }) });
    expect(screen.getByText('Por asignar').nextSibling).toHaveTextContent('− $ 1.000.000');
    expect(screen.getByText('Sobreasignado')).toBeInTheDocument();
  });

  it('labels a reference income with the previous month', () => {
    renderHeader({ budgetMonth: monthWith({ source: 'reference' }) });
    expect(screen.getByText('Referencia: septiembre de 2026')).toBeInTheDocument();
  });

  it('asks for an income when there is no base at all', () => {
    renderHeader({ budgetMonth: monthWith({ source: 'none', incomeMinor: 0, allocatedMinor: 0 }) });
    expect(screen.getByText(/Registra un ingreso/)).toBeInTheDocument();
    expect(screen.getByText('Ingreso base').nextSibling).toHaveTextContent('Sin definir');
  });

  it('shows the migration notice in legacy mode', () => {
    renderHeader({ linesMode: 'legacy' });
    expect(screen.getByText('Los presupuestos se están migrando; la edición se habilita al terminar.')).toBeInTheDocument();
  });

  it('asks to switch to Hogar when a personal scope is selected', () => {
    renderHeader({ scope: 'you' });
    expect(screen.getByText(/Cambia a Hogar/)).toBeInTheDocument();
  });

  it('shows no notice in Hogar scope with lines', () => {
    renderHeader();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });
});
