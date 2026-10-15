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

  it('shows a terms correction with both values instead of an amount, and offers to void it', async () => {
    const onVoid = vi.fn();
    const correction = entry({
      id: 'tc1', kind: 'terms_correction', effectiveOn: '2026-06-01', amountMinor: 0, costMinor: 0,
      summary: 'Corrección: día de corte 15 → 20 · pago mínimo 5 % → 3 %',
    });
    render(<EventHistory history={[correction]} onVoid={onVoid} />);

    const item = screen.getByRole('listitem');
    expect(within(item).getByText('Corrección de datos')).toBeInTheDocument();
    expect(within(item).getByText('Corrección: día de corte 15 → 20 · pago mínimo 5 % → 3 %')).toBeInTheDocument();
    expect(within(item).queryByText('$ 0')).not.toBeInTheDocument();
    await userEvent.click(within(item).getByRole('button', { name: 'Anular corrección de datos del 1 jun' }));
    expect(onVoid).toHaveBeenCalledWith(correction);
  });

  it('shows the summary of a plan change instead of an amount of $ 0, and still offers to void it', async () => {
    const onVoid = vi.fn();
    const change = entry({
      id: 'rc1', kind: 'rate_change', effectiveOn: '2026-11-01', amountMinor: 0, costMinor: 0,
      summary: 'Tasa: 24,00 % → 20,00 % E.A. desde 1 nov · mantiene plazo',
    });
    render(<EventHistory history={[change]} onVoid={onVoid} />);

    const item = screen.getByRole('listitem');
    expect(within(item).getByText('Cambio de tasa')).toBeInTheDocument();
    expect(within(item).getByText('Tasa: 24,00 % → 20,00 % E.A. desde 1 nov · mantiene plazo')).toBeInTheDocument();
    expect(within(item).queryByText('$ 0')).not.toBeInTheDocument();
    await userEvent.click(within(item).getByRole('button', { name: 'Anular cambio de tasa del 1 nov' }));
    expect(onVoid).toHaveBeenCalledWith(change);
  });

  it('labels the restructure, charge change and mora policy rows and keeps the amount of the rows that have one', () => {
    render(<EventHistory history={[
      entry({ id: 'a', kind: 'restructure', summary: 'Reestructuración: $ 9.812.000 a 36 cuotas', amountMinor: 0, canVoid: true }),
      entry({ id: 'b', kind: 'charge_change', summary: 'Cargos: Seguro de vida', amountMinor: 0, canVoid: false }),
      entry({ id: 'c', kind: 'late_policy', summary: 'Mora: tasa de usura desde 13 oct', amountMinor: 0, canVoid: false }),
      entry({ id: 'd', kind: 'payment', summary: null, amountMinor: 93453, canVoid: false }),
    ]} onVoid={vi.fn()} />);

    const [restructure, charges, mora, payment] = screen.getAllByRole('listitem');
    expect(within(restructure).getByText('Reestructuración')).toBeInTheDocument();
    expect(within(restructure).getByText('Reestructuración: $ 9.812.000 a 36 cuotas')).toBeInTheDocument();
    expect(within(charges).getByText('Cargos: Seguro de vida')).toBeInTheDocument();
    expect(within(mora).getByText('Política de mora')).toBeInTheDocument();
    expect(within(mora).getByText('Mora: tasa de usura desde 13 oct')).toBeInTheDocument();
    expect(within(payment).getByText('$ 93.453')).toBeInTheDocument();
    expect(screen.queryByText('$ 0')).not.toBeInTheDocument();
  });

  it('says so when there is nothing recorded yet', () => {
    render(<EventHistory history={[]} onVoid={vi.fn()} />);
    expect(screen.getByText('Aún no hay movimientos registrados.')).toBeInTheDocument();
  });
});
