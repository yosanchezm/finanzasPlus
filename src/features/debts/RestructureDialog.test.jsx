import { project, resolveLegal } from '@finance-core';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import RestructureDialog from './RestructureDialog';
import { makeDebt, makeEvent, makePayment } from './debtFixtures';
import { PAYLOAD_TOO_LARGE } from './restructureModel';

// The reference loan of the plan-change specs: 10,000,000 at 24% EA over 36 months with a 10,000 fee, first installment
// 390,381 due on 2026-02-05. On 2026-02-15 it is 10 days late and the mora is 1,375.
const FEE = { id: 'fee', kind: 'fee', label: 'Comisión', basis: 'fixed', value: 10000, cadence: 'per_installment' };
const LEGAL = resolveLegal([], { usuryTable: [{ modality: 'consumer', validFrom: '2026-01-01', validTo: '2026-12-31', capEA: 28.59, source: 'test', verified: true }] });
const DISBURSEMENT = makeEvent('e0', 'disbursement', '2026-01-05', 10000000);
const IDLE = { status: 'idle', error: null, locked: false };
const DAY_10 = '2026-02-15';

const moraLoan = () => makeDebt({ principalMinor: 10000000, legal: LEGAL }, { principalMinor: 10000000, n: 36, charges: [FEE], late: { mode: 'usury' } });

const setup = ({ debt = moraLoan(), events = [DISBURSEMENT], today = DAY_10, ...props } = {}) => {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  render(<RestructureDialog debt={debt} events={events} projection={project(debt, events, today)} today={today} saveState={IDLE} onSubmit={onSubmit} onClose={onClose} {...props} />);
  return { onSubmit, onClose, user: userEvent.setup() };
};
const setDate = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const next = () => screen.getByRole('button', { name: 'Siguiente' });
const rowOf = (name) => within(screen.getByRole('group', { name: 'Lo que se refinancia' })).getByRole('row', { name: new RegExp(name) });
const toTerms = (user) => user.click(next());
const typeInto = async (user, label, text) => { await user.clear(screen.getByLabelText(label)); await user.type(screen.getByLabelText(label), text); };

describe('RestructureDialog step 1: the current situation', () => {
  it('shows the arrears with the mora, and the balance that would be refinanced is their sum', () => {
    setup();

    expect(screen.getByText('Paso 1 de 3: Situación actual')).toBeInTheDocument();
    expect(rowOf('Capital pendiente')).toHaveTextContent('$ 10.000.000');
    expect(rowOf('Intereses vencidos')).toHaveTextContent('$ 180.876');
    expect(rowOf('Cargos e impuestos vencidos')).toHaveTextContent('$ 10.000');
    expect(rowOf('Intereses de mora')).toHaveTextContent('$ 1.375');
    expect(rowOf('Saldo que se refinancia')).toHaveTextContent('$ 10.192.251');
    expect(screen.getByLabelText('Vigente desde')).toHaveValue(DAY_10);
  });

  it('recomputes the arrears when the effective date moves, here to the due date, when there is no mora yet', () => {
    setup();

    setDate('Vigente desde', '2026-02-05');

    expect(rowOf('Intereses de mora')).toHaveTextContent('$ 0');
    expect(rowOf('Saldo que se refinancia')).toHaveTextContent('$ 10.190.876');
  });

  it('explains a date that is not real and does not advance', async () => {
    const { user } = setup();

    setDate('Vigente desde', '');

    expect(screen.getByRole('alert')).toHaveTextContent('Elige una fecha válida.');
    expect(screen.queryByRole('group', { name: 'Lo que se refinancia' })).not.toBeInTheDocument();
    expect(next()).toBeDisabled();
    await user.click(next());
    expect(screen.getByText('Paso 1 de 3: Situación actual')).toBeInTheDocument();
  });

  it('advances to the new conditions, and Atrás keeps what was typed there', async () => {
    const { user } = setup();
    await toTerms(user);

    expect(screen.getByText('Paso 2 de 3: Nuevas condiciones')).toBeInTheDocument();
    await typeInto(user, 'Número de cuotas', '48');
    await user.click(screen.getByRole('button', { name: 'Atrás' }));
    expect(screen.getByText('Paso 1 de 3: Situación actual')).toBeInTheDocument();
    await toTerms(user);

    expect(screen.getByLabelText('Número de cuotas')).toHaveValue(48);
  });
});

describe('RestructureDialog step 2: the new conditions', () => {
  it('starts from the terms in force: rate, system, periodicity, installments left and a first installment one period on', async () => {
    const { user } = setup();
    await toTerms(user);

    expect(screen.getByLabelText('Valor de la tasa')).toHaveValue(24);
    expect(screen.getByLabelText('Convención')).toHaveValue('EA');
    expect(screen.getByLabelText('Sistema de pago')).toHaveValue('french');
    expect(screen.getByLabelText('Número de cuotas')).toHaveValue(36);
    expect(screen.getByLabelText('Periodicidad')).toHaveValue('monthly');
    expect(screen.getByLabelText('Primera cuota')).toHaveValue('2026-03-15');
    expect(screen.getByLabelText('Cuotas de gracia')).toHaveValue(0);
    expect(within(screen.getByRole('region', { name: 'Seguros y cargos' })).getByLabelText('Valor')).toHaveValue('10000');
    expect(next()).toBeEnabled();
  });

  it('echoes the new rate as an effective annual rate', async () => {
    const { user } = setup();
    await toTerms(user);

    await user.selectOptions(screen.getByLabelText('Convención'), 'MV');
    await typeInto(user, 'Valor de la tasa', '2');

    expect(screen.getByText(/Equivale a/)).toHaveTextContent('26.82% EA');
  });

  it('asks for the final payment of an interest-only plan and for grace on a French one', async () => {
    const leasing = makeDebt({ kind: 'leasing' }, { kind: 'leasing', system: 'interest_only', n: 12, firstDueOn: '2026-02-05' });
    const { user } = setup({ debt: leasing, today: '2026-01-20' });
    await toTerms(user);

    expect(screen.getByLabelText('Sistema de pago')).toHaveValue('interest_only');
    expect(screen.getByLabelText('Pago final')).toBeInTheDocument();
    expect(screen.queryByLabelText('Cuotas de gracia')).not.toBeInTheDocument();
    expect([...screen.getByLabelText('Sistema de pago').options].map((option) => option.value)).toEqual(['interest_only', 'french']);

    await user.selectOptions(screen.getByLabelText('Sistema de pago'), 'french');
    expect(screen.getByLabelText('Cuotas de gracia')).toBeInTheDocument();
    expect(screen.queryByLabelText('Pago final')).not.toBeInTheDocument();
  });

  it('does not offer a manual plan to a debt kind that allows one, because its dates belong to the old calendar', async () => {
    const family = makeDebt({ kind: 'family' }, { kind: 'family', n: 12, firstDueOn: '2026-02-05', rate: { value: 0, basis: 'effective', periodicity: 'annual', timing: 'arrears' } });
    const { user } = setup({ debt: family, today: '2026-01-20' });
    await toTerms(user);

    expect(screen.queryByLabelText('Sistema de pago')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Agregar cuota' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Número de cuotas')).toHaveValue(12);
  });

  it('shows an inline error and does not advance when the first installment is on or before the effective date', async () => {
    const { user } = setup();
    await toTerms(user);

    setDate('Primera cuota', DAY_10);

    expect(screen.getByText('La primera cuota debe ser después de la fecha de la reestructuración.')).toBeInTheDocument();
    expect(screen.getByLabelText('Primera cuota')).toBeInvalid();
    expect(next()).toBeDisabled();

    setDate('Primera cuota', '2026-03-01');
    expect(screen.queryByText(/debe ser después de la fecha/)).not.toBeInTheDocument();
    expect(next()).toBeEnabled();
  });

  it('does not move on from a step that is wrong even if the form is submitted another way', async () => {
    const { user } = setup();
    await toTerms(user);
    setDate('Primera cuota', DAY_10);

    fireEvent.submit(screen.getByRole('dialog').querySelector('form'));

    expect(screen.getByText('Paso 2 de 3: Nuevas condiciones')).toBeInTheDocument();
  });

  it('needs a number of installments, which it never takes for granted', async () => {
    const { user } = setup();
    await toTerms(user);

    await user.clear(screen.getByLabelText('Número de cuotas'));

    expect(screen.getByText('Escribe cuántas cuotas tendrá el nuevo plan (entre 1 y 2000).')).toBeInTheDocument();
    expect(next()).toBeDisabled();
  });

  it('offers "Condonar los intereses de mora" only when there is mora, and shows the balance without it', async () => {
    const { user } = setup();
    await toTerms(user);

    expect(screen.getByText(/Saldo que se refinancia/)).toHaveTextContent('$ 10.192.251');
    await user.click(screen.getByRole('checkbox', { name: /Condonar los intereses de mora/ }));
    expect(screen.getByText(/Saldo que se refinancia/)).toHaveTextContent('$ 10.190.876');
    expect(screen.getByText(/La mora de \$ 1\.375 no pasa al nuevo plan/)).toBeInTheDocument();
  });

  it('does not offer to waive mora that does not exist', async () => {
    const { user } = setup({ debt: makeDebt({ principalMinor: 10000000 }, { principalMinor: 10000000, n: 36, charges: [FEE] }) });
    await toTerms(user);

    expect(screen.queryByRole('checkbox', { name: /Condonar/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Saldo que se refinancia/)).toHaveTextContent('$ 10.190.876');
  });

  it('embeds the charges editor, and a wrong charge blocks the step', async () => {
    const { user } = setup();
    await toTerms(user);
    const fee = () => within(screen.getByRole('region', { name: 'Seguros y cargos' })).getByLabelText('Valor');

    await user.clear(fee());
    await user.type(fee(), 'abc');

    expect(screen.getByText('Revisa los cargos señalados.')).toBeInTheDocument();
    expect(next()).toBeDisabled();
    await user.clear(fee());
    await user.type(fee(), '12000');
    expect(next()).toBeEnabled();
  });
});

describe('RestructureDialog step 3: the summary', () => {
  const toSummary = async (user) => { await toTerms(user); await user.click(next()); };
  const previewRow = (name) => within(screen.getByRole('group', { name: 'Vista previa' })).getByRole('row', { name: new RegExp(name) });
  const saveButton = () => screen.getByRole('button', { name: 'Guardar reestructuración' });

  it('previews the debt before and after, and saves the restructure it built', async () => {
    const { user, onSubmit } = setup();
    await toTerms(user);
    await typeInto(user, 'Número de cuotas', '48');
    await user.click(next());

    expect(screen.getByText('Paso 3 de 3: Resumen')).toBeInTheDocument();
    expect(previewRow('Saldo')).toHaveTextContent('$ 10.000.000$ 10.192.251');
    expect(previewRow('Vencido')).toHaveTextContent('$ 391.756$ 0');
    expect(previewRow('Mora por pagar')).toHaveTextContent('$ 1.375$ 0');
    expect(previewRow('Cuotas restantes')).toHaveTextContent('3648');
    expect(previewRow('Próxima cuota')).toHaveTextContent('$ 380.381$ 319.488');
    expect(screen.getByRole('group', { name: 'Nuevo plan' })).toHaveTextContent('48 cuotas mensuales');
    expect(onSubmit).not.toHaveBeenCalled(); // nothing is saved before the button

    await user.click(saveButton());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [draft] = onSubmit.mock.calls[0];
    expect(draft).toMatchObject({ kind: 'restructure', effectiveOn: DAY_10, terms: { principalMinor: 10192251, openedOn: DAY_10, n: 48, firstDueOn: '2026-03-15', rate: { value: 24 }, late: { mode: 'usury' } } });
    expect(draft).not.toHaveProperty('waiveLate');
  });

  it('leaves the mora out of the balance and sends waiveLate when it is forgiven', async () => {
    const { user, onSubmit } = setup();
    await toTerms(user);
    await user.click(screen.getByRole('checkbox', { name: /Condonar los intereses de mora/ }));
    await user.click(next());

    expect(previewRow('Saldo')).toHaveTextContent('$ 10.000.000$ 10.190.876');
    expect(screen.getByRole('group', { name: 'Nuevo plan' })).toHaveTextContent('Mora condonada$ 1.375');
    await user.click(saveButton());
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'restructure', waiveLate: true }));
  });

  it('shows no waived mora when it was kept', async () => {
    const { user } = setup();
    await toSummary(user);

    expect(screen.queryByText('Mora condonada')).not.toBeInTheDocument();
  });

  it('warns that a rate above the usury cap is informational, and does not block saving', async () => {
    const { user, onSubmit } = setup();
    await toTerms(user);
    await typeInto(user, 'Valor de la tasa', '40');
    await user.click(next());

    expect(screen.getByRole('note')).toHaveTextContent(/supera el tope de usura/);
    await user.click(saveButton());
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('shows no usury notice for a rate under the cap', async () => {
    const { user } = setup();
    await toSummary(user);

    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('lists the payment a backdated restructure changes the cost of', async () => {
    const { user } = setup({ events: [DISBURSEMENT, makePayment('p1', '2026-02-20', 392000)], today: '2026-02-25' });
    setDate('Vigente desde', '2026-02-10');
    await toSummary(user);

    const notice = screen.getByRole('region', { name: 'Cambio con fecha pasada' });
    expect(within(notice).getByText(/Pago del 20 feb/)).toBeInTheDocument();
  });

  it('blocks saving with a message when the event would not fit its column (payload_too_large)', async () => {
    const make = (pad) => makeDebt({ principalMinor: 10000000, legal: LEGAL }, { principalMinor: 10000000, n: 36, late: { mode: 'usury' }, charges: [{ ...FEE, label: `Comisión${'x'.repeat(pad)}` }] });
    const heavy = make(7995 - make(0).termsJson.length); // a terms document of 7,995 characters: the restructure payload goes over 8,000
    expect(heavy.termsJson.length).toBeLessThanOrEqual(8000);
    const { user, onSubmit } = setup({ debt: heavy });
    await toSummary(user);

    expect(screen.getByRole('alert')).toHaveTextContent(PAYLOAD_TOO_LARGE);
    expect(saveButton()).toBeDisabled();
    await user.click(saveButton());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('goes back to change the terms and previews the new ones', async () => {
    const { user } = setup();
    await toSummary(user);
    await user.click(screen.getByRole('button', { name: 'Atrás' }));
    await typeInto(user, 'Número de cuotas', '60');
    await user.click(next());

    expect(previewRow('Cuotas restantes')).toHaveTextContent('3660');
  });
});

describe('RestructureDialog while saving', () => {
  const summaryWith = async (saveState) => {
    const debt = moraLoan();
    const events = [DISBURSEMENT];
    const user = userEvent.setup();
    const props = { debt, events, projection: project(debt, events, DAY_10), today: DAY_10, onSubmit: vi.fn(), onClose: vi.fn() };
    const view = render(<RestructureDialog {...props} saveState={IDLE} />);
    await user.click(next());
    await user.click(next());
    view.rerender(<RestructureDialog {...props} saveState={saveState} />);
    return { props, user };
  };

  it('disables the buttons and says it is saving', async () => {
    await summaryWith({ status: 'saving', error: null, locked: false });

    expect(screen.getByRole('button', { name: 'Guardando…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Atrás' })).toBeDisabled();
  });

  it('keeps the summary and offers to retry after a failed save', async () => {
    const { props, user } = await summaryWith({ status: 'error', error: 'Servidor no disponible', locked: false });

    expect(screen.getByRole('alert')).toHaveTextContent('Servidor no disponible');
    expect(screen.getByRole('group', { name: 'Vista previa' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });
});
