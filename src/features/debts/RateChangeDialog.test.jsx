import { project, resolveLegal } from '@finance-core';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import RateChangeDialog from './RateChangeDialog';
import { makeCard, makeDebt, makeEvent, makePayment } from './debtFixtures';
import { INSTALLMENT_TOO_LOW } from './rateChangeModel';

const DISBURSEMENT = makeEvent('e0', 'disbursement', '2026-01-05', 1000000);
const IDLE = { status: 'idle', error: null, locked: false };

const setup = ({ debt = makeDebt(), events = [DISBURSEMENT], today = '2026-01-20', ...props } = {}) => {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  render(<RateChangeDialog debt={debt} events={events} projection={project(debt, events, today)} today={today} saveState={IDLE} onSubmit={onSubmit} onClose={onClose} {...props} />);
  return { onSubmit, onClose, user: userEvent.setup() };
};
const rateField = () => screen.getByLabelText('Valor de la tasa');
const typeRate = async (user, text) => { await user.clear(rateField()); await user.type(rateField(), text); };
const setDate = (value) => fireEvent.change(screen.getByLabelText('Vigente desde'), { target: { value } });
const preview = () => screen.getByRole('group', { name: 'Vista previa' });
const rowOf = (name) => within(preview()).getByRole('row', { name: new RegExp(name) });
const save = () => screen.getByRole('button', { name: 'Guardar cambio' });

describe('RateChangeDialog preview', () => {
  it('starts on the rate in force, effective today, and previews 2% a month before anything is saved', async () => {
    const { user, onSubmit } = setup();

    expect(screen.getByLabelText('Vigente desde')).toHaveValue('2026-01-20');
    expect(rateField()).toHaveValue(24);
    expect(screen.getByLabelText('Convención')).toHaveValue('EA');
    expect(rowOf('Próxima cuota')).toHaveTextContent('$ 93.453$ 93.453'); // nothing changes yet

    await user.selectOptions(screen.getByLabelText('Convención'), 'MV');
    await typeRate(user, '2');

    expect(screen.getByText(/Equivale a/)).toHaveTextContent('26.82% EA');
    expect(rowOf('Próxima cuota')).toHaveTextContent('$ 93.453$ 94.560');
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(save());
    expect(onSubmit).toHaveBeenCalledWith({ kind: 'rate_change', effectiveOn: '2026-01-20', rate: { value: 2, basis: 'effective', periodicity: 'monthly', timing: 'arrears' }, mode: 'keep_term' });
  });

  it('compares the term and the interest still to pay, not only the installment', async () => {
    const { user } = setup();
    await typeRate(user, '20');

    expect(rowOf('Cuotas restantes')).toHaveTextContent('1212');
    expect(rowOf('Intereses por pagar')).toHaveTextContent('$ 121.431$ 102.282');
    expect(rowOf('Próxima cuota')).toHaveTextContent('$ 93.453$ 91.857');
  });

  it('says so when the change leaves every installment as it was', async () => {
    const { user } = setup();
    await typeRate(user, '20');
    expect(screen.queryByText('Este cambio no modifica ninguna cuota.')).not.toBeInTheDocument();

    setDate('2027-06-01'); // after the last installment
    expect(screen.getByText('Este cambio no modifica ninguna cuota.')).toBeInTheDocument();
    expect(save()).toBeEnabled();
  });

  it('keeps the save disabled until the rate is a valid number, and explains an invalid date', async () => {
    const { user } = setup();
    await user.clear(rateField());
    expect(save()).toBeDisabled();
    expect(screen.queryByRole('group', { name: 'Vista previa' })).not.toBeInTheDocument();

    await user.type(rateField(), '22');
    expect(save()).toBeEnabled();

    setDate('');
    expect(save()).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Elige una fecha válida.');
  });
});

describe('RateChangeDialog modes', () => {
  it('offers keep term and keep installment on a French loan, and submits the one chosen', async () => {
    const { user, onSubmit } = setup();
    await typeRate(user, '20');

    expect(screen.getByRole('radio', { name: /Mantener el plazo/ })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: /Mantener la cuota/ }));
    expect(rowOf('Próxima cuota')).toHaveTextContent('$ 93.453$ 93.453');
    await user.click(save());

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ mode: 'keep_installment' }));
  });

  it('only keeps the term on a system that has no fixed installment', () => {
    setup({ debt: makeDebt({}, { system: 'german' }) });

    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.getByText('Este sistema mantiene el plazo.')).toBeInTheDocument();
  });

  it('has no mode at all for a card, which compares its minimum payment', async () => {
    const events = [{ ...makeEvent('p1', 'payment', '2026-05-10', 100000), debtId: 'c1' }];
    const { user, onSubmit } = setup({ debt: makeCard(), events, today: '2026-05-20' });
    await typeRate(user, '35');
    setDate('2026-05-01');

    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByText('Este sistema mantiene el plazo.')).not.toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /Cuotas restantes/ })).not.toBeInTheDocument();
    expect(within(preview()).getByRole('row', { name: /Pago mínimo/ })).toHaveTextContent('$ 110.392$ 112.662');
    await user.click(save());
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'rate_change', mode: 'keep_term' }));
  });

  it('explains a too-low installment, selects keep term and never submits the failing choice', async () => {
    const { user, onSubmit } = setup();
    await user.click(screen.getByRole('radio', { name: /Mantener la cuota/ }));
    expect(screen.queryByText(INSTALLMENT_TOO_LOW)).not.toBeInTheDocument();

    await typeRate(user, '400');

    expect(screen.getByText(INSTALLMENT_TOO_LOW)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Mantener el plazo/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Mantener la cuota/ })).not.toBeChecked();
    await user.click(save());
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ mode: 'keep_term', rate: expect.objectContaining({ value: 400 }) }));

    await typeRate(user, '20'); // a rate the installment covers again: no message
    expect(screen.queryByText(INSTALLMENT_TOO_LOW)).not.toBeInTheDocument();
  });
});

describe('RateChangeDialog legal notice and backdating', () => {
  const capped = () => makeDebt({ legal: resolveLegal([{ kind: 'usury', modality: 'consumer', validFrom: '2026-01-01', validTo: '2026-01-31', value: 2900, source: 'Resolución', verified: true }]) });

  it('cites the usury cap of the household table, without blocking the save', async () => {
    const { user } = setup({ debt: capped() });
    await typeRate(user, '29.5');

    expect(screen.getByRole('note')).toHaveTextContent(/supera el tope de usura de 29 % E\.A\./);
    expect(save()).toBeEnabled();

    await typeRate(user, '24');
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('warns about a past date and lists the payments whose cost would change', async () => {
    const { user } = setup({ events: [DISBURSEMENT, makePayment('e1', '2026-02-05')], today: '2026-03-10' });
    await typeRate(user, '30');
    expect(screen.queryByText(/ya pasó/)).not.toBeInTheDocument();

    setDate('2026-01-20');

    const warning = screen.getByRole('region', { name: 'Cambio con fecha pasada' });
    expect(warning).toHaveTextContent('Esta fecha ya pasó: el costo de pagos ya registrados puede cambiar.');
    const [entry] = within(warning).getAllByRole('listitem');
    expect(entry).toHaveTextContent('Pago del 5 feb');
    expect(entry).toHaveTextContent('Costo financiero $ 18.088 → $ 22.104');
  });

  it('still warns about a past date when no recorded payment is affected', async () => {
    const { user } = setup({ events: [DISBURSEMENT, makePayment('e1', '2026-02-05')], today: '2026-03-10' });
    await typeRate(user, '30');

    setDate('2026-03-01');

    const warning = screen.getByRole('region', { name: 'Cambio con fecha pasada' });
    expect(warning).toHaveTextContent('Ningún pago registrado cambia de costo.');
    expect(within(warning).queryByRole('listitem')).not.toBeInTheDocument();
  });
});

describe('RateChangeDialog save states', () => {
  it('freezes the form while saving and offers a retry after an error', () => {
    const debt = makeDebt();
    const props = { debt, events: [DISBURSEMENT], projection: project(debt, [DISBURSEMENT], '2026-01-20'), today: '2026-01-20', onSubmit: vi.fn(), onClose: vi.fn() };

    const saving = render(<RateChangeDialog {...props} saveState={{ status: 'saving', error: null, locked: false }} />);
    expect(rateField()).toBeDisabled();
    expect(screen.getByLabelText('Vigente desde')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Guardando…' })).toBeDisabled();
    saving.unmount();

    render(<RateChangeDialog {...props} saveState={{ status: 'error', error: 'Servidor no disponible', locked: false }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Servidor no disponible');
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeEnabled();
  });
});
