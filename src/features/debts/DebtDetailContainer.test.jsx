import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../../appwrite';
import DebtDetailContainer from './DebtDetailContainer';
import { makeBigLoan, makeDebt, makeEvent, makePayment } from './debtFixtures';

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

  it('voids a rate change after confirming, shows its summary instead of $ 0 and reports it by kind', async () => {
    const rate = { value: 20, basis: 'effective', periodicity: 'annual', timing: 'arrears' };
    const events = [...EVENTS, makeEvent('rc1', 'rate_change', '2026-02-01', 0, { rate, mode: 'keep_term' })];
    const { user, onNotify } = setup({ events });
    expect(screen.getByText('Tasa: 24,00 % → 20,00 % E.A. desde 1 feb · mantiene plazo')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Anular cambio de tasa del 1 feb' }));
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText('¿Anular este cambio de tasa?')).toBeInTheDocument();
    expect(port.createEvent).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Anular cambio de tasa' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    const { data } = port.createEvent.mock.calls[0][0];
    expect(data).toMatchObject({ kind: 'void', dedupeKey: 'void:rc1', amountMinor: 0 });
    expect(JSON.parse(data.payloadJson)).toEqual({ targetEventId: 'rc1', reason: 'Anulado desde la web' });
    expect(onNotify).toHaveBeenCalledWith('Cambio de tasa anulado.');
  });

  const NONE = { created: 0, updated: 0, removed: 0 };
  const RATE_CHANGE = makeEvent('rc1', 'rate_change', '2026-01-20', 0, { rate: { value: 30, basis: 'effective', periodicity: 'annual', timing: 'arrears' }, mode: 'keep_term' });

  it('reconciles the cost rows on fresh events after voiding a plan change, and reports how many rows moved', async () => {
    const calls = [];
    const reconcileCosts = vi.fn(async (...args) => { calls.push(args.length > 1 ? 'reconcile' : 'open'); return args.length > 1 ? { ...NONE, updated: 2 } : NONE; });
    const { user, onNotify } = setup({ events: [...PAID, RATE_CHANGE], reconcileCosts });
    await user.click(screen.getByRole('button', { name: 'Anular cambio de tasa del 20 ene' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Anular cambio de tasa' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(reconcileCosts).toHaveBeenLastCalledWith('d1', { fresh: true });
    expect(calls).toEqual(['open', 'reconcile']);
    expect(onNotify).toHaveBeenCalledWith('Cambio de tasa anulado. Se actualizaron 2 filas de Costos financieros.');
  });

  it('keeps the void when the reconcile after it fails, and says the costs were not refreshed', async () => {
    const reconcileCosts = vi.fn().mockResolvedValueOnce(NONE).mockRejectedValueOnce(new Error('sin red'));
    const { user, onNotify } = setup({ events: [...PAID, RATE_CHANGE], reconcileCosts });
    await user.click(screen.getByRole('button', { name: 'Anular cambio de tasa del 20 ene' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Anular cambio de tasa' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(port.createEvent).toHaveBeenCalledTimes(1);
    expect(onNotify).toHaveBeenCalledWith('Cambio de tasa anulado. No pudimos actualizar los costos financieros: se corregirán al abrir la deuda de nuevo.');
  });

  it('does not reconcile again after voiding a payment, whose cost row the void already deletes', async () => {
    const reconcileCosts = vi.fn().mockResolvedValue(NONE);
    const { user } = setup({ events: PAID, reconcileCosts });
    await openVoid(user);
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Anular pago' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(reconcileCosts).toHaveBeenCalledTimes(1); // only the repair on open
  });

  it('refuses to void a restructure that a payment follows, names the payment and writes nothing', async () => {
    const terms = { kind: 'consumer', principalMinor: 9000000, openedOn: '2026-02-01', system: 'french', periodicity: 'monthly', n: 24, firstDueOn: '2026-03-05', rate: { value: 24, basis: 'effective', periodicity: 'annual', timing: 'arrears' } };
    const events = [...EVENTS, makeEvent('rs1', 'restructure', '2026-02-01', 0, { terms }), makePayment('p1', TODAY, 390381)];
    const { user } = setup({ events });

    await user.click(screen.getByRole('button', { name: 'Anular reestructuración del 1 feb' }));
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByRole('alert')).toHaveTextContent('No se puede anular: la bloquean el pago del 5 feb.');
    expect(within(dialog).queryByRole('button', { name: /^Anular/ })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Entendido' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(port.createEvent).not.toHaveBeenCalled();
  });

  it('voids a restructure that nothing follows once the confirmation is checked', async () => {
    const terms = { kind: 'consumer', principalMinor: 9000000, openedOn: '2026-02-01', system: 'french', periodicity: 'monthly', n: 24, firstDueOn: '2026-03-05', rate: { value: 24, basis: 'effective', periodicity: 'annual', timing: 'arrears' } };
    const events = [...EVENTS, makeEvent('rs1', 'restructure', '2026-02-01', 0, { terms })];
    const { user, onNotify } = setup({ events });

    await user.click(screen.getByRole('button', { name: 'Anular reestructuración del 1 feb' }));
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByRole('button', { name: 'Anular reestructuración' })).toBeDisabled();
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: 'Anular reestructuración' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(port.createEvent.mock.calls[0][0].data).toMatchObject({ kind: 'void', dedupeKey: 'void:rs1' });
    expect(onNotify).toHaveBeenCalledWith('Reestructuración anulada.');
  });

  it('offers no void action for a payment that is already voided', () => {
    const voided = [...PAID, makeEvent('v1', 'void', TODAY, 0, { targetEventId: 'e1', reason: 'x' })];
    setup({ events: voided });

    expect(screen.queryByRole('button', { name: /Anular/ })).not.toBeInTheDocument();
    expect(screen.getByText('Anulado')).toBeInTheDocument();
  });
});

describe('DebtDetailContainer rate change flow', () => {
  const NONE = { created: 0, updated: 0, removed: 0 };
  const openRateChange = async (user) => {
    await user.click(screen.getByRole('button', { name: 'Más acciones' }));
    await user.click(screen.getByRole('menuitem', { name: 'Cambiar tasa' }));
    return screen.getByRole('dialog');
  };
  const typeRate = async (user, text) => {
    const field = screen.getByLabelText('Valor de la tasa');
    await user.clear(field);
    await user.type(field, text);
  };
  const saveRate = (user, name = 'Guardar cambio') => user.click(within(screen.getByRole('dialog')).getByRole('button', { name }));

  it('offers the rate change from Más acciones, previews it and writes one rate_change event, no cost row', async () => {
    const { user } = setup();
    await openRateChange(user);
    await typeRate(user, '20');
    expect(within(screen.getByRole('group', { name: 'Vista previa' })).getByRole('row', { name: /Próxima cuota/ })).toHaveTextContent('$ 380.381$ 363.790');
    expect(port.createEvent).not.toHaveBeenCalled(); // nothing is written before saving
    await saveRate(user);

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(port.createEvent).toHaveBeenCalledTimes(1);
    const { id, data } = port.createEvent.mock.calls[0][0];
    expect(id).toBe('den1');
    expect(data).toMatchObject({ debtId: 'd1', kind: 'rate_change', effectiveOn: TODAY, amountMinor: 0, dedupeKey: 'web:n1', source: 'web', actorId: 'u1' });
    expect(JSON.parse(data.payloadJson)).toEqual({ rate: { value: 20, basis: 'effective', periodicity: 'annual', timing: 'arrears' }, mode: 'keep_term' });
    expect(port.createCostRow).not.toHaveBeenCalled();
  });

  it('reloads, then reconciles the cost rows on fresh events, then refreshes, and reports the rows it changed', async () => {
    const calls = [];
    const reconcileCosts = vi.fn(async (...args) => { calls.push(args.length > 1 ? 'reconcile' : 'open'); return args.length > 1 ? { ...NONE, updated: 2 } : NONE; });
    const { user, onNotify } = setup({ reconcileCosts });
    await openRateChange(user);
    await typeRate(user, '20');
    await saveRate(user);

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(reconcileCosts).toHaveBeenLastCalledWith('d1', { fresh: true });
    expect(calls).toEqual(['open', 'reconcile']);
    expect(onNotify).toHaveBeenCalledWith('Cambio de tasa registrado. Se actualizaron 2 filas de Costos financieros.');
  });

  it('creates one rate_change when the save button is tapped twice', async () => {
    const { user } = setup();
    await openRateChange(user);
    await typeRate(user, '20');
    await user.dblClick(within(screen.getByRole('dialog')).getByRole('button', { name: 'Guardar cambio' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(port.createEvent).toHaveBeenCalledTimes(1);
  });

  it('keeps the dialog when the write fails and the retry repeats the same event id and key', async () => {
    port.createEvent.mockRejectedValueOnce(Object.assign(new Error('Servidor no disponible'), { code: 500 }));
    const { user, createNonce, reload, onNotify } = setup();
    await openRateChange(user);
    await typeRate(user, '20');
    await saveRate(user);

    expect(await screen.findByText('Servidor no disponible')).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
    expect(onNotify).not.toHaveBeenCalledWith(expect.stringContaining('Cambio de tasa registrado'));

    await saveRate(user, 'Reintentar');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(createNonce).toHaveBeenCalledTimes(1);
    expect(port.createEvent.mock.calls.map(([call]) => [call.id, call.data.dedupeKey])).toEqual([['den1', 'web:n1'], ['den1', 'web:n1']]);
  });

  it('keeps the saved change and says the costs were not refreshed when the reconcile fails', async () => {
    const reconcileCosts = vi.fn().mockResolvedValueOnce(NONE).mockRejectedValueOnce(new Error('sin red'));
    const { user, onNotify, reload } = setup({ reconcileCosts });
    await openRateChange(user);
    await typeRate(user, '20');
    await saveRate(user);

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(reload).toHaveBeenCalledTimes(1);
    expect(onNotify).toHaveBeenCalledWith('Cambio de tasa registrado. No pudimos actualizar los costos financieros: se corregirán al abrir la deuda de nuevo.');
  });

  it('lists a backdated change over a recorded payment as impacted before saving', async () => {
    const { user } = setup({ events: [...EVENTS, makePayment('e1', TODAY, 390381)], today: '2026-03-10' });
    await openRateChange(user);
    await typeRate(user, '30');
    fireEvent.change(screen.getByLabelText('Vigente desde'), { target: { value: '2026-01-20' } });

    expect(within(screen.getByRole('region', { name: 'Cambio con fecha pasada' })).getByText(/Pago del 5 feb/)).toBeInTheDocument();
  });
});

describe('DebtDetailContainer charge change flow', () => {
  const NONE = { created: 0, updated: 0, removed: 0 };
  const openChargeChange = async (user) => {
    await user.click(screen.getByRole('button', { name: 'Más acciones' }));
    await user.click(screen.getByRole('menuitem', { name: 'Cambiar seguros y cargos' }));
    return screen.getByRole('dialog');
  };
  const typeFee = async (user, text) => {
    const field = within(screen.getByRole('group', { name: 'Comisión' })).getByLabelText('Valor');
    await user.clear(field);
    await user.type(field, text);
  };
  const saveCharges = (user, name = 'Guardar cambio') => user.click(within(screen.getByRole('dialog')).getByRole('button', { name }));

  it('lists both plan changes in Más acciones for a loan', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Más acciones' }));

    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Cambiar tasa', 'Cambiar seguros y cargos']);
  });

  it('previews a fee raised to 12,000 and writes one charge_change event with the real charges, no cost row', async () => {
    const { user } = setup();
    await openChargeChange(user);
    await typeFee(user, '12000');
    const preview = within(screen.getByRole('group', { name: 'Vista previa' }));
    expect(preview.getByRole('row', { name: /Próxima cuota con cargos/ })).toHaveTextContent('$ 390.381$ 392.381');
    expect(preview.getByRole('row', { name: /Cargos por pagar/ })).toHaveTextContent('$ 360.000$ 430.000'); // the installment due today keeps the old fee
    expect(port.createEvent).not.toHaveBeenCalled(); // nothing is written before saving
    await saveCharges(user);

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(port.createEvent).toHaveBeenCalledTimes(1);
    const { id, data } = port.createEvent.mock.calls[0][0];
    expect(id).toBe('den1');
    expect(data).toMatchObject({ debtId: 'd1', kind: 'charge_change', effectiveOn: TODAY, amountMinor: 0, dedupeKey: 'web:n1', source: 'web', actorId: 'u1' });
    expect(JSON.parse(data.payloadJson).charges).toEqual([{ id: 'fee', kind: 'fee', label: 'Comisión', basis: 'fixed', value: 12000, cadence: 'per_installment', fromPeriod: 1, toPeriod: null, display: 'itemized' }]);
    expect(port.createCostRow).not.toHaveBeenCalled();
  });

  it('reloads, then reconciles the cost rows on fresh events, then refreshes, and reports the rows it changed', async () => {
    const calls = [];
    const reconcileCosts = vi.fn(async (...args) => { calls.push(args.length > 1 ? 'reconcile' : 'open'); return args.length > 1 ? { ...NONE, updated: 2 } : NONE; });
    const { user, onNotify } = setup({ reconcileCosts });
    await openChargeChange(user);
    await typeFee(user, '12000');
    await saveCharges(user);

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(reconcileCosts).toHaveBeenLastCalledWith('d1', { fresh: true });
    expect(calls).toEqual(['open', 'reconcile']);
    expect(onNotify).toHaveBeenCalledWith('Cambio de cargos registrado. Se actualizaron 2 filas de Costos financieros.');
  });

  it('creates one charge_change when the save button is tapped twice', async () => {
    const { user } = setup();
    await openChargeChange(user);
    await typeFee(user, '12000');
    await user.dblClick(within(screen.getByRole('dialog')).getByRole('button', { name: 'Guardar cambio' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(port.createEvent).toHaveBeenCalledTimes(1);
  });

  it('keeps the dialog when the write fails and the retry repeats the same event id and key', async () => {
    port.createEvent.mockRejectedValueOnce(Object.assign(new Error('Servidor no disponible'), { code: 500 }));
    const { user, createNonce, reload } = setup();
    await openChargeChange(user);
    await typeFee(user, '12000');
    await saveCharges(user);

    expect(await screen.findByText('Servidor no disponible')).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();

    await saveCharges(user, 'Reintentar');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(createNonce).toHaveBeenCalledTimes(1);
    expect(port.createEvent.mock.calls.map(([call]) => [call.id, call.data.dedupeKey])).toEqual([['den1', 'web:n1'], ['den1', 'web:n1']]);
  });

  it('keeps the saved change and says the costs were not refreshed when the reconcile fails', async () => {
    const reconcileCosts = vi.fn().mockResolvedValueOnce(NONE).mockRejectedValueOnce(new Error('sin red'));
    const { user, onNotify } = setup({ reconcileCosts });
    await openChargeChange(user);
    await typeFee(user, '12000');
    await saveCharges(user);

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onNotify).toHaveBeenCalledWith('Cambio de cargos registrado. No pudimos actualizar los costos financieros: se corregirán al abrir la deuda de nuevo.');
  });

  it('writes nothing while a dependent charge points at a charge that cannot be its base', async () => {
    const withIva = makeDebt({ principalMinor: 10000000 }, { principalMinor: 10000000, n: 36, charges: [
      { id: 'fee', kind: 'fee', label: 'Comisión', basis: 'fixed', value: 10000 },
      { id: 'iva', kind: 'tax', label: 'IVA', basis: 'pctOfCharge', refId: 'fee', value: 19 },
    ] });
    const { user } = setup({ debt: withIva });
    await openChargeChange(user);
    await user.selectOptions(within(screen.getByRole('group', { name: 'Comisión' })).getByLabelText('Se calcula como'), 'pctOfSubtotal');
    await saveCharges(user);

    expect(within(screen.getByRole('group', { name: 'IVA' })).getByText(/necesita un cargo anterior como base/)).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Guardar cambio' })).toBeDisabled();
    expect(port.createEvent).not.toHaveBeenCalled();
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
