import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import DebtDetail from './DebtDetail';
import { buildDebtDetail } from './debtDetailModel';
import { makeCard, makeEvent } from './debtFixtures';

const pay = (id, on, amount) => makeEvent(id, 'payment', on, amount);
const renderCard = (events, asOf, props = {}) => {
  const debt = makeCard();
  return render(<DebtDetail debt={debt} detail={buildDebtDetail({ debt, events: events.map((e) => ({ ...e, debtId: 'c1' })), asOf })} currentOwnerScope="you" onBack={vi.fn()} {...props} />);
};

describe('DebtDetail for a credit card', () => {
  it('shows the minimum payment, the full statement, the cycle dates and each tranche', () => {
    renderCard([], '2026-04-20');

    const state = screen.getByRole('region', { name: 'Estado de la deuda' });
    expect(within(state).getByText('Pago mínimo')).toBeInTheDocument();
    expect(within(state).getByText('$ 146.102')).toBeInTheDocument();
    expect(within(state).getByText('30 abr')).toBeInTheDocument();
    expect(within(state).getByText('$ 621.102')).toBeInTheDocument(); // pay in full
    expect(within(state).getByText('28 % E.A.')).toBeInTheDocument();

    const panel = screen.getByRole('region', { name: 'Tu tarjeta' });
    expect(within(panel).getByText('Próximo corte: 15 may. Próximo pago: 30 may.')).toBeInTheDocument();
    const [revolving, nevera] = within(panel).getAllByRole('listitem');
    expect(revolving).toHaveTextContent('Saldo rotativo');
    expect(revolving).toHaveTextContent('$ 500.000');
    expect(nevera).toHaveTextContent('Nevera');
    expect(nevera).toHaveTextContent('Compra a 12 cuotas, quedan 11');
    expect(nevera).toHaveTextContent('$ 1.200.000');
    expect(within(panel).getByText('Último extracto, corte del 15 abr')).toBeInTheDocument();
    for (const amount of ['$ 10.392', '$ 10.710', '$ 100.000']) expect(within(panel).getByText(amount)).toBeInTheDocument(); // interest, fee + IVA, installment
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Simular abono' })).not.toBeInTheDocument();
  });

  it('flags a minimum that was not paid by the due date, and clears the flag once it is paid', () => {
    const { unmount } = renderCard([], '2026-05-02');
    expect(screen.getByRole('alert')).toHaveTextContent('Tienes $ 146.102 vencidos');
    expect(within(screen.getByRole('region', { name: 'Estado de la deuda' })).getByText('Vencido')).toBeInTheDocument();
    unmount();

    renderCard([pay('p1', '2026-04-30', 146102)], '2026-05-02');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Estado de la deuda' })).getByText('Sin pago mínimo pendiente')).toBeInTheDocument();
  });

  it('offers the statement and purchase actions only when the container wires them', async () => {
    const onStatement = vi.fn();
    const onCharge = vi.fn();
    const { unmount } = renderCard([], '2026-04-20');
    expect(screen.queryByRole('button', { name: 'Registrar extracto' })).not.toBeInTheDocument();
    unmount();

    renderCard([], '2026-04-20', { onStatement, onCharge });
    await userEvent.click(screen.getByRole('button', { name: 'Registrar extracto' }));
    await userEvent.click(screen.getByRole('button', { name: 'Registrar compra' }));
    expect(onStatement).toHaveBeenCalledTimes(1);
    expect(onCharge).toHaveBeenCalledTimes(1);
  });
});
