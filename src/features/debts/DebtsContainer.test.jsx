import { serializeTerms } from '@finance-core';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../../appwrite';
import { dateInputValue } from '../../shared/lib/dates';
import DebtsContainer from './DebtsContainer';

vi.mock('../../appwrite', () => ({ listDebts: vi.fn(), listDebtEvents: vi.fn(), createDebt: vi.fn(), debtPort: vi.fn() }));

const port = { ensureCostCategory: vi.fn(), createEvent: vi.fn(), findEventByDedupe: vi.fn(), createCostRow: vi.fn(), deleteCostRow: vi.fn() };

const debt = (id, name, ownerScope) => ({
  $id: id, name, lender: 'Banco', kind: 'consumer', ownerScope, status: 'active', principalMinor: 1200000, termsVersion: 1,
  termsJson: serializeTerms({
    kind: 'consumer', principalMinor: 1200000, openedOn: '2026-09-01', rate: { convention: 'ZERO' },
    system: 'french', periodicity: 'monthly', n: 12, firstDueOn: '2099-01-05',
  }),
});

const DEBTS = [debt('d1', 'Libre inversión', 'you'), debt('d2', 'Deuda de la pareja', 'partner')];
const inScope = (item) => item.ownerScope !== 'partner';

beforeEach(() => {
  vi.clearAllMocks();
  api.listDebts.mockResolvedValue(DEBTS);
  api.listDebtEvents.mockResolvedValue([]);
  api.createDebt.mockResolvedValue({});
  api.debtPort.mockReturnValue(port);
  port.createEvent.mockImplementation(async ({ id, data }) => ({ $id: id, ...data }));
});

describe('DebtsContainer list', () => {
  it('loads the debts, projects them and applies the scope filter', async () => {
    render(<DebtsContainer inScope={inScope} currentOwnerScope="you" />);

    const card = await screen.findByRole('article', { name: 'Libre inversión' });
    expect(within(card).getByText('$ 1.200.000')).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Deuda de la pareja' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Totales de deudas' })).getByText('$ 1.200.000')).toBeInTheDocument();
  });

  it('shows the error panel when loading fails and recovers with Reintentar', async () => {
    api.listDebts.mockRejectedValueOnce(new Error('sin red'));
    const user = userEvent.setup();
    render(<DebtsContainer inScope={inScope} currentOwnerScope="you" />);

    expect(await screen.findByText('No se pudieron cargar las deudas.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Totales de deudas' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));

    await waitFor(() => expect(screen.getByRole('article', { name: 'Libre inversión' })).toBeInTheDocument());
    expect(api.listDebts).toHaveBeenCalledTimes(2);
  });
});

describe('DebtsContainer create flow', () => {
  const setup = (overrides = {}) => {
    const props = { inScope, currentOwnerScope: 'you', ...overrides, householdId: 'h1', user: { $id: 'u1' }, onRefresh: vi.fn(), onNotify: vi.fn(), createNonce: vi.fn().mockReturnValue('n1') };
    render(<DebtsContainer {...props} />);
    return { ...props, user: userEvent.setup() };
  };
  const fillInformal = async (user, principal = '500000') => {
    await user.click(await screen.findByRole('button', { name: 'Nueva deuda' }));
    await user.click(screen.getByRole('button', { name: /^Informal/ }));
    await user.type(screen.getByLabelText('Nombre de la deuda'), 'Préstamo de papá');
    await user.type(screen.getByLabelText('Monto del préstamo'), principal);
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
  };
  const save = (user, name = 'Guardar deuda') => user.click(screen.getByRole('button', { name }));

  it('writes the disbursement event and the debt with deterministic ids, and no expense row', async () => {
    const { user, onRefresh } = setup();
    await fillInformal(user);
    await save(user);

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(port.createEvent).toHaveBeenCalledWith({
      id: 'den1',
      data: expect.objectContaining({ debtId: 'dbn1', kind: 'disbursement', amountMinor: 500000, effectiveOn: dateInputValue(), dedupeKey: 'web:n1:disb', source: 'web', actorId: 'u1', householdId: 'h1' }),
    });
    const { id, data } = api.createDebt.mock.calls[0][0];
    expect(id).toBe('dbn1');
    expect(data).toMatchObject({ householdId: 'h1', name: 'Préstamo de papá', kind: 'informal', ownerScope: 'shared', status: 'active', currency: 'COP', principalMinor: 500000, termsVersion: 1, actorId: 'u1' });
    expect(JSON.parse(data.termsJson)).toMatchObject({ system: 'none', principalMinor: 500000 });
    expect(port.createCostRow).not.toHaveBeenCalled();
    expect(port.ensureCostCategory).not.toHaveBeenCalled();
    expect(api.listDebts).toHaveBeenCalledTimes(2);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('stores Pareja as the scope of the other member, whoever is signed in', async () => {
    const { user } = setup({ currentOwnerScope: 'partner' });
    await user.click(await screen.findByRole('button', { name: 'Nueva deuda' }));
    await user.click(screen.getByRole('button', { name: /^Informal/ }));
    await user.type(screen.getByLabelText('Nombre de la deuda'), 'Mi deuda');
    await user.type(screen.getByLabelText('Monto del préstamo'), '100000');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Pareja' }));
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    await save(user);

    await waitFor(() => expect(api.createDebt).toHaveBeenCalled());
    expect(api.createDebt.mock.calls[0][0].data.ownerScope).toBe('you');
  });

  it('keeps the dialog and the list when the save fails, and the retry repeats the same ids', async () => {
    api.createDebt.mockRejectedValueOnce(Object.assign(new Error('Servidor no disponible'), { code: 500 }));
    const { user, createNonce, onRefresh, onNotify } = setup();
    await fillInformal(user);
    await save(user);

    expect(await screen.findByRole('alert')).toHaveTextContent('Servidor no disponible');
    expect(screen.getByRole('dialog', { name: 'Nueva deuda' })).toBeInTheDocument();
    expect(onNotify).toHaveBeenCalledWith('Servidor no disponible');
    expect(api.listDebts).toHaveBeenCalledTimes(1);
    expect(onRefresh).not.toHaveBeenCalled();

    port.createEvent.mockRejectedValueOnce(Object.assign(new Error('exists'), { code: 409 }));
    port.findEventByDedupe.mockResolvedValueOnce({ $id: 'den1', debtId: 'dbn1', kind: 'disbursement' });
    await save(user, 'Reintentar');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(createNonce).toHaveBeenCalledTimes(1);
    expect(port.findEventByDedupe).toHaveBeenCalledWith('web:n1:disb');
    expect(api.createDebt.mock.calls.map(([call]) => call.id)).toEqual(['dbn1', 'dbn1']);
    expect(api.listDebts).toHaveBeenCalledTimes(2);
  });

  it('treats an already existing debt (409) as saved', async () => {
    api.createDebt.mockRejectedValueOnce(Object.assign(new Error('exists'), { code: 409 }));
    const { user } = setup();
    await fillInformal(user);
    await save(user);

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.listDebts).toHaveBeenCalledTimes(2);
  });

  it('gives an edited draft new ids instead of reusing the failed attempt', async () => {
    api.createDebt.mockRejectedValueOnce(new Error('sin red'));
    const { user, createNonce } = setup();
    createNonce.mockReturnValueOnce('n1').mockReturnValueOnce('n2');
    await fillInformal(user);
    await save(user);
    await screen.findByRole('alert');

    await user.click(screen.getByRole('button', { name: 'Atrás' }));
    await user.clear(screen.getByLabelText('Monto del préstamo'));
    await user.type(screen.getByLabelText('Monto del préstamo'), '600000');
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    await save(user, 'Reintentar');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.createDebt.mock.calls.map(([call]) => call.id)).toEqual(['dbn1', 'dbn2']);
    expect(port.createEvent.mock.calls.map(([call]) => call.data.amountMinor)).toEqual([500000, 600000]);
  });
});
