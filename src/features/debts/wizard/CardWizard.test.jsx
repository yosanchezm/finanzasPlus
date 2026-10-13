import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import DebtWizard from './DebtWizard';

const setup = () => {
  const onSubmit = vi.fn();
  render(<DebtWizard saveState={{ status: 'idle' }} today="2026-10-12" onSubmit={onSubmit} onClose={vi.fn()} />);
  return { onSubmit, user: userEvent.setup() };
};
const fillIn = async (user, label, text) => {
  const field = screen.getByLabelText(label);
  await user.clear(field);
  await user.type(field, text);
};
const next = (user) => user.click(screen.getByRole('button', { name: 'Siguiente' }));
const toCardStep = async (user) => {
  await user.click(screen.getByRole('button', { name: /^Tarjeta de crédito/ }));
  await fillIn(user, 'Nombre de la deuda', 'Visa');
  await fillIn(user, 'Saldo actual de la tarjeta (opcional)', '500000');
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
