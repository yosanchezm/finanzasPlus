import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import EventHistory from './EventHistory';

const entry = (overrides) => ({ id: 'e1', kind: 'payment', effectiveOn: '2026-02-05', amountMinor: 93453, costMinor: 18088, voided: false, voidReason: null, canVoid: true, source: 'web', ...overrides });

describe('EventHistory', () => {
  it('lists each event with its amount and cost, and offers to void a payment', async () => {
    const onVoid = vi.fn();
    const first = entry();
    render(<EventHistory history={[first, entry({ id: 'e0', kind: 'disbursement', amountMinor: 1000000, costMinor: 0, canVoid: false, effectiveOn: '2026-01-05' })]} onVoid={onVoid} />);

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText('Pago')).toBeInTheDocument();
    expect(within(items[0]).getByText('$ 93.453')).toBeInTheDocument();
    expect(within(items[0]).getByText(/Costo financiero \$ 18\.088/)).toBeInTheDocument();
    expect(within(items[1]).getByText('Desembolso')).toBeInTheDocument();
    expect(within(items[1]).queryByRole('button')).not.toBeInTheDocument();

    await userEvent.click(within(items[0]).getByRole('button', { name: 'Anular pago del 5 feb' }));
    expect(onVoid).toHaveBeenCalledWith(first);
  });

  it('shows a voided event with its reason and no void action', () => {
    render(<EventHistory history={[entry({ voided: true, canVoid: false, costMinor: 0, voidReason: 'Registrado dos veces' })]} onVoid={vi.fn()} />);

    expect(screen.getByText('Anulado')).toBeInTheDocument();
    expect(screen.getByText('Registrado dos veces')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText(/Costo financiero/)).not.toBeInTheDocument();
  });

  it('says so when there is nothing recorded yet', () => {
    render(<EventHistory history={[]} onVoid={vi.fn()} />);
    expect(screen.getByText('Aún no hay movimientos registrados.')).toBeInTheDocument();
  });
});
