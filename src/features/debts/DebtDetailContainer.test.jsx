import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../../appwrite';
import DebtDetailContainer from './DebtDetailContainer';
import { makeBigLoan, makeEvent } from './debtFixtures';

vi.mock('../../appwrite', () => ({ debtPort: vi.fn() }));

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

    expect(await screen.findByText('El movimiento se guardó, pero falta registrar su gasto financiero. Pulsa Reintentar para completarlo.')).toBeInTheDocument();
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
    await screen.findByText(/falta registrar su gasto financiero/);

    await user.click(screen.getByRole('button', { name: 'Cerrar' }));

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('gives an edited draft a new nonce instead of reusing the failed attempt', async () => {
    port.createEvent.mockRejectedValueOnce(new Error('sin red'));
    const createNonce = vi.fn().mockReturnValueOnce('n1').mockReturnValueOnce('n2');
    const { user } = setup({ createNonce });
    await openPayment(user);
    await save(user);
    await screen.findByText('sin red');

    await user.clear(screen.getByLabelText('Monto del pago'));
    await user.type(screen.getByLabelText('Monto del pago'), '200000');
    await save(user, 'Reintentar');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(port.createEvent.mock.calls.map(([call]) => [call.id, call.data.amountMinor])).toEqual([['den1', 390381], ['den2', 200000]]);
  });
});
