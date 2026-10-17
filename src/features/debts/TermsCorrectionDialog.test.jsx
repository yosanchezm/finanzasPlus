import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import TermsCorrectionDialog from './TermsCorrectionDialog';
import { serializeTerms } from '@finance-core';
import { CARD_TERMS, makeCard, makeDebt, makeEvent, makeMoraCard } from './debtFixtures';

const TODAY = '2026-06-01';
const IDLE = { status: 'idle', error: null, locked: false };

const setup = ({ debt = makeDebt(), events = [], saveState = IDLE, ...props } = {}) => {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  render(<TermsCorrectionDialog debt={debt} events={events} today={TODAY} saveState={saveState} onSubmit={onSubmit} onClose={onClose} {...props} />);
  return { onSubmit, onClose, user: userEvent.setup() };
};
const field = (name) => screen.getByLabelText(name);
const typeInto = async (user, name, text) => { await user.clear(field(name)); await user.type(field(name), text); };
const preview = () => screen.getByRole('group', { name: 'Vista previa' });
const rowOf = (name) => within(preview()).getByRole('row', { name: new RegExp(name) });
const save = (name = 'Guardar corrección') => screen.getByRole('button', { name });

describe('TermsCorrectionDialog: the last statement of a card', () => {
  it('corrects the date of the last statement and saves the draft that moves the card to it', async () => {
    const debt = makeCard({ termsJson: serializeTerms({ ...CARD_TERMS, principalMinor: 3268319, openedOn: '2026-10-16', card: { ...CARD_TERMS.card, statementDay: 15, dueDay: 3, deferred: [] } }) });
    const { user, onSubmit } = setup({ debt, today: '2026-10-16' });

    expect(field('Fecha del último corte')).toHaveValue('2026-10-16');
    expect(field('Pago mínimo del extracto (opcional)')).toHaveValue(null);
    fireEvent.change(field('Fecha del último corte'), { target: { value: '2026-10-15' } });

    expect(rowOf('Fecha del último corte')).toBeInTheDocument();
    expect(rowOf('Próximo pago mínimo')).toBeInTheDocument();
    await user.click(save());
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'terms_correction', fields: { card: { lastStatementOn: '2026-10-15' } }, previous: { card: { lastStatementOn: '2026-10-16' } } }));
  });
});

describe('TermsCorrectionDialog: a card', () => {
  it('prefills the stored values and previews day 15 to 20 before anything is saved', async () => {
    const { user, onSubmit } = setup({ debt: makeCard() });

    expect(field('Día de corte')).toHaveValue(15);
    expect(field('Día límite de pago')).toHaveValue(30);
    expect(field('Porcentaje del pago mínimo (%)')).toHaveValue(5);
    expect(field('Pago mínimo de al menos (opcional)')).toHaveValue(20000);
    expect(field('Valor de la tasa')).toHaveValue(28);
    expect(save()).toBeDisabled();
    expect(screen.queryByRole('group', { name: 'Vista previa' })).not.toBeInTheDocument();

    await typeInto(user, 'Día de corte', '20');

    expect(rowOf('Día de corte')).toHaveTextContent('1520');
    expect(onSubmit).not.toHaveBeenCalled();
    await user.click(save());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'terms_correction', effectiveOn: TODAY, fields: { card: { statementDay: 20 } }, previous: { card: { statementDay: 15 } }, appliesTo: 'opening',
    }));
  });

  it('lists the past payments whose cost changes with a corrected minimum', async () => {
    const payment = makeEvent('p1', 'payment', '2026-05-20', 140000);
    const { user } = setup({ debt: makeMoraCard(), events: [payment] });
    await typeInto(user, 'Porcentaje del pago mínimo (%)', '3');

    const impacted = screen.getByRole('region', { name: 'Pagos ya registrados que cambian de costo' });
    expect(within(impacted).getByText('Pago del 20 may')).toBeInTheDocument();
    expect(impacted).toHaveTextContent('Costo financiero');
    expect(rowOf('Pago mínimo')).toHaveTextContent('5 %3 %');
  });

  it('shows no impacted section when no past cost changes', async () => {
    const { user } = setup({ debt: makeMoraCard() });
    await typeInto(user, 'Día límite de pago', '25');

    expect(rowOf('Día de pago')).toHaveTextContent('3025');
    expect(screen.queryByRole('region', { name: 'Pagos ya registrados que cambian de costo' })).not.toBeInTheDocument();
  });

  it('warns about the statements already recorded when the cut day changes', async () => {
    const statements = [makeEvent('a1', 'adjustment', '2026-04-15', 0, { balanceMinor: 1621102 }), makeEvent('a2', 'adjustment', '2026-05-15', 0, { balanceMinor: 1000000 })];
    const { user } = setup({ debt: makeCard(), events: statements });
    await typeInto(user, 'Día de corte', '20');

    expect(screen.getByText('Tienes 2 extractos registrados; revisa que coincidan.')).toBeInTheDocument();
    await user.clear(field('Día de corte'));
    await user.type(field('Día de corte'), '15');
    expect(screen.queryByText(/extractos registrados/)).not.toBeInTheDocument();
  });

  it('hides the percentage when the minimum is not a percentage rule and writes the rule it was changed to', async () => {
    const { user, onSubmit } = setup({ debt: makeCard() });
    await user.selectOptions(field('Cómo se calcula tu pago mínimo'), 'installments_due');

    expect(screen.queryByLabelText('Porcentaje del pago mínimo (%)')).not.toBeInTheDocument();
    await user.click(save());
    expect(onSubmit.mock.calls[0][0].fields).toEqual({ card: { minPayment: { rule: 'installments_due' } } });
  });
});

describe('TermsCorrectionDialog: a loan and the common rules', () => {
  it('shows the rate and the modality, and hides the statement day, due day and minimum rule', () => {
    setup();

    expect(field('Valor de la tasa')).toHaveValue(24);
    expect(field('Modalidad')).toHaveValue('consumer');
    expect(screen.queryByLabelText('Día de corte')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Día límite de pago')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Cómo se calcula tu pago mínimo')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/cupo|avance|penalidad/i)).not.toBeInTheDocument(); // unsupported fields never appear
  });

  it('says the correction applies from the start of the debt and that a real change uses Cambiar tasa', () => {
    setup();

    expect(screen.getByText(/desde el inicio de la deuda/)).toBeInTheDocument();
    expect(screen.getByText(/«Cambiar tasa»/)).toBeInTheDocument();
  });

  it('echoes the rate the bank states: 25,2 % N.M.V. is about 28,32 % E.A., and the preview moves', async () => {
    const { user, onSubmit } = setup({ debt: makeDebt({}, { rate: { value: 28.32, basis: 'effective', periodicity: 'annual', timing: 'arrears' } }) });
    await user.selectOptions(field('Convención'), 'NAMV');
    await typeInto(user, 'Valor de la tasa', '25.2');

    expect(screen.getByText(/Equivale a/)).toHaveTextContent('25.2% NAMV');
    expect(rowOf('Tasa')).toHaveTextContent('28,32 % E.A.25,2 % N.M.V.');
    await user.click(save());
    expect(onSubmit.mock.calls[0][0].fields).toEqual({ rate: { value: 25.2, basis: 'nominal', periodicity: 'monthly', timing: 'arrears' } });
  });

  it('disables saving with an inline message when the values equal the stored ones', async () => {
    const { user, onSubmit } = setup({ debt: makeCard() });

    await typeInto(user, 'Día de corte', '20');
    expect(save()).toBeEnabled();
    await typeInto(user, 'Día de corte', '15');

    expect(save()).toBeDisabled();
    expect(screen.getByText('Los datos son iguales a los guardados. Cambia al menos uno para guardar.')).toBeInTheDocument();
    fireEvent.submit(save().closest('form'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('explains an invalid value and keeps saving disabled', async () => {
    const { user } = setup({ debt: makeCard() });
    await typeInto(user, 'Día de corte', '40');

    expect(screen.getByRole('alert')).toHaveTextContent('Los días de corte y de pago van del 1 al 31.');
    expect(save()).toBeDisabled();
    expect(screen.queryByRole('group', { name: 'Vista previa' })).not.toBeInTheDocument();
  });

  it('shows a write error with a retry that submits the same draft, and locks the button while saving', async () => {
    const { user, onSubmit } = setup({ debt: makeCard(), saveState: { status: 'error', error: 'Servidor no disponible', locked: false } });
    await typeInto(user, 'Día de corte', '20');

    expect(screen.getByRole('alert')).toHaveTextContent('Servidor no disponible');
    await user.click(save('Reintentar'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('disables the form and the button while saving', () => {
    setup({ debt: makeCard(), saveState: { status: 'saving', error: null, locked: false } });

    expect(screen.getByRole('button', { name: 'Guardando…' })).toBeDisabled();
    expect(field('Día de corte')).toBeDisabled();
  });
});
