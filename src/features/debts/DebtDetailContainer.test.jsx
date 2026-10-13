import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../../appwrite';
import DebtDetailContainer from './DebtDetailContainer';
import { makeBigLoan, makeEvent, makePayment } from './debtFixtures';

vi.mock('../../appwrite', () => ({ debtPort: vi.fn(), getTransactionsInRange: vi.fn(), findDebtEventByDedupe: vi.fn() }));

const port = { ensureCostCategory: vi.fn(), createEvent: vi.fn(), findEventByDedupe: vi.fn(), createCostRow: vi.fn(), deleteCostRow: vi.fn() };
const TODAY = '2026-02-05';
const EVENTS = [makeEvent('e0', 'disbursement', '2026-01-05', 10000000)];

const setup = (overrides = {}) => {
  const calls = [];
  const props = {
    debt: makeBigLoan(), events: EVENTS, today: TODAY, currentOwnerScope: 'you', user: { $id: 'u1' },
    reconcileCosts: vi.fn().mockResolvedValue({ created: 0, updated: 0, removed: 0 }),
    reload: vi.fn(async () => { calls.push('reload'); }),
    onRefresh: vi.fn(() => { calls.push('refresh'); }),
    onNotify: vi.fn(), onBack: vi.fn(), createNonce: vi.fn().mockReturnValue('n1'), ...overrides,
  };
  render(<DebtDetailContainer {...props} />);
  return { ...props, calls, user: userEvent.setup() };
};
const openPayment = (user) => user.click(screen.getByRole('button', { name: 'Registrar pago' }));
const save = (user, name = 'Registrar pago') => user.click(within(screen.getByRole('dialog')).getByRole('button', { name }));

beforeEach(() => {
  vi.clearAllMocks();
  api.debtPort.mockReturnValue(port);
  api.getTransactionsInRange.mockResolvedValue([]);
  api.findDebtEventByDedupe.mockResolvedValue(null);
  port.ensureCostCategory.mockResolvedValue('cat1');
  port.createEvent.mockImplementation(async ({ id, data }) => ({ $id: id, ...data }));
  port.createCostRow.mockImplementation(async ({ id, data }) => ({ $id: id, ...data }));
});

describe('DebtDetailContainer payment flow', () => {
  it('saves the event and the expense equal to the preview, and reloads only after the writes resolved', async () => {
    const { user, calls, reload, onRefresh, onNotify } = setup();
    port.createCostRow.mockImplementation(async ({ id, data }) => { calls.push('cost row'); return { $id: id, ...data }; });
    await openPayment(user);
    expect(within(screen.getByRole('group', { name: 'Vista previa' })).getByText('Gasto en Costos financieros').nextSibling).toHaveTextContent('$ 190.876');
    await save(user);

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(port.createEvent).toHaveBeenCalledWith({
      id: 'den1',
      data: expect.objectContaining({ debtId: 'd1', kind: 'payment', amountMinor: 390381, effectiveOn: TODAY, dedupeKey: 'web:n1', source: 'web', actorId: 'u1' }),
    });
    expect(port.createCostRow).toHaveBeenCalledWith({ id: 'dcden1', data: expect.objectContaining({ amountMinor: 190876, categoryId: 'cat1', debtId: 'd1', ownerScope: 'you' }) });
    expect(calls).toEqual(['cost row', 'reload', 'refresh']);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onNotify).toHaveBeenCalledWith('Pago registrado.');
  });

  it('creates one event when the save button is tapped twice', async () => {
    const { user } = setup();
    await openPayment(user);
    await user.dblClick(within(screen.getByRole('dialog')).getByRole('button', { name: 'Registrar pago' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(port.createEvent).toHaveBeenCalledTimes(1);
    expect(port.createCostRow).toHaveBeenCalledTimes(1);
  });

  it('keeps the dialog and the confirmed figures when the write fails, and the retry reuses the same nonce', async () => {
    port.createEvent.mockRejectedValueOnce(Object.assign(new Error('Servidor no disponible'), { code: 500 }));
    const { user, createNonce, reload, onRefresh, onNotify } = setup();
    await openPayment(user);
    await save(user);

    expect(await screen.findByText('Servidor no disponible')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onNotify).toHaveBeenCalledWith('Servidor no disponible');
    expect(reload).not.toHaveBeenCalled();
    expect(onRefresh).not.toHaveBeenCalled();
    expect(screen.getAllByText('$ 10.000.000').length).toBeGreaterThan(0); // the balance did not move

    await save(user, 'Reintentar');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(createNonce).toHaveBeenCalledTimes(1);
    expect(port.createEvent.mock.calls.map(([call]) => [call.id, call.data.dedupeKey])).toEqual([['den1', 'web:n1'], ['den1', 'web:n1']]);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('freezes the form after a half-saved payment and completes it with the same event on retry', async () => {
    port.createCostRow.mockRejectedValueOnce(new Error('sin red'));
    const { user, reload } = setup();
    await openPayment(user);
    await save(user);

    expect(await screen.findByText('El movimiento se guardó, pero falta actualizar su gasto financiero. Pulsa Reintentar para completarlo.')).toBeInTheDocument();
    expect(screen.getByLabelText('Monto del pago')).toBeDisabled();
    expect(reload).not.toHaveBeenCalled();

    port.createEvent.mockRejectedValueOnce(Object.assign(new Error('exists'), { code: 409 }));
    port.findEventByDedupe.mockResolvedValueOnce({ $id: 'den1', debtId: 'd1', kind: 'payment' });
    await save(user, 'Reintentar');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(port.findEventByDedupe).toHaveBeenCalledWith('web:n1');
    expect(port.createCostRow.mock.calls.map(([call]) => call.id)).toEqual(['dcden1', 'dcden1']);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads when a half-saved payment dialog is closed, so the saved event shows up', async () => {
    port.createCostRow.mockRejectedValueOnce(new Error('sin red'));
    const { user, reload } = setup();
    await openPayment(user);
    await save(user);
    await screen.findByText(/falta actualizar su gasto financiero/);

    await user.click(screen.getByRole('button', { name: 'Cerrar' }));

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  const failThenEdit = async (options = {}) => {
    port.createEvent.mockRejectedValueOnce(new Error('sin red'));
    const ctx = setup(options);
    await openPayment(ctx.user);
    await save(ctx.user);
    await screen.findByText('sin red');
    await ctx.user.clear(screen.getByLabelText('Monto del pago'));
    await ctx.user.type(screen.getByLabelText('Monto del pago'), '200000');
    return ctx;
  };

  it('gives an edited draft a new nonce once it is known that the failed attempt saved nothing', async () => {
    const createNonce = vi.fn().mockReturnValueOnce('n1').mockReturnValueOnce('n2');
    const { user } = await failThenEdit({ createNonce });
    await save(user, 'Reintentar');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.findDebtEventByDedupe).toHaveBeenCalledWith('web:n1');
    expect(port.createEvent.mock.calls.map(([call]) => [call.id, call.data.amountMinor])).toEqual([['den1', 390381], ['den2', 200000]]);
  });

  it('does not write the edited draft when the failed attempt turns out to have been saved', async () => {
    api.findDebtEventByDedupe.mockResolvedValue({ $id: 'den1', debtId: 'd1', kind: 'payment' });
    const { user, reload, onRefresh, onNotify } = await failThenEdit();
    await save(user, 'Reintentar');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(port.createEvent).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onNotify).toHaveBeenLastCalledWith('El intento anterior ya se había registrado, así que no se guardó de nuevo. Revisa el historial y registra otro pago si hace falta.');
  });

  it('keeps the same nonce and writes nothing when it cannot tell whether the failed attempt saved', async () => {
    api.findDebtEventByDedupe.mockRejectedValueOnce(new Error('timeout'));
    const createNonce = vi.fn().mockReturnValueOnce('n1').mockReturnValueOnce('n2');
    const { user } = await failThenEdit({ createNonce });
    await save(user, 'Reintentar');

    expect(await screen.findByText('No pudimos confirmar si el intento anterior se guardó. Vuelve a intentarlo.')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(port.createEvent).toHaveBeenCalledTimes(1);
    expect(createNonce).toHaveBeenCalledTimes(1);

    await save(user, 'Reintentar'); // the check works this time and finds nothing
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(port.createEvent.mock.calls.map(([call]) => call.id)).toEqual(['den1', 'den2']);
  });
});

describe('DebtDetailContainer void flow', () => {
  const PAID = [...EVENTS, makePayment('e1', TODAY, 390381)];
  const openVoid = async (user) => {
    await user.click(screen.getByRole('button', { name: 'Anular pago del 5 feb' }));
    return screen.getByRole('alertdialog');
  };

  it('asks for confirmation, then appends the void event and deletes the cost row', async () => {
    const { user, reload, onRefresh, onNotify } = setup({ events: PAID });
    const dialog = await openVoid(user);
    expect(within(dialog).getByText('¿Anular este pago?')).toBeInTheDocument();
    expect(port.createEvent).not.toHaveBeenCalled(); // nothing is written before confirming
    await user.type(within(dialog).getByLabelText('Motivo (opcional)'), 'Registrado dos veces');
    await user.click(within(dialog).getByRole('button', { name: 'Anular pago' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    const { id, data } = port.createEvent.mock.calls[0][0];
    expect(id).toBe('dvn1');
    expect(data).toMatchObject({ kind: 'void', dedupeKey: 'void:e1', amountMinor: 0, debtId: 'd1' });
    expect(JSON.parse(data.payloadJson)).toEqual({ targetEventId: 'e1', reason: 'Registrado dos veces' });
    expect(port.deleteCostRow).toHaveBeenCalledWith('dce1');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onNotify).toHaveBeenCalledWith('Pago anulado.');
  });

  it('leaves everything unchanged when the void fails, and the retry repeats the same ids', async () => {
    port.createEvent.mockRejectedValueOnce(Object.assign(new Error('Servidor no disponible'), { code: 500 }));
    const { user, reload } = setup({ events: PAID });
    const dialog = await openVoid(user);
    await user.click(within(dialog).getByRole('button', { name: 'Anular pago' }));

    expect(await within(screen.getByRole('alertdialog')).findByText('Servidor no disponible')).toBeInTheDocument();
    expect(port.deleteCostRow).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();

    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(port.createEvent.mock.calls.map(([call]) => call.id)).toEqual(['dvn1', 'dvn1']);
    expect(port.deleteCostRow).toHaveBeenCalledTimes(1);
  });

  it('offers no void action for a payment that is already voided', () => {
    const voided = [...PAID, makeEvent('v1', 'void', TODAY, 0, { targetEventId: 'e1', reason: 'x' })];
    setup({ events: voided });

    expect(screen.queryByRole('button', { name: /Anular/ })).not.toBeInTheDocument();
    expect(screen.getByText('Anulado')).toBeInTheDocument();
  });
});

describe('DebtDetailContainer simulator', () => {
  const simulate = async (user, amount = '2000000') => {
    await user.click(screen.getByRole('button', { name: 'Simular abono' }));
    await user.type(within(screen.getByRole('dialog')).getByLabelText('Monto del abono'), amount);
  };

  it('simulates without writing and hands the amount and strategy to the payment form', async () => {
    const { user } = setup();
    await simulate(user);
    expect(await screen.findByRole('region', { name: 'Recomendación' })).toBeInTheDocument();
    expect(api.getTransactionsInRange).toHaveBeenCalledTimes(1);
    expect(port.createEvent).not.toHaveBeenCalled();

    await user.click(within(screen.getByRole('article', { name: 'Reducir plazo' })).getByRole('button', { name: 'Registrar como abono' }));

    expect(screen.queryByLabelText('Monto del abono')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Monto del pago')).toHaveValue(2000000);
    expect(screen.getByRole('radio', { name: /Reducir plazo/ })).toBeChecked();
    await save(user, 'Registrar abono');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const { data } = port.createEvent.mock.calls[0][0];
    expect(data).toMatchObject({ kind: 'extra_payment', amountMinor: 2000000 });
    expect(JSON.parse(data.payloadJson)).toEqual({ strategy: 'reduce_term' });
  });

  it('uses the last three months of income and expenses once they load', async () => {
    api.getTransactionsInRange.mockResolvedValue([
      { type: 'income', amountMinor: 3000000, occurredAt: '2026-01-10T12:00:00', ownerScope: 'you' },
      { type: 'expense', amountMinor: 2850000, occurredAt: '2026-01-12T12:00:00', ownerScope: 'you' },
    ]);
    const { user } = setup({ today: '2026-02-05' });
    await simulate(user);

    expect(await screen.findByText(/Tu margen mensual promedio es \$ 50\.000/)).toBeInTheDocument();
  });
});
