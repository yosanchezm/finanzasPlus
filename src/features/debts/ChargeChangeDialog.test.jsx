import { project } from '@finance-core';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ChargeChangeDialog from './ChargeChangeDialog';
import { makeCard, makeDebt, makeEvent, makePayment } from './debtFixtures';

const IDLE = { status: 'idle', error: null, locked: false };
const FEE = { id: 'fee', kind: 'fee', label: 'Comisión', basis: 'fixed', value: 10000, cadence: 'per_installment' };
const IVA = { id: 'iva', kind: 'tax', label: 'IVA sobre la comisión', basis: 'pctOfCharge', refId: 'fee', value: 19, cadence: 'per_installment' };
// 10,000,000 at 24% EA in 36 installments with a 10,000 fee and 19% IVA: the installment is 380,381 + 11,900 = 392,281.
const LOAN = makeDebt({ principalMinor: 10000000 }, { principalMinor: 10000000, n: 36, charges: [FEE, IVA] });
const DISBURSEMENT = makeEvent('e0', 'disbursement', '2026-01-05', 10000000);
const FIRST_PAID = makePayment('e1', '2026-02-05', 392281);

const setup = ({ debt = LOAN, events = [DISBURSEMENT, FIRST_PAID], today = '2026-02-20', saveState = IDLE } = {}) => {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  render(<ChargeChangeDialog debt={debt} events={events} projection={project(debt, events, today)} today={today} saveState={saveState} onSubmit={onSubmit} onClose={onClose} />);
  return { onSubmit, onClose, user: userEvent.setup() };
};
const chargeOf = (name) => within(screen.getByRole('group', { name }));
const typeInto = async (user, field, text) => { await user.clear(field); await user.type(field, text); };
const setDate = (value) => fireEvent.change(screen.getByLabelText('Vigente desde'), { target: { value } });
const preview = () => screen.getByRole('group', { name: 'Vista previa' });
const rowOf = (name) => within(preview()).getByRole('row', { name: new RegExp(name) });
const save = () => screen.getByRole('button', { name: 'Guardar cambio' });

describe('ChargeChangeDialog form', () => {
  it('starts on the charges in force, effective today, with nothing to save yet', () => {
    setup();

    expect(screen.getByLabelText('Vigente desde')).toHaveValue('2026-02-20');
    expect(chargeOf('Comisión').getByLabelText('Valor')).toHaveValue('10000');
    expect(chargeOf('IVA sobre la comisión').getByLabelText('Valor')).toHaveValue('19');
    expect(screen.getByText('Todavía no cambiaste ningún cargo.')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Vista previa' })).not.toBeInTheDocument();
    expect(save()).toBeDisabled();
  });

  it('previews a fee changed from 10,000 to 12,000 next month, and saves only when asked', async () => {
    const { user, onSubmit } = setup();

    setDate('2026-03-01');
    await typeInto(user, chargeOf('Comisión').getByLabelText('Valor'), '12000');

    expect(rowOf('Próxima cuota con cargos')).toHaveTextContent('$ 392.281$ 394.661');
    expect(rowOf('Cargos por pagar')).toHaveTextContent('$ 416.500$ 499.800');
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(save());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const draft = onSubmit.mock.calls[0][0];
    expect(draft).toMatchObject({ kind: 'charge_change', effectiveOn: '2026-03-01' });
    expect(draft.charges.map((charge) => [charge.id, charge.value])).toEqual([['fee', 12000], ['iva', 19]]);
  });

  it('applies the new set from the effective date only: a later date leaves the earlier installments alone', async () => {
    const { user } = setup();
    await typeInto(user, chargeOf('Comisión').getByLabelText('Valor'), '12000');

    setDate('2026-06-01');

    expect(rowOf('Cargos por pagar')).toHaveTextContent('$ 416.500$ 492.660'); // installments 2 to 4 keep the old fee
  });

  it('asks before removing a fee that has an IVA, then previews the debt without any charge', async () => {
    const { user, onSubmit } = setup();

    await user.click(screen.getByRole('button', { name: 'Quitar Comisión' }));
    expect(screen.getByRole('group', { name: 'Confirmar que se quitan varios cargos' })).toHaveTextContent('también se quita «IVA sobre la comisión»');
    expect(screen.queryByRole('group', { name: 'Vista previa' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Quitar todo' }));

    expect(rowOf('Próxima cuota con cargos')).toHaveTextContent('$ 392.281$ 380.381');
    expect(rowOf('Cargos por pagar')).toHaveTextContent('$ 416.500$ 0');
    await user.click(save());
    expect(onSubmit).toHaveBeenCalledWith({ kind: 'charge_change', effectiveOn: '2026-02-20', charges: [] });
  });

  it('adds a charge from the presets and saves it once it has a value', async () => {
    const { user, onSubmit } = setup();

    await user.click(screen.getByRole('button', { name: 'Seguro de vida' }));
    await typeInto(user, chargeOf('Seguro de vida').getByLabelText('Valor'), '0,05');
    await user.click(save());

    const { charges } = onSubmit.mock.calls[0][0];
    expect(charges.map((charge) => charge.id)).toEqual(['fee', 'iva', 'life']);
    expect(charges[2]).toMatchObject({ basis: 'pctOutstanding', value: 0.05 });
  });
});

describe('ChargeChangeDialog validation', () => {
  it('disables the save with an inline message when an IVA loses the fee it is calculated on, and recovers', async () => {
    const { user, onSubmit } = setup();
    await typeInto(user, chargeOf('Comisión').getByLabelText('Valor'), '12000');
    expect(save()).toBeEnabled();

    await user.selectOptions(chargeOf('Comisión').getByLabelText('Se calcula como'), 'pctOfSubtotal'); // a fee on the subtotal cannot be a base

    expect(chargeOf('IVA sobre la comisión').getByText('«IVA sobre la comisión» necesita un cargo anterior como base. Elige uno o quítalo.')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Corrige los cargos señalados para ver la vista previa.');
    expect(save()).toBeDisabled();
    expect(screen.queryByRole('group', { name: 'Vista previa' })).not.toBeInTheDocument();
    await user.click(save());
    expect(onSubmit).not.toHaveBeenCalled();

    await user.selectOptions(chargeOf('Comisión').getByLabelText('Se calcula como'), 'fixed');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(save()).toBeEnabled();
  });

  it('explains an invalid date and keeps the save disabled', async () => {
    const { user } = setup();
    await typeInto(user, chargeOf('Comisión').getByLabelText('Valor'), '12000');

    setDate('');

    expect(screen.getByRole('alert')).toHaveTextContent('Elige una fecha válida.');
    expect(save()).toBeDisabled();
  });

  it('says so when a change moves no figure, but still lets it be saved', async () => {
    const { user, onSubmit } = setup();

    await typeInto(user, chargeOf('Comisión').getByLabelText('Nombre'), 'Comisión de manejo');

    expect(screen.getByText('Este cambio no modifica la próxima cuota ni los cargos por pagar.')).toBeInTheDocument();
    expect(save()).toBeEnabled();
    await user.click(save());
    expect(onSubmit.mock.calls[0][0].charges[0].label).toBe('Comisión de manejo');
  });
});

describe('ChargeChangeDialog backdating', () => {
  it('warns about a past date and lists the payments whose cost would change', async () => {
    const { user } = setup({ today: '2026-03-10' });
    await typeInto(user, chargeOf('Comisión').getByLabelText('Valor'), '12000');
    expect(screen.queryByText(/ya pasó/)).not.toBeInTheDocument();

    setDate('2026-01-20');

    const warning = screen.getByRole('region', { name: 'Cambio con fecha pasada' });
    expect(warning).toHaveTextContent('Esta fecha ya pasó: el costo de pagos ya registrados puede cambiar.');
    const [entry] = within(warning).getAllByRole('listitem');
    expect(entry).toHaveTextContent('Pago del 5 feb');
    expect(entry).toHaveTextContent('Costo financiero $ 192.776 → $ 195.156');
  });
});

describe('ChargeChangeDialog on a card', () => {
  it('has no mode choice and compares the minimum payment of the next statement', async () => {
    const events = [{ ...makePayment('p1', '2026-05-10', 100000), debtId: 'c1' }];
    const { user, onSubmit } = setup({ debt: makeCard(), events, today: '2026-05-20' });
    expect(chargeOf('Cuota de manejo').getByLabelText('Valor')).toHaveValue('9000');
    await typeInto(user, chargeOf('Cuota de manejo').getByLabelText('Valor'), '12000');
    setDate('2026-05-01');

    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(rowOf('Pago mínimo')).toHaveTextContent('$ 146.102$ 149.672');
    expect(within(preview()).queryByRole('row', { name: /Cargos por pagar/ })).not.toBeInTheDocument();
    expect(within(preview()).queryByRole('row', { name: /Cuotas restantes/ })).not.toBeInTheDocument();
    await user.click(save());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ kind: 'charge_change', effectiveOn: '2026-05-01' });
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('mode');
  });
});

describe('ChargeChangeDialog save states', () => {
  it('freezes the form while saving', () => {
    setup({ saveState: { status: 'saving', error: null, locked: false } });

    expect(screen.getByLabelText('Vigente desde')).toBeDisabled();
    expect(chargeOf('Comisión').getByLabelText('Valor')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Guardando…' })).toBeDisabled();
  });

  it('shows the error and offers a retry of the change already typed', async () => {
    const { user, onSubmit } = setup({ saveState: { status: 'error', error: 'Servidor no disponible', locked: false } });
    await typeInto(user, chargeOf('Comisión').getByLabelText('Valor'), '12000');

    expect(screen.getByRole('alert')).toHaveTextContent('Servidor no disponible');
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
