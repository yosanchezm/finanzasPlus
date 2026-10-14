import { resolveLegal } from '@finance-core';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import LegalRatesPanel from './LegalRatesPanel';

const IBC_NOV = { kind: 'ibc', modality: 'consumer', validFrom: '2026-11-01', validTo: '2026-11-30', value: 1949, source: '', verified: false };
const USURY_MORTGAGE = { kind: 'usury', modality: 'mortgage', validFrom: '2026-11-01', validTo: '2026-11-30', value: 2200, source: 'Resolución', verified: true };
const IDLE = { status: 'idle', error: null };

const renderPanel = (overrides = {}) => {
  const props = {
    status: 'ready', legal: resolveLegal([IBC_NOV]), today: '2026-11-15', saveState: IDLE,
    onSave: vi.fn().mockResolvedValue(true), onReload: vi.fn(), ...overrides,
  };
  const { rerender } = render(<LegalRatesPanel {...props} />);
  return { props, user: userEvent.setup(), rerender };
};

const rateForm = () => screen.getByRole('form', { name: 'Registrar tasa legal' });
const smmlvForm = () => screen.getByRole('form', { name: 'Registrar salario mínimo' });
const valueField = () => within(rateForm()).getByLabelText(/^(IBC|Usura)/);

describe('LegalRatesPanel listing', () => {
  it('says the bank statement wins and groups the rates by modality and month with badges', () => {
    renderPanel();

    expect(screen.getByText(/Informativo: el extracto del banco manda/)).toBeInTheDocument();
    const consumer = screen.getByRole('region', { name: 'Consumo y ordinario' });
    const [nov, oct] = within(consumer).getAllByRole('listitem');
    expect(nov).toHaveTextContent('noviembre de 2026');
    expect(nov).toHaveTextContent('29,24 % E.A.');
    expect(nov).toHaveTextContent('IBC 19,49 %');
    expect(nov).toHaveTextContent('Derivada del IBC');
    expect(nov).toHaveTextContent('Sin verificar');
    expect(oct).toHaveTextContent('octubre de 2026');
    expect(oct).toHaveTextContent('28,59 % E.A.');
    expect(oct).toHaveTextContent('Valor de la app');
    expect(oct).not.toHaveTextContent('Sin verificar');
  });

  it('badges a manual usury as manual', () => {
    const manual = { kind: 'usury', modality: 'consumer', validFrom: '2026-11-01', validTo: '2026-11-30', value: 2900, source: 'x', verified: true };
    renderPanel({ legal: resolveLegal([IBC_NOV, manual]) });

    const [nov] = within(screen.getByRole('region', { name: 'Consumo y ordinario' })).getAllByRole('listitem');
    expect(nov).toHaveTextContent('29,00 % E.A.');
    expect(nov).toHaveTextContent('Usura manual');
    expect(nov).not.toHaveTextContent('Derivada del IBC');
  });

  it('shows the carried cap with a stale badge and prompts to update the current month', async () => {
    const { user } = renderPanel({ today: '2026-12-10' });
    const consumer = screen.getByRole('region', { name: 'Consumo y ordinario' });

    expect(within(consumer).getByText('Desactualizada: usando la de noviembre de 2026')).toBeInTheDocument();
    await user.click(within(consumer).getByRole('button', { name: 'Actualizar diciembre de 2026' }));

    expect(within(rateForm()).getByLabelText('Mes')).toHaveValue('2026-12');
    expect(within(rateForm()).getByLabelText('Modalidad')).toHaveValue('consumer');
    expect(valueField()).toHaveFocus();
  });

  it('shows no stale prompt while the current month has a row', () => {
    renderPanel({ today: '2026-11-15' });

    expect(screen.queryByText(/Desactualizada/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Actualizar/ })).not.toBeInTheDocument();
  });

  it('asks for a mortgage usury until one is entered, and opens the form for it', async () => {
    const { user } = renderPanel();

    expect(screen.getByText(/Hipotecario: aún no hay tope de usura/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Registrar tope hipotecario' }));

    expect(within(rateForm()).getByLabelText('Modalidad')).toHaveValue('mortgage');
    expect(valueField()).toHaveAccessibleName(/^Usura/);
  });

  it('drops the mortgage prompt once a mortgage cap exists', () => {
    renderPanel({ legal: resolveLegal([IBC_NOV, USURY_MORTGAGE]) });

    expect(screen.queryByText(/aún no hay tope de usura/)).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Hipotecario' })).getByText('22,00 % E.A.')).toBeInTheDocument();
  });

  it('lists the SMMLV by year and prompts when the current year is missing', async () => {
    const { user } = renderPanel({ today: '2027-02-10' });
    const smmlv = screen.getByRole('region', { name: 'Salario mínimo (SMMLV)' });

    const [row] = within(smmlv).getAllByRole('listitem');
    expect(row).toHaveTextContent('2026');
    expect(row).toHaveTextContent('$ 1.750.905');
    expect(row).toHaveTextContent('Valor de la app');
    expect(within(smmlv).getByText('Desactualizado: usando el de 2026')).toBeInTheDocument();
    await user.click(within(smmlv).getByRole('button', { name: 'Registrar SMMLV 2027' }));

    expect(within(smmlvForm()).getByLabelText('Año')).toHaveValue('2027');
  });
});

describe('LegalRatesPanel rate form', () => {
  it('echoes the derived usury while typing an IBC, before saving anything', async () => {
    const { props, user } = renderPanel();

    await user.type(valueField(), '19,49');

    expect(screen.getByText('Usura = 29,24 % E.A.')).toBeInTheDocument();
    expect(props.onSave).not.toHaveBeenCalled();
    await user.clear(valueField());
    await user.type(valueField(), '19.06');
    expect(screen.getByText('Usura = 28,59 % E.A.')).toBeInTheDocument();
  });

  it('echoes nothing when the member types the usury itself', async () => {
    const { user } = renderPanel();

    await user.click(within(rateForm()).getByRole('button', { name: 'Usura' }));
    await user.type(valueField(), '29,24');

    expect(screen.queryByText(/^Usura = /)).not.toBeInTheDocument();
    expect(within(rateForm()).getByRole('button', { name: 'Guardar tasa' })).toBeEnabled();
  });

  it.each([
    ['4', 'La tasa debe estar entre 5,00 % y 100,00 % E.A.'],
    ['19,495', 'Escribe la tasa como porcentaje, por ejemplo 19,49.'],
  ])('disables save with an inline message for %j', async (text, message) => {
    const { user } = renderPanel();

    await user.type(valueField(), text);

    expect(screen.getByText(message)).toBeInTheDocument();
    expect(valueField()).toBeInvalid();
    expect(within(rateForm()).getByRole('button', { name: 'Guardar tasa' })).toBeDisabled();
    await user.clear(valueField());
    await user.type(valueField(), '19,49');
    expect(screen.queryByText(message)).not.toBeInTheDocument();
    expect(within(rateForm()).getByRole('button', { name: 'Guardar tasa' })).toBeEnabled();
  });

  it('keeps save disabled without a message while the value is empty', () => {
    renderPanel();

    expect(within(rateForm()).getByRole('button', { name: 'Guardar tasa' })).toBeDisabled();
    expect(within(rateForm()).queryByText(/La tasa debe/)).not.toBeInTheDocument();
  });

  it('saves the IBC as basis points for the whole month, then clears the value', async () => {
    const { props, user } = renderPanel();

    await user.type(valueField(), '19,49');
    await user.click(within(rateForm()).getByRole('button', { name: 'Guardar tasa' }));

    expect(props.onSave).toHaveBeenCalledWith({
      kind: 'ibc', modality: 'consumer', validFrom: '2026-11-01', validTo: '2026-11-30', value: 1949, source: '', verified: false,
    });
    expect(valueField()).toHaveValue('');
  });

  it('sends the source and the Verificado checkbox', async () => {
    const { props, user } = renderPanel();

    await user.click(within(rateForm()).getByRole('button', { name: 'Usura' }));
    await user.selectOptions(within(rateForm()).getByLabelText('Modalidad'), 'mortgage');
    await user.type(valueField(), '22');
    await user.type(within(rateForm()).getByLabelText('Fuente (opcional)'), 'Resolución 1472');
    await user.click(within(rateForm()).getByRole('checkbox', { name: 'Verificado' }));
    await user.click(within(rateForm()).getByRole('button', { name: 'Guardar tasa' }));

    expect(props.onSave).toHaveBeenCalledWith({
      kind: 'usury', modality: 'mortgage', validFrom: '2026-11-01', validTo: '2026-11-30', value: 2200, source: 'Resolución 1472', verified: true,
    });
  });

  it('keeps what was typed and offers Reintentar when the save fails', async () => {
    const { props, user, rerender } = renderPanel({ onSave: vi.fn().mockResolvedValue(false) });
    await user.type(valueField(), '19,49');
    await user.click(within(rateForm()).getByRole('button', { name: 'Guardar tasa' }));

    rerender(<LegalRatesPanel {...props} saveState={{ status: 'error', error: 'No se pudo guardar.' }} />);

    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo guardar.');
    expect(valueField()).toHaveValue('19,49');
    await user.click(within(rateForm()).getByRole('button', { name: 'Reintentar' }));
    expect(props.onSave).toHaveBeenCalledTimes(2);
    expect(within(smmlvForm()).getByRole('button', { name: 'Guardar salario mínimo' })).toBeDisabled();
    expect(within(smmlvForm()).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('disables the form button while a save is running', async () => {
    const { props, user, rerender } = renderPanel({ onSave: vi.fn(() => new Promise(() => {})) });
    await user.type(valueField(), '19,49');
    await user.click(within(rateForm()).getByRole('button', { name: 'Guardar tasa' }));

    rerender(<LegalRatesPanel {...props} saveState={{ status: 'saving', error: null }} />);

    expect(within(rateForm()).getByRole('button', { name: 'Guardando…' })).toBeDisabled();
  });

  it('warns that past mora costs may change when the month is in the past, and only then', () => {
    renderPanel({ today: '2026-11-15' });
    const month = within(rateForm()).getByLabelText('Mes');

    expect(screen.queryByText(/mes pasado/)).not.toBeInTheDocument();
    fireEvent.change(month, { target: { value: '2026-09' } });
    expect(screen.getByText(/Estás editando un mes pasado/)).toHaveTextContent('se recalculan al abrir cada deuda');
    fireEvent.change(month, { target: { value: '2026-12' } });
    expect(screen.queryByText(/mes pasado/)).not.toBeInTheDocument();
  });

  it('says a manual usury already wins over an IBC for that month, and that saving replaces a stored row', async () => {
    const manual = { kind: 'usury', modality: 'consumer', validFrom: '2026-11-01', validTo: '2026-11-30', value: 2900, source: 'x', verified: true };
    const { user } = renderPanel({ legal: resolveLegal([manual]) });

    expect(screen.getByText('Ya hay una usura manual para este mes: manda sobre el IBC.')).toBeInTheDocument();
    await user.click(within(rateForm()).getByRole('button', { name: 'Usura' }));
    expect(screen.queryByText(/manda sobre el IBC/)).not.toBeInTheDocument();
    expect(screen.getByText('Ya hay una tasa guardada para este mes: al guardar se reemplaza.')).toBeInTheDocument();
    fireEvent.change(within(rateForm()).getByLabelText('Mes'), { target: { value: '2027-03' } });
    expect(screen.queryByText(/Ya hay una/)).not.toBeInTheDocument();
  });

  it('prefills the form from Editar with the stored IBC, or the manual usury', async () => {
    const manual = { kind: 'usury', modality: 'mortgage', validFrom: '2026-10-01', validTo: '2026-10-31', value: 2150, source: 'x', verified: true };
    const { user } = renderPanel({ legal: resolveLegal([IBC_NOV, manual]) });

    await user.click(screen.getByRole('button', { name: 'Editar Consumo y ordinario, noviembre de 2026' }));
    expect(within(rateForm()).getByLabelText('Mes')).toHaveValue('2026-11');
    expect(within(rateForm()).getByRole('button', { name: 'IBC' })).toHaveAttribute('aria-pressed', 'true');
    expect(valueField()).toHaveValue('19,49');

    await user.click(screen.getByRole('button', { name: 'Editar Hipotecario, octubre de 2026' }));
    expect(within(rateForm()).getByLabelText('Modalidad')).toHaveValue('mortgage');
    expect(valueField()).toHaveAccessibleName(/^Usura/);
    expect(valueField()).toHaveValue('21,50');
  });

  it('never offers the IBC for a mortgage', async () => {
    const { user } = renderPanel();

    await user.selectOptions(within(rateForm()).getByLabelText('Modalidad'), 'mortgage');

    expect(within(rateForm()).queryByRole('button', { name: 'IBC' })).not.toBeInTheDocument();
    expect(within(rateForm()).getByText(/la usura se escribe, no se deriva del IBC/)).toBeInTheDocument();
  });
});

describe('LegalRatesPanel SMMLV form', () => {
  const type = async (user, year, value) => {
    const form = within(smmlvForm());
    await user.clear(form.getByLabelText('Año'));
    await user.type(form.getByLabelText('Año'), year);
    await user.type(form.getByLabelText('Valor mensual (COP)'), value);
  };

  it('saves a whole year in pesos', async () => {
    const { props, user } = renderPanel();

    await type(user, '2027', '1.900.000');
    await user.click(within(smmlvForm()).getByRole('checkbox', { name: 'Verificado' }));
    await user.click(within(smmlvForm()).getByRole('button', { name: 'Guardar salario mínimo' }));

    expect(props.onSave).toHaveBeenCalledWith({
      kind: 'smmlv', modality: 'all', validFrom: '2027-01-01', validTo: '2027-12-31', value: 1900000, source: '', verified: true,
    });
  });

  it.each([
    ['2027', '50.000', 'El salario mínimo debe estar entre $ 100.000 y $ 100.000.000.'],
    ['27', '1.900.000', 'Escribe un año de cuatro cifras.'],
  ])('disables save for year %j and value %j with an inline message', async (year, value, message) => {
    const { user } = renderPanel();

    await type(user, year, value);

    expect(screen.getByText(message)).toBeInTheDocument();
    expect(within(smmlvForm()).getByRole('button', { name: 'Guardar salario mínimo' })).toBeDisabled();
  });
});

describe('LegalRatesPanel SMMLV rows', () => {
  it('prefills the form from Editar with the stored year and pesos', async () => {
    const stored = { kind: 'smmlv', modality: 'all', validFrom: '2027-01-01', validTo: '2027-12-31', value: 1900000, source: 'Decreto', verified: true };
    const { user } = renderPanel({ legal: resolveLegal([stored]) });

    await user.click(screen.getByRole('button', { name: 'Editar SMMLV 2027' }));

    const form = within(smmlvForm());
    expect(form.getByLabelText('Año')).toHaveValue('2027');
    expect(form.getByLabelText('Valor mensual (COP)')).toHaveValue('1900000');
    expect(form.getByLabelText('Fuente (opcional)')).toHaveValue('Decreto');
    expect(form.getByRole('checkbox', { name: 'Verificado' })).toBeChecked();
    expect(form.getByLabelText('Valor mensual (COP)')).toHaveFocus();
  });
});

describe('LegalRatesPanel degraded states', () => {
  it('tells the member to update the database when the table is missing, shows the app values read-only', () => {
    renderPanel({ status: 'missing', legal: resolveLegal.unavailable() });

    expect(screen.getByText('Falta actualizar la base de datos')).toBeInTheDocument();
    expect(screen.getByText(/Mientras tanto se usan los valores de la app/)).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Consumo y ordinario' })).getByText('28,59 % E.A.')).toBeInTheDocument();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Editar/ })).not.toBeInTheDocument();
  });

  it('offers Reintentar when the rates could not be read', async () => {
    const { props, user } = renderPanel({ status: 'unavailable', legal: resolveLegal.unavailable() });

    expect(screen.getByText('No pudimos leer las tasas legales')).toBeInTheDocument();
    expect(screen.queryByText('Falta actualizar la base de datos')).not.toBeInTheDocument();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(props.onReload).toHaveBeenCalledTimes(1);
  });

  it('shows a loading placeholder before the rates arrive', () => {
    renderPanel({ status: 'loading', legal: null });

    expect(screen.getByRole('status', { name: 'Cargando tasas legales…' })).toBeInTheDocument();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });
});
