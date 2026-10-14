import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import DebtDetail from './DebtDetail';
import { buildDebtDetail } from './debtDetailModel';
import { makeDebt, makeEvent, makePayment } from './debtFixtures';

const DISBURSEMENT = makeEvent('e0', 'disbursement', '2026-01-05', 1000000);
const THREE_PAYMENTS = [DISBURSEMENT, makePayment('e1', '2026-02-05'), makePayment('e2', '2026-03-05'), makePayment('e3', '2026-04-05')];
const detailOf = (events, asOf, debt = makeDebt()) => buildDebtDetail({ debt, events, asOf });
const renderDetail = (props = {}) => {
  const debt = props.debt ?? makeDebt();
  return render(<DebtDetail debt={debt} detail={props.detail === undefined ? detailOf(THREE_PAYMENTS, '2026-04-20', debt) : props.detail} currentOwnerScope="you" onBack={vi.fn()} {...props} />);
};

describe('DebtDetail', () => {
  it('shows the state, the real cost, the plan and the history of a loan with 3 payments', () => {
    renderDetail();

    expect(screen.getByRole('heading', { level: 1, name: 'Crédito de consumo' })).toBeInTheDocument();
    const state = screen.getByRole('region', { name: 'Estado de la deuda' });
    expect(within(state).getByText(/^\$ 7\d\d\.\d{3}$/)).toBeInTheDocument(); // balance after 3 paid installments
    expect(within(state).getByText('$ 93.453')).toBeInTheDocument(); // next installment
    expect(within(state).getByText('5 may')).toBeInTheDocument();
    expect(within(state).getByText('24 % E.A.')).toBeInTheDocument();
    expect(within(state).getByText('9')).toBeInTheDocument(); // installments left

    const cost = screen.getByRole('region', { name: 'Costo real del crédito' });
    expect(within(cost).getByText('Intereses')).toBeInTheDocument();
    expect(within(cost).getByText('Costo total')).toBeInTheDocument();

    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows).toHaveLength(13);
    expect(within(rows[1]).getByText('Pagada')).toBeInTheDocument();
    expect(within(rows[4]).getByText('Próxima')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Historial' })).getAllByRole('listitem')).toHaveLength(4);
  });

  it('calls out an overdue amount', () => {
    renderDetail({ detail: detailOf([DISBURSEMENT], '2026-03-20') });

    expect(screen.getByRole('alert')).toHaveTextContent('Tienes $ 186.906 vencidos');
    expect(within(screen.getByRole('region', { name: 'Estado de la deuda' })).getByText('Vencida')).toBeInTheDocument();
  });

  it('explains a balance-only debt instead of showing an empty plan', () => {
    const informal = makeDebt({}, { system: 'none', n: undefined, firstDueOn: undefined, periodicity: undefined, rate: { convention: 'ZERO' } });
    renderDetail({ debt: informal, detail: detailOf([DISBURSEMENT], '2026-02-01', informal) });

    expect(screen.getByText('Esta deuda no tiene plan de cuotas: solo se lleva el saldo.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows the repair notice without hiding anything, and the back action works', async () => {
    const onBack = vi.fn();
    renderDetail({ onBack, notice: 'No se pudieron verificar los costos financieros.' });

    expect(screen.getByRole('status')).toHaveTextContent('No se pudieron verificar los costos financieros.');
    expect(screen.getByRole('table')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Volver a deudas' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('offers payment and simulation only when the container wires them', async () => {
    const onPay = vi.fn();
    const { unmount } = renderDetail();
    expect(screen.queryByRole('button', { name: 'Registrar pago' })).not.toBeInTheDocument();
    unmount();

    renderDetail({ onPay, onSimulate: vi.fn() });
    await userEvent.click(screen.getByRole('button', { name: 'Registrar pago' }));
    expect(onPay).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Simular abono' })).toBeInTheDocument();
  });

  it('shows Más acciones only when an action is wired, and runs the one chosen', async () => {
    const onRateChange = vi.fn();
    const { unmount } = renderDetail();
    expect(screen.queryByRole('button', { name: 'Más acciones' })).not.toBeInTheDocument();
    unmount();

    renderDetail({ onRateChange });
    await userEvent.click(screen.getByRole('button', { name: 'Más acciones' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Cambiar tasa']);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Cambiar tasa' }));
    expect(onRateChange).toHaveBeenCalledTimes(1);
  });

  it('lists the charge change next to the rate change and runs the one chosen', async () => {
    const onRateChange = vi.fn();
    const onChargeChange = vi.fn();
    renderDetail({ onRateChange, onChargeChange });
    await userEvent.click(screen.getByRole('button', { name: 'Más acciones' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Cambiar tasa', 'Cambiar seguros y cargos']);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Cambiar seguros y cargos' }));
    expect(onChargeChange).toHaveBeenCalledTimes(1);
    expect(onRateChange).not.toHaveBeenCalled();
  });

  it('reports a debt it cannot read', () => {
    renderDetail({ detail: null });

    expect(screen.getByText('No se pudo leer esta deuda.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

describe('DebtDetail load-time notices', () => {
  const LEGAL_COPY = 'No pudimos leer las tasas legales del hogar; usamos los valores de la app.';
  const UNKNOWN_COPY = /movimientos de una versión más nueva de la app/;

  it.each(['missing', 'unavailable'])('shows the legal rates notice without hiding the debt (legalStatus %s)', (legalStatus) => {
    renderDetail({ legalStatus });

    expect(screen.getByText(LEGAL_COPY)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Estado de la deuda' })).toBeInTheDocument();
  });

  it('shows no legal rates notice when the rates were read', () => {
    renderDetail({ legalStatus: 'ok' });
    expect(screen.queryByText(LEGAL_COPY)).not.toBeInTheDocument();
  });

  it('warns about events of a newer app version and still shows what it understands', () => {
    const events = [...THREE_PAYMENTS, makeEvent('f1', 'late_policy_v9', '2026-04-10', 0, { late: { mode: 'usury' } })];
    renderDetail({ detail: detailOf(events, '2026-04-20') });

    expect(screen.getByText(UNKNOWN_COPY)).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Historial' })).getAllByRole('listitem')).toHaveLength(4);
  });

  it('shows no newer-version warning when every event is known', () => {
    renderDetail();
    expect(screen.queryByText(UNKNOWN_COPY)).not.toBeInTheDocument();
  });
});
