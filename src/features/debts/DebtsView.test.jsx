import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import DebtsView from './DebtsView';

const item = (overrides) => ({
  id: 'd1', name: 'Libre inversión', lender: 'Bancolombia', kind: 'consumer', ownerScope: 'you', status: 'active',
  balanceMinor: 8400000, pastDueMinor: 0, remainingPeriods: 24, progressPercent: 30, eaPercent: 28.32,
  nextDue: { dueOn: '2026-11-05', amountMinor: 450000, status: 'due' }, ...overrides,
});
const ITEMS = [
  item(),
  item({ id: 'd2', name: 'Préstamo de mamá', lender: 'Familia', kind: 'family', ownerScope: 'shared', balanceMinor: 1200000, eaPercent: 0, progressPercent: 0, nextDue: { dueOn: '2026-10-20', amountMinor: 100000, status: 'pastDue' } }),
];
const TOTALS = { count: 2, balanceMinor: 9600000, installmentsMinor: 550000, nextDueOn: '2026-10-20' };

const renderView = (props = {}) => {
  const handlers = { onAdd: vi.fn(), onRetry: vi.fn(), ...props };
  render(<DebtsView status="ready" items={ITEMS} totals={TOTALS} currentOwnerScope="you" {...handlers} />);
  return { ...handlers, user: userEvent.setup() };
};

describe('DebtsView', () => {
  it('lists each debt with lender, balance, next installment with its date, and the EA rate', () => {
    renderView();
    const card = screen.getByRole('article', { name: 'Libre inversión' });

    expect(within(card).getByText('Bancolombia')).toBeInTheDocument();
    expect(within(card).getByText('$ 8.400.000')).toBeInTheDocument();
    expect(within(card).getByText('$ 450.000')).toBeInTheDocument();
    expect(within(card).getByText('5 nov')).toBeInTheDocument();
    expect(within(card).getByText('28,32 % E.A.')).toBeInTheDocument();
    expect(within(card).getByText('Tú')).toBeInTheDocument();
  });

  it('labels a credit card by its minimum payment and does not show a paid-off percentage', () => {
    const cardItem = item({ id: 'c1', name: 'Visa Oro', kind: 'card', progressPercent: 0, nextDue: { dueOn: '2026-11-10', amountMinor: 121102, status: 'due' } });
    render(<DebtsView status="ready" items={[cardItem]} totals={TOTALS} currentOwnerScope="you" onAdd={vi.fn()} onRetry={vi.fn()} />);
    const card = screen.getByRole('article', { name: 'Visa Oro' });

    expect(within(card).getByText('Pago mínimo')).toBeInTheDocument();
    expect(within(card).getByText('$ 121.102')).toBeInTheDocument();
    expect(within(card).queryByText('Próxima cuota')).not.toBeInTheDocument();
    expect(within(card).queryByText(/Pagado/)).not.toBeInTheDocument();
  });

  it('flags an overdue installment and labels an interest-free debt', () => {
    renderView();
    const card = screen.getByRole('article', { name: 'Préstamo de mamá' });

    expect(within(card).getByText('Vencida')).toBeInTheDocument();
    expect(within(card).getByText('Sin intereses')).toBeInTheDocument();
    expect(within(card).getByText('Compartido')).toBeInTheDocument();
    expect(within(screen.getByRole('article', { name: 'Libre inversión' })).queryByText('Vencida')).not.toBeInTheDocument();
  });

  it('opens the detail of the debt whose name is picked', async () => {
    const { user, onOpen } = renderView({ onOpen: vi.fn() });

    await user.click(within(screen.getByRole('article', { name: 'Préstamo de mamá' })).getByRole('button', { name: 'Préstamo de mamá' }));

    expect(onOpen).toHaveBeenCalledWith('d2');
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('keeps the card plain without an open handler', () => {
    renderView();
    expect(within(screen.getByRole('article', { name: 'Libre inversión' })).queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows totals that equal the sum of the debts', () => {
    renderView();
    const totals = screen.getByRole('region', { name: 'Totales de deudas' });

    expect(within(totals).getByText('$ 9.600.000')).toBeInTheDocument();
    expect(within(totals).getByText('$ 550.000')).toBeInTheDocument();
    expect(within(totals).getByText('20 oct')).toBeInTheDocument();
  });

  it('shows an empty state with a create action', async () => {
    const { onAdd, user } = renderView({ items: [], totals: { count: 0, balanceMinor: 0, installmentsMinor: 0, nextDueOn: null } });

    expect(screen.getByText('Aún no hay deudas registradas.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Totales de deudas' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Registrar una deuda' }));

    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('opens the create flow from the header', async () => {
    const { onAdd, user } = renderView();

    await user.click(screen.getByRole('button', { name: 'Nueva deuda' }));

    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('offers no create action when creation is not available', () => {
    renderView({ onAdd: undefined });

    expect(screen.queryByRole('button', { name: 'Nueva deuda' })).not.toBeInTheDocument();
  });

  it('keeps an unreadable debt out of the figures and says so', () => {
    renderView({ items: [{ id: 'x', name: 'Rota', kind: 'other', ownerScope: 'you', unreadable: true }, ITEMS[0]] });

    const card = screen.getByRole('article', { name: 'Rota' });
    expect(within(card).getByText('No se pudo leer esta deuda.')).toBeInTheDocument();
    expect(within(card).queryByText(/\$/)).not.toBeInTheDocument();
  });
});

describe('DebtsView loading and failure', () => {
  it('shows a status while loading and no totals', () => {
    renderView({ status: 'loading', items: [], totals: undefined });

    expect(screen.getByRole('status', { name: 'Cargando deudas…' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Totales de deudas' })).not.toBeInTheDocument();
  });

  it('shows an error panel with Reintentar and no stale totals or cards', async () => {
    const { onRetry, user } = renderView({ status: 'error' });

    expect(screen.getByText('No se pudieron cargar las deudas.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Totales de deudas' })).not.toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
