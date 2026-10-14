import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import VoidDialog from './VoidDialog';

const IDLE = { status: 'idle', error: null, locked: false };
const entry = (overrides) => ({
  id: 'e1', kind: 'payment', effectiveOn: '2026-02-05', amountMinor: 93453, costMinor: 18088, summary: null, guardedVoid: false, voidBlocked: null, ...overrides,
});
const setup = (overrides = {}, saveState = IDLE) => {
  const props = { entry: entry(overrides), saveState, onConfirm: vi.fn(), onClose: vi.fn() };
  render(<VoidDialog {...props} />);
  return { ...props, user: userEvent.setup() };
};

describe('VoidDialog: payments and plan changes', () => {
  it('asks to void a payment with its amount and cost, and confirms with the default reason', async () => {
    const { user, onConfirm } = setup();
    const dialog = screen.getByRole('alertdialog');

    expect(within(dialog).getByText('¿Anular este pago?')).toBeInTheDocument();
    expect(dialog).toHaveTextContent('Se anula el pago de $ 93.453 del 5 feb');
    expect(dialog).toHaveTextContent('se elimina su gasto de $ 18.088 en Costos financieros');
    await user.click(within(dialog).getByRole('button', { name: 'Anular pago' }));
    expect(onConfirm).toHaveBeenCalledWith('Anulado desde la web');
  });

  it('describes a rate change by its summary, not by an amount of $ 0, and passes the typed reason', async () => {
    const { user, onConfirm } = setup({
      kind: 'rate_change', effectiveOn: '2026-11-01', amountMinor: 0, costMinor: 0,
      summary: 'Tasa: 24,00 % → 20,00 % E.A. desde 1 nov · mantiene plazo',
    });
    const dialog = screen.getByRole('alertdialog');

    expect(within(dialog).getByText('¿Anular este cambio de tasa?')).toBeInTheDocument();
    expect(dialog).toHaveTextContent('Tasa: 24,00 % → 20,00 % E.A. desde 1 nov · mantiene plazo');
    expect(dialog).toHaveTextContent('El saldo y el plan vuelven a como estaban antes');
    expect(dialog).not.toHaveTextContent('$ 0');
    await user.type(within(dialog).getByLabelText('Motivo (opcional)'), 'Tasa mal digitada');
    await user.click(within(dialog).getByRole('button', { name: 'Anular cambio de tasa' }));
    expect(onConfirm).toHaveBeenCalledWith('Tasa mal digitada');
  });

  it('names the other plan changes in its title and button', () => {
    for (const [kind, title, button] of [
      ['charge_change', '¿Anular este cambio de cargos?', 'Anular cambio de cargos'],
      ['late_policy', '¿Anular esta política de mora?', 'Anular política de mora'],
    ]) {
      const { unmount } = render(<VoidDialog entry={entry({ kind, amountMinor: 0, costMinor: 0, summary: 'Resumen' })} saveState={IDLE} onConfirm={vi.fn()} onClose={vi.fn()} />);
      expect(screen.getByText(title)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: button })).toBeInTheDocument();
      unmount();
    }
  });

  it('shows a failed save with a retry and disables the actions while saving', () => {
    const { unmount } = render(<VoidDialog entry={entry()} saveState={{ status: 'error', error: 'Servidor no disponible', locked: false }} onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Servidor no disponible');
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeEnabled();
    unmount();
    render(<VoidDialog entry={entry()} saveState={{ status: 'saving', error: null, locked: false }} onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Anulando…' })).toBeDisabled();
  });
});

describe('VoidDialog: guarded restructure', () => {
  const restructure = { kind: 'restructure', effectiveOn: '2026-03-01', amountMinor: 0, costMinor: 0, summary: 'Reestructuración: $ 9.812.000 a 36 cuotas', guardedVoid: true };

  it('needs an explicit confirmation before it can be voided', async () => {
    const { user, onConfirm } = setup(restructure);
    const dialog = screen.getByRole('alertdialog');
    const confirm = within(dialog).getByRole('button', { name: 'Anular reestructuración' });

    expect(within(dialog).getByText('¿Anular esta reestructuración?')).toBeInTheDocument();
    expect(dialog).toHaveTextContent('Reestructuración: $ 9.812.000 a 36 cuotas');
    expect(confirm).toBeDisabled();
    await user.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('checkbox', { name: /Entiendo que la deuda vuelve a las condiciones anteriores a la reestructuración/ }));
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('Anulado desde la web');
  });

  it('names the blocking events and offers no way to void when something follows the restructure', async () => {
    const { user, onConfirm, onClose } = setup({
      ...restructure,
      voidBlocked: {
        code: 'later_events',
        events: [
          { id: 'p1', kind: 'payment', effectiveOn: '2026-11-05' },
          { id: 'r1', kind: 'rate_change', effectiveOn: '2026-12-01' },
        ],
      },
    });
    const dialog = screen.getByRole('alertdialog');

    expect(within(dialog).getByRole('alert')).toHaveTextContent('No se puede anular: la bloquean el pago del 5 nov y el cambio de tasa del 1 dic.');
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Anular/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Motivo (opcional)')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Entendido' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
