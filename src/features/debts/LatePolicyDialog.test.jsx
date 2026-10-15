import { project } from '@finance-core';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { formatMoney, formatMonthLabel } from '../../shared/lib/format';
import LatePolicyDialog from './LatePolicyDialog';
import { DAY_10, MORA_DISBURSEMENT, makeMoraCard, makeMoraLoan, usuryLegal } from './debtFixtures';

// The reference loan: principal 199,505 of the first installment is overdue since 2026-02-05. Today is 10 days later.
const DUE_DAY = '2026-02-05';
const IDLE = { status: 'idle', error: null, locked: false };

const setup = ({ late = null, legal, saveState = IDLE, events = [MORA_DISBURSEMENT], today = DAY_10 } = {}) => {
  const debt = makeMoraLoan({ late, ...(legal ? { legal } : {}) });
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  render(<LatePolicyDialog debt={debt} events={events} projection={project(debt, events, today)} today={today} saveState={saveState} onSubmit={onSubmit} onClose={onClose} />);
  return { onSubmit, onClose, user: userEvent.setup() };
};
const setDate = (value) => fireEvent.change(screen.getByLabelText('Vigente desde'), { target: { value } });
const preview = () => within(screen.getByRole('group', { name: 'Vista previa' }));
const rowOf = (name) => preview().getByRole('row', { name: new RegExp(name) });
const save = (name = 'Guardar mora') => screen.getByRole('button', { name });

describe('LatePolicyDialog', () => {
  it('opens on today with the policy in force and nothing to save yet for a debt without mora', () => {
    setup();

    expect(screen.getByRole('heading', { name: 'Configurar mora' })).toBeInTheDocument();
    expect(screen.getByText(/Mora actual: sin mora/)).toBeInTheDocument();
    expect(screen.getByLabelText('Vigente desde')).toHaveValue(DAY_10);
    expect(screen.getByLabelText('Interés de mora')).toHaveValue('none');
    expect(within(screen.getByLabelText('Interés de mora')).getAllByRole('option').map((option) => option.value)).toEqual(['none', 'usury', 'fixed', 'contract_multiple']);
    expect(save()).toBeDisabled();
  });

  it('enabling usury effective 10 days ago previews mora 1,375 on top of what is overdue, warns about the past date and saves one late_policy', async () => {
    const { user, onSubmit } = setup();
    await user.selectOptions(screen.getByLabelText('Interés de mora'), 'usury');
    setDate(DUE_DAY);

    expect(rowOf('Mora acumulada')).toHaveTextContent(`${formatMoney(0)}${formatMoney(1375)}`);
    expect(rowOf('Total vencido')).toHaveTextContent(`${formatMoney(390381)}${formatMoney(391756)}`);
    expect(rowOf('Tasa de mora')).toHaveTextContent('Sin mora28,59 % E.A.');
    expect(screen.getByRole('region', { name: 'Cambio con fecha pasada' })).toBeInTheDocument();
    await user.click(save());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ kind: 'late_policy', effectiveOn: DUE_DAY, late: { mode: 'usury', graceDays: 0 } });
  });

  it('effective today shows mora 0 after, keeps the payment cost rows and does not warn about the past', async () => {
    const { user, onSubmit } = setup();
    await user.selectOptions(screen.getByLabelText('Interés de mora'), 'usury');

    expect(rowOf('Mora acumulada')).toHaveTextContent(`${formatMoney(0)}${formatMoney(0)}`);
    expect(screen.queryByRole('region', { name: 'Cambio con fecha pasada' })).not.toBeInTheDocument();
    await user.click(save());
    expect(onSubmit).toHaveBeenCalledWith({ kind: 'late_policy', effectiveOn: DAY_10, late: { mode: 'usury', graceDays: 0 } });
  });

  it('explains that mora starts the day after the effective date', () => {
    setup();

    expect(screen.getByText('La mora se cobra desde el día siguiente a esta fecha.')).toBeInTheDocument();
  });

  it('grace days change the preview: 3 days leave 962 of mora', async () => {
    const { user } = setup();
    await user.selectOptions(screen.getByLabelText('Interés de mora'), 'usury');
    setDate(DUE_DAY);
    await user.clear(screen.getByLabelText('Días de gracia antes de cobrar mora'));
    await user.type(screen.getByLabelText('Días de gracia antes de cobrar mora'), '3');

    expect(rowOf('Mora acumulada')).toHaveTextContent(formatMoney(962));
  });

  it('a fixed rate asks for the rate before it can be saved, then previews it', async () => {
    const { user, onSubmit } = setup();
    await user.selectOptions(screen.getByLabelText('Interés de mora'), 'fixed');
    setDate(DUE_DAY);

    expect(save()).toBeDisabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Tasa de mora'), '20');
    expect(save()).toBeEnabled();
    expect(rowOf('Mora acumulada')).toHaveTextContent(formatMoney(997));
    await user.click(save());

    expect(onSubmit.mock.calls[0][0].late).toEqual({ mode: 'fixed', graceDays: 0, rate: { value: 20, basis: 'effective', periodicity: 'annual', timing: 'arrears' } });
  });

  it('a multiple of the contract rate accepts up to 3 and blocks anything else with a message', async () => {
    const { user, onSubmit } = setup();
    await user.selectOptions(screen.getByLabelText('Interés de mora'), 'contract_multiple');
    setDate(DUE_DAY);
    const multiple = screen.getByLabelText('Múltiplo de la tasa del contrato');

    await user.type(multiple, '4');
    expect(screen.getByRole('alert')).toHaveTextContent('El múltiplo debe ser mayor que 0 y de hasta 3 veces la tasa del contrato.');
    expect(save()).toBeDisabled();
    await user.clear(multiple);
    await user.type(multiple, '1');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(rowOf('Mora acumulada')).toHaveTextContent(formatMoney(1176));
    await user.click(save());

    expect(onSubmit.mock.calls[0][0].late).toEqual({ mode: 'contract_multiple', graceDays: 0, multiple: 1 });
  });

  it('shows the stale cap notice when the legal table stops before today, and still lets the user save', async () => {
    const { user } = setup({ legal: usuryLegal(['2025-01-01', '2026-01-31', 28.59]) });
    await user.selectOptions(screen.getByLabelText('Interés de mora'), 'usury');

    expect(screen.getByText((text) => text.includes(`último tope vigente (hasta ${formatMonthLabel('2026-01')})`))).toBeInTheDocument();
    expect(save()).toBeEnabled();
  });

  it('shows no cap notice with a current table', async () => {
    const { user } = setup();
    await user.selectOptions(screen.getByLabelText('Interés de mora'), 'usury');

    expect(screen.queryByText(/último tope vigente/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No hay un tope de usura/)).not.toBeInTheDocument();
  });

  it('turning mora off previews the mora that stops, against the policy in force', async () => {
    const { user, onSubmit } = setup({ late: { mode: 'usury', graceDays: 0 } });
    expect(screen.getByText(/Mora actual: tasa máxima legal \(usura\)/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Interés de mora'), 'none');

    expect(rowOf('Mora acumulada')).toHaveTextContent(`${formatMoney(1375)}${formatMoney(1375)}`); // effective today: what accrued stays
    setDate(DUE_DAY);
    expect(rowOf('Mora acumulada')).toHaveTextContent(`${formatMoney(1375)}${formatMoney(0)}`);
    expect(rowOf('Tasa de mora')).toHaveTextContent('28,59 % E.A.Sin mora');
    await user.click(save());
    expect(onSubmit.mock.calls[0][0].late).toEqual({ mode: 'none', graceDays: 0 });
  });

  it('says when the choice changes nothing', () => {
    setup({ late: { mode: 'usury', graceDays: 0 } });

    expect(screen.getByText('Esta política ya está vigente: guardar no cambia la mora.')).toBeInTheDocument();
    expect(save()).toBeDisabled();
  });

  it('blocks an invalid date with a message', () => {
    setup();
    setDate('');

    expect(screen.getByRole('alert')).toHaveTextContent('Elige una fecha válida.');
    expect(save()).toBeDisabled();
  });

  it('shows saving, then the error with Reintentar, and disables the form while it saves', () => {
    const { onSubmit } = setup({ saveState: { status: 'saving', error: null, locked: false } });

    expect(screen.getByRole('button', { name: 'Guardando…' })).toBeDisabled();
    expect(screen.getByLabelText('Interés de mora')).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('offers Reintentar with the server error after a failed save', () => {
    setup({ saveState: { status: 'error', error: 'Servidor no disponible', locked: false } });

    expect(screen.getByText('Servidor no disponible')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });
});

describe('LatePolicyDialog for a card', () => {
  const setupCard = ({ late = null, today = '2026-05-10' } = {}) => {
    const debt = makeMoraCard({ late });
    const onSubmit = vi.fn();
    render(<LatePolicyDialog debt={debt} events={[]} projection={project(debt, [], today)} today={today} saveState={IDLE} onSubmit={onSubmit} onClose={vi.fn()} />);
    return { onSubmit, user: userEvent.setup() };
  };

  it('explains that the mora runs on the unmet capital of the minimum and is billed in the next statement', () => {
    setupCard();

    expect(screen.getByText('En una tarjeta la mora se cobra sobre el capital del pago mínimo que no pagaste a tiempo, desde el día siguiente al límite de pago, y aparece en el siguiente extracto.')).toBeInTheDocument();
  });

  it('does not explain it for a loan', () => {
    setup();

    expect(screen.queryByText(/En una tarjeta la mora/)).not.toBeInTheDocument();
  });

  it('previews the mora of the unmet minimum (861) and saves one late_policy', async () => {
    const { user, onSubmit } = setupCard();
    await user.selectOptions(screen.getByLabelText('Interés de mora'), 'usury');
    setDate('2026-04-30');

    expect(rowOf('Mora acumulada')).toHaveTextContent(`${formatMoney(0)}${formatMoney(861)}`);
    expect(rowOf('Mínimo vencido')).toHaveTextContent(`${formatMoney(146102)}${formatMoney(146102)}`);
    expect(preview().queryByRole('row', { name: /Total vencido/ })).not.toBeInTheDocument();
    await user.click(save());

    expect(onSubmit).toHaveBeenCalledWith({ kind: 'late_policy', effectiveOn: '2026-04-30', late: { mode: 'usury', graceDays: 0 } });
  });
});
