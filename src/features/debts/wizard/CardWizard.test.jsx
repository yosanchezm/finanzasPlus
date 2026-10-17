import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { formatDueDate } from '../debtLabels';
import DebtWizard from './DebtWizard';

const setup = (today = '2026-10-12') => {
  const onSubmit = vi.fn();
  render(<DebtWizard saveState={{ status: 'idle' }} today={today} onSubmit={onSubmit} onClose={vi.fn()} />);
  return { onSubmit, user: userEvent.setup() };
};
const fillIn = async (user, label, text) => {
  const field = screen.getByLabelText(label);
  await user.clear(field);
  await user.type(field, text);
};
// A date input takes its whole value at once.
const setDate = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const next = (user) => user.click(screen.getByRole('button', { name: 'Siguiente' }));
const toCardStep = async (user, balance = '500000') => {
  await user.click(screen.getByRole('button', { name: /^Tarjeta de crédito/ }));
  await fillIn(user, 'Nombre de la deuda', 'Visa');
  await fillIn(user, 'Saldo del último extracto (opcional)', balance);
  await next(user);
  await fillIn(user, 'Valor de la tasa', '28');
  await next(user);
};

describe('DebtWizard card step', () => {
  it('collects days, minimum rule, fee with IVA and an installment purchase, and previews them before saving', async () => {
    const { user, onSubmit } = setup();
    await toCardStep(user);

    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
    await fillIn(user, 'Día de corte', '15');
    await fillIn(user, 'Día límite de pago', '30');
    await fillIn(user, 'Cuota de manejo mensual (opcional)', '9000');
    expect(screen.getByRole('checkbox', { name: 'Sumar IVA a la cuota de manejo' })).toBeChecked();
    expect(screen.getByLabelText('IVA (%)')).toHaveValue(19);
    await user.click(screen.getByRole('button', { name: 'Agregar compra a cuotas' }));
    await fillIn(user, 'Descripción de la compra 1', 'Nevera');
    await fillIn(user, 'Valor de la compra 1', '1200000');
    await fillIn(user, 'Cuotas de la compra 1', '12');
    await next(user);

    const review = screen.getByRole('region', { name: 'Vista previa' });
    expect(within(review).getByText('Corte el día 15, pago el día 30')).toBeInTheDocument();
    expect(within(review).getByText('$ 9.000 + IVA 19 %')).toBeInTheDocument();
    expect(within(review).getByText('1 compra a cuotas')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Guardar deuda' }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Visa',
      terms: expect.objectContaining({
        kind: 'card',
        principalMinor: 500000,
        card: expect.objectContaining({ statementDay: 15, dueDay: 30, deferred: [expect.objectContaining({ label: 'Nevera', n: 12, principalMinor: 1200000 })] }),
      }),
    }));
  });

  it('blocks the step with a message for an impossible day, and the IVA link can be removed', async () => {
    const { user, onSubmit } = setup();
    await toCardStep(user);
    await fillIn(user, 'Día de corte', '40');
    await fillIn(user, 'Día límite de pago', '30');

    expect(screen.getByRole('alert')).toHaveTextContent('días de corte y de pago');
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
    await fillIn(user, 'Día de corte', '15');
    await fillIn(user, 'Cuota de manejo mensual (opcional)', '9000');
    await user.click(screen.getByRole('checkbox', { name: 'Sumar IVA a la cuota de manejo' }));
    expect(screen.queryByLabelText('IVA (%)')).not.toBeInTheDocument();
    await next(user);
    await user.click(screen.getByRole('button', { name: 'Guardar deuda' }));

    expect(onSubmit.mock.calls[0][0].terms.charges.map((charge) => charge.id)).toEqual(['mgmt_fee']);
  });
});

describe('DebtWizard card last statement', () => {
  it('asks for the balance of the last statement and no registration date in the basics', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: /^Tarjeta de crédito/ }));

    expect(screen.getByLabelText('Saldo del último extracto (opcional)')).toBeInTheDocument();
    expect(screen.queryByLabelText('Fecha desde la que la registras')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Fecha del desembolso')).not.toBeInTheDocument();
  });

  it('defaults the last statement date from the statement day, takes the stated minimum and previews the next payment', async () => {
    const { user, onSubmit } = setup('2026-10-16');
    await toCardStep(user, '3268319');
    await fillIn(user, 'Día de corte', '15');
    await fillIn(user, 'Día límite de pago', '3');

    expect(screen.getByLabelText('Fecha del último corte')).toHaveValue('2026-10-15');
    await fillIn(user, 'Pago mínimo del extracto (opcional)', '180000');
    await next(user);

    const review = screen.getByRole('region', { name: 'Vista previa' });
    expect(within(review).getByText('Saldo del último extracto')).toBeInTheDocument();
    expect(within(review).getByText(formatDueDate('2026-10-15'))).toBeInTheDocument();
    expect(within(review).getByText(`$ 180.000 · ${formatDueDate('2026-11-03')}`)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Guardar deuda' }));

    expect(onSubmit.mock.calls[0][0].terms).toMatchObject({ openedOn: '2026-10-15', principalMinor: 3268319, card: { statementDay: 15, dueDay: 3, openingMinimumMinor: 180000 } });
  });

  it('lets the user pick an earlier statement and blocks a date that is not a statement day', async () => {
    const { user, onSubmit } = setup('2026-10-16');
    await toCardStep(user);
    await fillIn(user, 'Día de corte', '15');
    await fillIn(user, 'Día límite de pago', '3');
    setDate('Fecha del último corte', '2026-10-14');

    expect(screen.getByRole('alert')).toHaveTextContent('día de corte');
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
    setDate('Fecha del último corte', '2026-09-15');
    await next(user);
    await user.click(screen.getByRole('button', { name: 'Guardar deuda' }));

    expect(onSubmit.mock.calls[0][0].terms.openedOn).toBe('2026-09-15');
  });
});

describe('DebtWizard card mora', () => {
  it('tells the user the card charges mora at the usury cap by default and where to change it', async () => {
    const { user } = setup();
    await toCardStep(user);

    expect(screen.getByText('Si no pagas el mínimo a tiempo, cobramos mora al tope de usura. Puedes cambiarla después en «Más acciones».')).toBeInTheDocument();
  });

  it('saves the card with the usury mora in its terms', async () => {
    const { user, onSubmit } = setup();
    await toCardStep(user);
    await fillIn(user, 'Día de corte', '15');
    await fillIn(user, 'Día límite de pago', '30');
    await next(user);
    await user.click(screen.getByRole('button', { name: 'Guardar deuda' }));

    expect(onSubmit.mock.calls[0][0].terms.late).toEqual({ mode: 'usury', graceDays: 0 });
  });
});
