import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import DebtWizard from './DebtWizard';

const renderWizard = (props = {}) => {
  const handlers = { onSubmit: vi.fn(), onClose: vi.fn() };
  const view = render(<DebtWizard saveState={{ status: 'idle' }} today="2026-10-12" {...handlers} {...props} />);
  return { ...handlers, view, user: userEvent.setup() };
};

const pick = (user, kind) => user.click(screen.getByRole('button', { name: new RegExp(`^${kind}`) }));
const fillIn = async (user, label, text) => {
  const field = screen.getByLabelText(label);
  await user.clear(field);
  await user.type(field, text);
};
const next = (user) => user.click(screen.getByRole('button', { name: 'Siguiente' }));
const basics = async (user, name = 'Crédito', principal = '1200000') => {
  await fillIn(user, 'Nombre de la deuda', name);
  await fillIn(user, 'Monto del préstamo', principal);
  await next(user);
};
const chooseRate = async (user, convention, value) => {
  await user.selectOptions(screen.getByLabelText('Convención'), convention);
  await fillIn(user, 'Valor de la tasa', value);
};

describe('DebtWizard rate step', () => {
  it('echoes the EA equivalent while the rate is typed, in any convention', async () => {
    const { user } = renderWizard();
    await pick(user, 'Consumo');
    await basics(user);

    await chooseRate(user, 'MV', '2.1');
    expect(screen.getByText('2.1% MV ≈ 28.32% EA')).toBeInTheDocument();

    await chooseRate(user, 'NAMV', '25.2');
    expect(screen.getByText('25.2% NAMV ≈ 28.32% EA')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Convención'), 'custom');
    await user.selectOptions(screen.getByLabelText('Periodo'), 'bimonthly');
    await user.selectOptions(screen.getByLabelText('Pago de intereses'), 'advance');
    expect(screen.getByText(/^25\.2% nominal bimestral anticipada ≈ \d+\.\d{2}% EA$/)).toBeInTheDocument();
  });

  it('warns above the usury cap but lets the user continue to save', async () => {
    const { user, onSubmit } = renderWizard();
    await pick(user, 'Consumo');
    await basics(user, 'Libre inversión', '10000000');
    await fillIn(user, 'Valor de la tasa', '30');

    expect(screen.getByText(/tope de usura/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeEnabled();
    await next(user); await next(user); await next(user);

    expect(screen.getByText(/tope de usura/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Guardar deuda' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('blocks the step with an inline message for an invalid anticipated rate', async () => {
    const { user } = renderWizard();
    await pick(user, 'Consumo');
    await basics(user);

    await chooseRate(user, 'NAMA', '1200');

    expect(screen.getByRole('alert')).toHaveTextContent('menor que 100 % por periodo');
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
    await fillIn(user, 'Valor de la tasa', '24');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeEnabled();
  });
});

describe('DebtWizard validation and review', () => {
  it('disables Siguiente with a message for a negative principal and recovers when fixed', async () => {
    const { user } = renderWizard();
    await pick(user, 'Consumo');
    await fillIn(user, 'Nombre de la deuda', 'Crédito');
    await fillIn(user, 'Monto del préstamo', '-500');

    expect(screen.getByRole('alert')).toHaveTextContent('El monto del préstamo debe ser mayor que cero.');
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
    await fillIn(user, 'Monto del préstamo', '500000');
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeEnabled();
  });

  it('saves a 0% French loan, showing the first installment and zero interest before saving', async () => {
    const { user, onSubmit } = renderWizard();
    await pick(user, 'Familiar');
    await basics(user, 'Préstamo de mamá');
    expect(screen.getByLabelText('Valor de la tasa')).toHaveValue(0);
    await next(user); await next(user);

    const review = screen.getByRole('region', { name: 'Vista previa' });
    expect(within(review).getByText('$ 100.000')).toBeInTheDocument();
    expect(within(review).getByText('12 nov')).toBeInTheDocument();
    expect(within(review).getAllByText('$ 0').length).toBeGreaterThan(0);
    expect(onSubmit).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Guardar deuda' }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Préstamo de mamá', lender: '', ownerScope: 'shared',
      terms: expect.objectContaining({ kind: 'family', system: 'french', principalMinor: 1200000, rate: expect.objectContaining({ value: 0 }) }),
    }));
  });

  it('keeps the form and offers Reintentar after a failed save', async () => {
    const { user, view, onSubmit } = renderWizard();
    await pick(user, 'Informal');
    await basics(user, 'Préstamo de papá');
    await user.click(screen.getByRole('button', { name: 'Guardar deuda' }));
    view.rerender(<DebtWizard saveState={{ status: 'error', error: 'No se pudo guardar. Intenta de nuevo.' }} today="2026-10-12" onSubmit={onSubmit} onClose={vi.fn()} />);

    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo guardar. Intenta de nuevo.');
    expect(screen.getByRole('dialog', { name: 'Nueva deuda' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls[1][0]).toEqual(onSubmit.mock.calls[0][0]);
  });

  it('disables saving while a save is in progress, so a double tap sends one request', async () => {
    const { user, view, onSubmit } = renderWizard();
    await pick(user, 'Informal');
    await basics(user);
    await user.click(screen.getByRole('button', { name: 'Guardar deuda' }));
    view.rerender(<DebtWizard saveState={{ status: 'saving' }} today="2026-10-12" onSubmit={onSubmit} onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Guardando…' })).toBeDisabled();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe('DebtWizard plan and charges', () => {
  it('offers the balloon payment for leasing and the German system for a mortgage', async () => {
    const leasing = renderWizard();
    await pick(leasing.user, 'Leasing');
    await basics(leasing.user);
    await fillIn(leasing.user, 'Valor de la tasa', '15');
    await next(leasing.user);
    expect(screen.getByLabelText('Pago final')).toBeInTheDocument();
    leasing.view.unmount();

    const mortgage = renderWizard();
    await pick(mortgage.user, 'Hipotecario');
    await basics(mortgage.user);
    await fillIn(mortgage.user, 'Valor de la tasa', '12');
    await next(mortgage.user);
    expect(screen.queryByLabelText('Pago final')).not.toBeInTheDocument();
    expect(within(screen.getByLabelText('Sistema de pago')).getByRole('option', { name: /alemán/ })).toBeInTheDocument();
  });

  it('builds a manual plan row by row', async () => {
    const { user, onSubmit } = renderWizard();
    await pick(user, 'Familiar');
    await basics(user, 'Préstamo de un amigo');
    await next(user);
    await user.selectOptions(screen.getByLabelText('Sistema de pago'), 'manual');
    await user.click(screen.getByRole('button', { name: 'Agregar cuota' }));
    await user.click(screen.getByRole('button', { name: 'Agregar cuota' }));
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
    await fillIn(user, 'Fecha de la cuota 1', '2026-12-01');
    await fillIn(user, 'Valor de la cuota 1', '400000');
    await fillIn(user, 'Fecha de la cuota 2', '2027-03-01');
    await fillIn(user, 'Valor de la cuota 2', '800000');
    await next(user);
    await user.click(screen.getByRole('button', { name: 'Guardar deuda' }));

    expect(onSubmit.mock.calls[0][0].terms).toMatchObject({ system: 'manual', n: 2, manualPlan: [['2026-12-01', 400000], ['2027-03-01', 800000]] });
  });

  it('adds insurance and taxes from presets; IVA needs the fee it applies to', async () => {
    const { user, onSubmit } = renderWizard();
    await pick(user, 'Libranza');
    await basics(user);
    await fillIn(user, 'Valor de la tasa', '20');
    await next(user); await next(user);

    expect(screen.getByRole('checkbox', { name: 'IVA sobre la comisión' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Comisión o cuota de manejo' }));
    await fillIn(user, 'Valor de Comisión o cuota de manejo', '10000');
    await user.click(screen.getByRole('checkbox', { name: 'IVA sobre la comisión' }));
    await user.click(screen.getByRole('checkbox', { name: 'GMF (4 x 1000)' }));
    expect(screen.getByLabelText('Valor de GMF (4 x 1000)')).toHaveValue(0.4);
    expect(screen.getByLabelText('Valor de IVA sobre la comisión')).toHaveValue(19);
    await next(user);
    await user.click(screen.getByRole('button', { name: 'Guardar deuda' }));

    expect(onSubmit.mock.calls[0][0].terms.charges.map((charge) => charge.id)).toEqual(['fee', 'iva', 'gmf']);
  });
});
