import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../../appwrite';
import DebtDetailContainer from './DebtDetailContainer';
import { makeCard, makeEvent, makeMoraCard } from './debtFixtures';

vi.mock('../../appwrite', () => ({ debtPort: vi.fn(), getTransactionsInRange: vi.fn(), findDebtEventByDedupe: vi.fn() }));

const port = { ensureCostCategory: vi.fn(), createEvent: vi.fn(), findEventByDedupe: vi.fn(), createCostRow: vi.fn(), deleteCostRow: vi.fn() };
const TODAY = '2026-04-20';
const forCard = (event) => ({ ...event, debtId: 'c1' });

const setup = (events = [], overrides = {}) => {
  const props = {
    debt: makeCard(), events, today: TODAY, currentOwnerScope: 'you', user: { $id: 'u1' },
    reconcileCosts: vi.fn().mockResolvedValue({ created: 0, updated: 0, removed: 0 }),
    reload: vi.fn().mockResolvedValue(), onRefresh: vi.fn(), onNotify: vi.fn(), onBack: vi.fn(), createNonce: vi.fn().mockReturnValue('n1'),
    ...overrides,
  };
  const view = render(<DebtDetailContainer {...props} />);
  return { props, view, user: userEvent.setup() };
};
const inDialog = () => within(screen.getByRole('dialog'));
const fillIn = async (user, label, text) => {
  await user.clear(inDialog().getByLabelText(label));
  await user.type(inDialog().getByLabelText(label), text);
};
const created = () => {
  const { id, data } = port.createEvent.mock.calls[0][0];
  return { $id: id, $createdAt: `${TODAY}T10:00:00.000Z`, ...data };
};

beforeEach(() => {
  vi.clearAllMocks();
  api.debtPort.mockReturnValue(port);
  api.getTransactionsInRange.mockResolvedValue([]);
  api.findDebtEventByDedupe.mockResolvedValue(null);
  port.ensureCostCategory.mockResolvedValue('cat1');
  port.createEvent.mockImplementation(async ({ id, data }) => ({ $id: id, ...data }));
  port.createCostRow.mockImplementation(async ({ id, data }) => ({ $id: id, ...data }));
});

describe('DebtDetailContainer card statements', () => {
  it('writes the statement as an adjustment with the difference in the preview, and no expense', async () => {
    const { user, props } = setup();
    expect(within(screen.getByRole('region', { name: 'Estado de la deuda' })).getByText('$ 1.721.102')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Registrar extracto' }));
    await fillIn(user, 'Saldo total del extracto', '1721452');
    await fillIn(user, 'Pago mínimo del extracto (opcional)', '150000');

    const preview = within(screen.getByRole('group', { name: 'Vista previa' }));
    expect(preview.getByText('Saldo que calculamos').nextSibling).toHaveTextContent('$ 1.721.102');
    expect(preview.getByText('Diferencia').nextSibling).toHaveTextContent('$ 350');
    await user.click(inDialog().getByRole('button', { name: 'Registrar extracto' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(port.createEvent).toHaveBeenCalledWith({
      id: 'den1',
      data: expect.objectContaining({ debtId: 'c1', kind: 'adjustment', amountMinor: 0, effectiveOn: '2026-04-15', dedupeKey: 'web:n1', source: 'web', payloadJson: JSON.stringify({ balanceMinor: 1721452, minimumDueMinor: 150000, note: 'Extracto' }) }),
    });
    expect(port.createCostRow).not.toHaveBeenCalled();
    expect(props.reload).toHaveBeenCalledTimes(1);
    expect(props.onRefresh).toHaveBeenCalledTimes(1);
    expect(props.onNotify).toHaveBeenCalledWith('Extracto registrado.');
  });

  it('keeps the dialog on a failed save and the retry repeats the same ids', async () => {
    port.createEvent.mockRejectedValueOnce(Object.assign(new Error('Servidor no disponible'), { code: 500 }));
    const { user, props } = setup();
    await user.click(screen.getByRole('button', { name: 'Registrar extracto' }));
    await fillIn(user, 'Saldo total del extracto', '1721452');
    await user.click(inDialog().getByRole('button', { name: 'Registrar extracto' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Servidor no disponible');
    expect(props.reload).not.toHaveBeenCalled();
    await user.click(inDialog().getByRole('button', { name: 'Reintentar' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(props.createNonce).toHaveBeenCalledTimes(1);
    expect(port.createEvent.mock.calls.map(([call]) => [call.id, call.data.dedupeKey])).toEqual([['den1', 'web:n1'], ['den1', 'web:n1']]);
  });
});

describe('DebtDetailContainer card purchases', () => {
  it('opens a deferred tranche from an installment purchase, and the tranche shows once it is reloaded', async () => {
    const { user, view, props } = setup();
    await user.click(screen.getByRole('button', { name: 'Registrar compra' }));
    await user.selectOptions(inDialog().getByLabelText('Tipo de compra'), 'deferred');
    await fillIn(user, 'Descripción', 'Portátil');
    await fillIn(user, 'Valor', '600000');
    await fillIn(user, 'Cuotas', '6');
    await fillIn(user, 'Tasa E.A. (%)', '12');
    await user.click(inDialog().getByRole('button', { name: 'Registrar compra' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(port.createEvent).toHaveBeenCalledWith({
      id: 'den1',
      data: expect.objectContaining({ kind: 'charge', amountMinor: 600000, effectiveOn: TODAY, payloadJson: JSON.stringify({ trancheType: 'deferred', label: 'Portátil', n: 6, rate: { value: 12, basis: 'effective', periodicity: 'annual', timing: 'arrears' } }) }),
    });
    expect(screen.queryByText('Portátil')).not.toBeInTheDocument(); // nothing is shown until the reload brings it back
    view.rerender(<DebtDetailContainer {...props} events={[created()]} />);
    expect(within(screen.getByRole('region', { name: 'Tu tarjeta' })).getByText('Portátil')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Estado de la deuda' })).getByText('$ 2.321.102')).toBeInTheDocument();
  });

  it('does not read ordinary expenses: the balance moves only with statements and purchases', async () => {
    api.getTransactionsInRange.mockResolvedValue([{ $id: 't1', type: 'expense', amountMinor: 80000, merchant: 'Visa Gold' }]);
    setup();

    expect(within(screen.getByRole('region', { name: 'Estado de la deuda' })).getByText('$ 1.721.102')).toBeInTheDocument();
    expect(api.getTransactionsInRange).not.toHaveBeenCalled();
  });

  it('voids a mistaken statement from the history', async () => {
    const statement = forCard(makeEvent('s1', 'adjustment', '2026-04-15', 0, { balanceMinor: 1721452, note: 'Extracto' }));
    const { user } = setup([statement]);
    const history = within(screen.getByRole('region', { name: 'Historial' }));
    expect(history.getByText('Extracto')).toBeInTheDocument();
    expect(history.getByText('$ 1.721.452')).toBeInTheDocument();
    await user.click(history.getByRole('button', { name: 'Anular extracto del 15 abr' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Anular extracto' }));

    await waitFor(() => expect(port.createEvent).toHaveBeenCalled());
    expect(port.createEvent.mock.calls[0][0].data).toMatchObject({ kind: 'void', dedupeKey: 'void:s1' });
  });
});

describe('DebtDetailContainer card charge change', () => {
  it('offers the charge change in the card menu, compares the minimum payment and writes a charge_change without a mode', async () => {
    const { user } = setup([forCard(makeEvent('p1', 'payment', '2026-04-20', 100000))]);
    await user.click(screen.getByRole('button', { name: 'Más acciones' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Cambiar tasa', 'Cambiar seguros y cargos', 'Configurar mora', 'Corregir datos']);
    await user.click(screen.getByRole('menuitem', { name: 'Cambiar seguros y cargos' }));
    const fee = within(inDialog().getByRole('group', { name: 'Cuota de manejo' })).getByLabelText('Valor');
    await user.clear(fee);
    await user.type(fee, '12000');
    fireEvent.change(inDialog().getByLabelText('Vigente desde'), { target: { value: '2026-04-01' } });

    expect(inDialog().getByRole('row', { name: /Pago mínimo/ })).toHaveTextContent('$ 146.102$ 149.672');
    expect(inDialog().queryByRole('radio')).not.toBeInTheDocument();
    await user.click(inDialog().getByRole('button', { name: 'Guardar cambio' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(port.createEvent).toHaveBeenCalledTimes(1);
    const { data } = port.createEvent.mock.calls[0][0];
    expect(data).toMatchObject({ debtId: 'c1', kind: 'charge_change', effectiveOn: '2026-04-01', amountMinor: 0 });
    const payload = JSON.parse(data.payloadJson);
    expect(payload).not.toHaveProperty('mode');
    expect(payload.charges.map((charge) => [charge.id, charge.value])).toEqual([['mgmt_fee', 12000], ['mgmt_iva', 19]]);
  });
});

describe('DebtDetailContainer card terms correction', () => {
  it('corrects the cut day from Más acciones: previews 15 to 20 and writes one terms_correction bound to the opening terms, no cost row', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Más acciones' }));
    await user.click(screen.getByRole('menuitem', { name: 'Corregir datos' }));
    await fillIn(user, 'Día de corte', '20');

    expect(inDialog().getByRole('row', { name: /Día de corte/ })).toHaveTextContent('1520');
    expect(port.createEvent).not.toHaveBeenCalled(); // nothing is written before saving
    await user.click(inDialog().getByRole('button', { name: 'Guardar corrección' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(port.createEvent).toHaveBeenCalledTimes(1);
    const { data } = port.createEvent.mock.calls[0][0];
    expect(data).toMatchObject({ debtId: 'c1', kind: 'terms_correction', effectiveOn: TODAY, amountMinor: 0, dedupeKey: 'web:n1' });
    expect(JSON.parse(data.payloadJson)).toEqual({ fields: { card: { statementDay: 20 } }, previous: { card: { statementDay: 15 } }, appliesTo: 'opening' });
    expect(port.createCostRow).not.toHaveBeenCalled();
  });
});

describe('DebtDetailContainer card mora', () => {
  const TEN_DAYS_LATE = '2026-05-10';
  const moraCard = (late, today = TEN_DAYS_LATE) => setup([], { debt: makeMoraCard({ late }), today });

  it('configures the mora of a card from Más acciones: previews 861 and writes one late_policy, no cost row', async () => {
    const { user } = moraCard(null);
    await user.click(screen.getByRole('button', { name: 'Más acciones' }));
    await user.click(screen.getByRole('menuitem', { name: 'Configurar mora' }));
    await user.selectOptions(inDialog().getByLabelText('Interés de mora'), 'usury');
    fireEvent.change(inDialog().getByLabelText('Vigente desde'), { target: { value: '2026-04-30' } });

    expect(inDialog().getByRole('row', { name: /Mora acumulada/ })).toHaveTextContent('$ 0$ 861');
    await user.click(inDialog().getByRole('button', { name: 'Guardar mora' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(port.createEvent).toHaveBeenCalledTimes(1);
    const { data } = port.createEvent.mock.calls[0][0];
    expect(data).toMatchObject({ debtId: 'c1', kind: 'late_policy', effectiveOn: '2026-04-30', amountMinor: 0 });
    expect(JSON.parse(data.payloadJson)).toEqual({ late: { mode: 'usury', graceDays: 0 } });
    expect(port.createCostRow).not.toHaveBeenCalled();
  });

  it('writes the mora the statement shows next to its balance', async () => {
    const { user } = moraCard({ mode: 'usury', graceDays: 0 }, '2026-05-20');
    await user.click(screen.getByRole('button', { name: 'Registrar extracto' }));
    await fillIn(user, 'Saldo total del extracto', '1900000');
    await fillIn(user, 'Mora del extracto (opcional)', '1300');
    await user.click(inDialog().getByRole('button', { name: 'Registrar extracto' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(port.createEvent).toHaveBeenCalledTimes(1);
    const { data } = port.createEvent.mock.calls[0][0];
    expect(data).toMatchObject({ kind: 'adjustment', effectiveOn: '2026-05-15', amountMinor: 0 });
    expect(JSON.parse(data.payloadJson)).toMatchObject({ balanceMinor: 1900000, lateInterestMinor: 1300 });
  });

  it('offers the stated mora field in the statement form', async () => {
    const { user } = moraCard({ mode: 'usury', graceDays: 0 }, '2026-05-20');
    await user.click(screen.getByRole('button', { name: 'Registrar extracto' }));

    expect(inDialog().getByLabelText('Mora del extracto (opcional)')).toBeInTheDocument();
  });
});
