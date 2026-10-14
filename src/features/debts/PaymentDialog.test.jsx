import { project } from '@finance-core';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import PaymentDialog from './PaymentDialog';
import { formatMoney } from '../../shared/lib/format';
import { DAY_10, MORA_DISBURSEMENT, makeBigLoan, makeMoraLoan } from './debtFixtures';

const TODAY = '2026-02-05';
const IDLE = { status: 'idle', error: null };

const setup = (props = {}) => {
  const debt = makeBigLoan();
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  render(<PaymentDialog debt={debt} events={[]} projection={project(debt, [], TODAY)} actorId="u1" today={TODAY} saveState={IDLE} onSubmit={onSubmit} onClose={onClose} {...props} />);
  return { onSubmit, onClose, user: userEvent.setup() };
};
const amountField = () => screen.getByLabelText('Monto del pago');
const typeAmount = async (user, text) => { await user.clear(amountField()); await user.type(amountField(), text); };

describe('PaymentDialog', () => {
  it('proposes the installment and previews its split before anything is saved', async () => {
    const { user, onSubmit } = setup();

    expect(amountField()).toHaveValue(390381);
    const preview = screen.getByRole('group', { name: 'Vista previa' });
    expect(within(preview).getByText('Capital').nextSibling).toHaveTextContent('$ 199.505');
    expect(within(preview).getByText('Intereses').nextSibling).toHaveTextContent('$ 180.876');
    expect(within(preview).getByText('Cargos e impuestos').nextSibling).toHaveTextContent('$ 10.000');
    expect(within(preview).getByText('Gasto en Costos financieros').nextSibling).toHaveTextContent('$ 190.876');
    expect(within(preview).getByText('Saldo después del pago').nextSibling).toHaveTextContent('$ 9.800.495');

    await user.click(screen.getByRole('button', { name: 'Registrar pago' }));
    expect(onSubmit).toHaveBeenCalledWith({ kind: 'payment', effectiveOn: TODAY, amountMinor: 390381 });
  });

  it('asks for a strategy when the amount exceeds the installment, then previews and submits it', async () => {
    const { user, onSubmit } = setup();
    await typeAmount(user, '2000000');

    expect(screen.getByRole('group', { name: '¿Cómo aplicar el abono extra?' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Vista previa' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Registrar abono' })).toBeDisabled();
    expect(screen.getByText('Elige cómo aplicar el abono extra.')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /Reducir plazo/ }));
    expect(within(screen.getByRole('group', { name: 'Vista previa' })).getByText('Capital').nextSibling).toHaveTextContent('$ 1.809.124');
    await user.click(screen.getByRole('button', { name: 'Registrar abono' }));

    expect(onSubmit).toHaveBeenCalledWith({ kind: 'extra_payment', effectiveOn: TODAY, amountMinor: 2000000, strategy: 'reduce_term' });
  });

  it('opens prefilled when it comes from the simulator', () => {
    setup({ initial: { amountMinor: 2000000, strategy: 'reduce_installment' } });

    expect(amountField()).toHaveValue(2000000);
    expect(screen.getByRole('radio', { name: /Reducir cuota/ })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Registrar abono' })).toBeEnabled();
  });

  it('blocks an invalid amount with a message', async () => {
    const { user } = setup();
    await typeAmount(user, '0');

    expect(screen.getByRole('alert')).toHaveTextContent('Escribe un monto en pesos mayor a 0.');
    expect(screen.getByRole('button', { name: 'Registrar pago' })).toBeDisabled();
  });

  it('shows saving, then the error with Reintentar; a partial save locks the inputs', () => {
    const { unmount } = render(<PaymentDialog debt={makeBigLoan()} events={[]} projection={project(makeBigLoan(), [], TODAY)} actorId="u1" today={TODAY} saveState={{ status: 'saving', error: null }} onSubmit={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Guardando…' })).toBeDisabled();
    unmount();

    const failed = { status: 'error', error: 'Servidor no disponible', locked: false };
    const { unmount: again } = render(<PaymentDialog debt={makeBigLoan()} events={[]} projection={project(makeBigLoan(), [], TODAY)} actorId="u1" today={TODAY} saveState={failed} onSubmit={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('Servidor no disponible')).toBeInTheDocument();
    expect(amountField()).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeEnabled();
    again();

    render(<PaymentDialog debt={makeBigLoan()} events={[]} projection={project(makeBigLoan(), [], TODAY)} actorId="u1" today={TODAY} saveState={{ ...failed, locked: true }} onSubmit={vi.fn()} onClose={vi.fn()} />);
    expect(amountField()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeEnabled();
  });
});

describe('PaymentDialog with mora', () => {
  const setupLate = (late) => {
    const debt = makeMoraLoan({ late });
    const events = [MORA_DISBURSEMENT];
    const onSubmit = vi.fn();
    render(<PaymentDialog debt={debt} events={events} projection={project(debt, events, DAY_10)} actorId="u1" today={DAY_10} saveState={IDLE} onSubmit={onSubmit} onClose={vi.fn()} />);
    return { onSubmit, user: userEvent.setup() };
  };
  const line = (label) => within(screen.getByRole('group', { name: 'Vista previa' })).getByText(label).nextSibling;

  it('previews the installment paid 10 days late with the mora on its own line: charges 10,000, mora 1,375, interest 180,876, principal 198,130, cost 192,251', async () => {
    const { user, onSubmit } = setupLate({ mode: 'usury', graceDays: 0 });
    await typeAmount(user, '390381');

    expect(line('Capital')).toHaveTextContent(formatMoney(198130));
    expect(line('Intereses')).toHaveTextContent(formatMoney(180876));
    expect(line('Intereses de mora')).toHaveTextContent(formatMoney(1375));
    expect(line('Cargos e impuestos')).toHaveTextContent(formatMoney(10000));
    expect(line('Gasto en Costos financieros')).toHaveTextContent(formatMoney(192251));
    await user.click(screen.getByRole('button', { name: 'Registrar pago' }));
    expect(onSubmit).toHaveBeenCalledWith({ kind: 'payment', effectiveOn: DAY_10, amountMinor: 390381 });
  });

  it('shows no mora line when the debt has no policy', async () => {
    const { user } = setupLate(null);
    await typeAmount(user, '390381');

    expect(line('Capital')).toHaveTextContent(formatMoney(199505));
    expect(within(screen.getByRole('group', { name: 'Vista previa' })).queryByText('Intereses de mora')).not.toBeInTheDocument();
  });
});
