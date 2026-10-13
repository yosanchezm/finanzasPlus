import { compareStrategies } from '@finance-core';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import PrepaymentSimulator from './PrepaymentSimulator';
import { makeBigLoan, makeDebt, makeEvent } from './debtFixtures';
import { formatMoney } from '../../shared/lib/format';

const TODAY = '2026-02-05';
const EVENTS = [makeEvent('e0', 'disbursement', '2026-01-05', 10000000)];

const setup = async ({ debt = makeBigLoan(), events = EVENTS, amount = '2000000', ...props } = {}) => {
  const onRecord = vi.fn();
  const user = userEvent.setup();
  render(<PrepaymentSimulator debt={debt} events={events} today={TODAY} otherDebts={[]} cashflow={null} onRecord={onRecord} onClose={vi.fn()} {...props} />);
  if (amount !== null) await user.type(screen.getByLabelText('Monto del abono'), amount);
  return { user, onRecord };
};
const card = (name) => screen.getByRole('article', { name });

describe('PrepaymentSimulator', () => {
  it('compares the strategies side by side with the verdict and its reason, without writing anything', async () => {
    await setup();
    const expected = compareStrategies(makeBigLoan(), EVENTS, { amountMinor: 2000000, on: TODAY });

    const term = within(card('Reducir plazo'));
    expect(term.getByText('Nuevo plazo').nextSibling).toHaveTextContent(`${expected.reduceTerm.after.remainingPeriods} cuotas`);
    expect(term.getByText('Intereses ahorrados').nextSibling).toHaveTextContent(formatMoney(expected.reduceTerm.savings.interestMinor));
    expect(term.getByText('Cargos ahorrados').nextSibling).toHaveTextContent(formatMoney(expected.reduceTerm.savings.chargesMinor));
    const installment = within(card('Reducir cuota'));
    expect(installment.getByText('Nueva cuota').nextSibling).toHaveTextContent(formatMoney(expected.reduceInstallment.after.installmentMinor));
    expect(expected.reduceTerm.after.remainingPeriods).toBeLessThan(expected.reduceInstallment.after.remainingPeriods);
    expect(card('Adelantar cuotas')).toBeInTheDocument();

    const verdict = screen.getByRole('region', { name: 'Recomendación' });
    expect(within(verdict).getByText('Reducir el plazo')).toBeInTheDocument();
    expect(within(verdict).getByText(/reducir el plazo es lo que más intereses ahorra/)).toBeInTheDocument();
    expect(within(card('Reducir plazo')).getByText('Recomendado')).toBeInTheDocument();
  });

  it('recommends lowering the installment when the monthly margin is tight', async () => {
    await setup({ cashflow: { avgIncomeMinor: 1000000, avgExpenseMinor: 950000 } });
    const verdict = within(screen.getByRole('region', { name: 'Recomendación' }));

    expect(verdict.getByText('Reducir la cuota')).toBeInTheDocument();
    expect(verdict.getByText(/Tu margen mensual promedio es \$ 50\.000/)).toBeInTheDocument();
    expect(within(card('Reducir cuota')).getByText('Recomendado')).toBeInTheDocument();
  });

  it('says so when the monthly margin cannot be measured', async () => {
    await setup();
    expect(screen.getByText(/No hay suficientes movimientos de los últimos 3 meses/)).toBeInTheDocument();
  });

  it('points to a more expensive debt first when there is one', async () => {
    await setup({ otherDebts: [{ id: 'd2', name: 'Tarjeta Visa', eaPercent: 41.2 }], cashflow: { avgIncomeMinor: 5000000, avgExpenseMinor: 1000000 } });
    const verdict = within(screen.getByRole('region', { name: 'Recomendación' }));

    expect(verdict.getByText('Pagar primero la deuda más cara')).toBeInTheDocument();
    expect(verdict.getByText(/Tarjeta Visa/)).toBeInTheDocument();
  });

  it('claims no savings for an interest-free debt', async () => {
    await setup({ debt: makeDebt({}, { rate: { convention: 'ZERO' } }), amount: '300000' });

    expect(within(screen.getByRole('region', { name: 'Recomendación' })).getByText('Conservar liquidez')).toBeInTheDocument();
    expect(screen.getByText(/no cobra intereses/)).toBeInTheDocument();
    expect(screen.queryByText('Intereses ahorrados')).not.toBeInTheDocument();
  });

  it('shows one card, with a note, when reducing the term or the installment gives the same result', async () => {
    await setup({ debt: makeDebt({}, { system: 'german' }), amount: '300000' });

    expect(card('Reducir plazo o cuota')).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Reducir cuota' })).not.toBeInTheDocument();
    expect(screen.getByText(/dan el mismo resultado/)).toBeInTheDocument();
  });

  it('adds the Ley 1555 notice for a mortgage without blocking the simulation', async () => {
    await setup({ debt: makeDebt({ kind: 'mortgage' }, { kind: 'mortgage' }), amount: '300000' });

    expect(screen.getByRole('note')).toHaveTextContent('Ley 1555');
    expect(card('Reducir plazo')).toBeInTheDocument();
  });

  it('converts a strategy into a payment with its amount and strategy', async () => {
    const { user, onRecord } = await setup();

    await user.click(within(card('Reducir cuota')).getByRole('button', { name: 'Registrar como abono' }));

    expect(onRecord).toHaveBeenCalledWith({ amountMinor: 2000000, strategy: 'reduce_installment' });
  });

  it('shows nothing to compare until the amount is valid', async () => {
    const { user } = await setup({ amount: null });
    expect(screen.queryByRole('article')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Monto del abono'), '0');
    expect(screen.getByRole('alert')).toHaveTextContent('Escribe un monto en pesos mayor a 0.');
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });
});
