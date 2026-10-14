import { normalizeCharges } from '@finance-core';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import ChargesEditor from './ChargesEditor';
import { draftsFromCharges, validateCharges } from './chargesEditorModel';

const CHARGES = normalizeCharges([
  { id: 'fee', kind: 'fee', label: 'Comisión', basis: 'fixed', value: 10000, cadence: 'per_installment' },
  { id: 'iva', kind: 'tax', label: 'IVA sobre la comisión', basis: 'pctOfCharge', refId: 'fee', value: 19, cadence: 'per_installment' },
  { id: 'life', kind: 'insurance', label: 'Seguro de vida', basis: 'pctOutstanding', value: 0.05, cadence: 'per_installment' },
]);

// Holds the drafts like the dialog does, and reports every change so the tests can read the real charges they produce.
function Harness({ initial, onRows, ...props }) {
  const [rows, setRows] = useState(initial);
  return <ChargesEditor rows={rows} onChange={(next) => { setRows(next); onRows(next); }} {...props} />;
}
const setup = ({ charges = CHARGES, ...props } = {}) => {
  const onRows = vi.fn();
  render(<Harness initial={draftsFromCharges(charges)} onRows={onRows} {...props} />);
  const latest = () => validateCharges(onRows.mock.calls.at(-1)[0]);
  return { onRows, latest, user: userEvent.setup() };
};
const chargeOf = (name) => screen.getByRole('group', { name });
const typeInto = async (user, field, text) => { await user.clear(field); await user.type(field, text); };

describe('ChargesEditor rows', () => {
  it('shows each real charge with its name, kind, calculation, value and unit', () => {
    setup();

    const fee = within(chargeOf('Comisión'));
    expect(fee.getByLabelText('Nombre')).toHaveValue('Comisión');
    expect(fee.getByLabelText('Tipo')).toHaveValue('fee');
    expect(fee.getByLabelText('Se calcula como')).toHaveValue('fixed');
    expect(fee.getByLabelText('Valor')).toHaveValue('10000');
    const life = within(chargeOf('Seguro de vida'));
    expect(life.getByLabelText('Se calcula como')).toHaveValue('pctOutstanding');
    expect(life.getByLabelText('Valor')).toHaveValue('0,05');
    expect(within(chargeOf('IVA sobre la comisión')).getByLabelText('Base')).toHaveValue('fee');
  });

  it('changes a fee from 10,000 to 12,000 and reports the real charges, the others untouched', async () => {
    const { user, latest } = setup();

    await typeInto(user, within(chargeOf('Comisión')).getByLabelText('Valor'), '12000');

    expect(latest().ok).toBe(true);
    expect(latest().charges).toEqual([{ ...CHARGES[0], value: 12000 }, CHARGES[1], CHARGES[2]]);
  });

  it('takes a percentage with a comma decimal as typed', async () => {
    const { user, latest } = setup();

    await typeInto(user, within(chargeOf('Seguro de vida')).getByLabelText('Valor'), '0,07');

    expect(latest().charges[2].value).toBe(0.07);
  });

  it('keeps the cadence and the periods of a charge in "Más opciones" and lets them be edited', async () => {
    const annual = normalizeCharges([{ id: 'seg', kind: 'insurance', label: 'Seguro anual', basis: 'fixed', value: 120000, cadence: 'annual', fromPeriod: 3, toPeriod: 24 }]);
    const { user, latest } = setup({ charges: annual });
    const row = within(chargeOf('Seguro anual'));

    expect(row.getByLabelText('Frecuencia')).toHaveValue('annual');
    expect(row.getByLabelText('Desde la cuota')).toHaveValue('3');
    expect(row.getByLabelText('Hasta la cuota')).toHaveValue('24');

    await typeInto(user, row.getByLabelText('Hasta la cuota'), '36');
    await user.selectOptions(row.getByLabelText('Frecuencia'), 'once');

    expect(latest().charges[0]).toMatchObject({ cadence: 'once', fromPeriod: 3, toPeriod: 36 });
  });

  it('says there are no charges yet when the set is empty', () => {
    setup({ charges: [] });

    expect(screen.getByText('Esta deuda no tiene seguros ni cargos.')).toBeInTheDocument();
    expect(screen.getAllByRole('group').map((group) => group.getAttribute('aria-label'))).toEqual(['Agregar un cargo']); // no charge rows
  });
});

describe('ChargesEditor "% de otro cargo"', () => {
  it('offers only the charges listed before it as the base and stores the one picked', async () => {
    const { user, latest } = setup();
    const life = within(chargeOf('Seguro de vida'));

    await user.selectOptions(life.getByLabelText('Se calcula como'), 'pctOfCharge');

    const base = life.getByLabelText('Base');
    expect(within(base).getAllByRole('option').map((option) => option.textContent)).toEqual(['Comisión', 'IVA sobre la comisión']);
    expect(base).toHaveValue('fee');
    await user.selectOptions(base, 'iva');
    expect(latest().charges[2]).toMatchObject({ basis: 'pctOfCharge', refId: 'iva', value: 0.05 });
  });

  it('shows the dangling reference inline and marks the field invalid', () => {
    const [, iva, life] = draftsFromCharges(CHARGES); // the fee is gone
    render(<ChargesEditor rows={[iva, life]} onChange={() => {}} />);

    const base = within(chargeOf('IVA sobre la comisión')).getByLabelText('Base');
    expect(base).toBeInvalid();
    expect(within(chargeOf('IVA sobre la comisión')).getByText('«IVA sobre la comisión» necesita un cargo anterior como base. Elige uno o quítalo.')).toBeInTheDocument();
    expect(within(chargeOf('Seguro de vida')).getByLabelText('Valor')).toBeValid();
  });
});

describe('ChargesEditor removal', () => {
  it('removes a charge nobody depends on right away', async () => {
    const { user, latest } = setup();

    await user.click(screen.getByRole('button', { name: 'Quitar Seguro de vida' }));

    expect(screen.queryByRole('group', { name: 'Seguro de vida' })).not.toBeInTheDocument();
    expect(latest().charges.map((charge) => charge.id)).toEqual(['fee', 'iva']);
  });

  it('names the charges that go with a fee and removes them all only after confirming', async () => {
    const { user, latest } = setup();

    await user.click(screen.getByRole('button', { name: 'Quitar Comisión' }));

    const confirm = screen.getByRole('group', { name: 'Confirmar que se quitan varios cargos' });
    expect(confirm).toHaveTextContent('Al quitar «Comisión» también se quita «IVA sobre la comisión», que depende de ella.');
    expect(screen.getByRole('group', { name: 'Comisión' })).toBeInTheDocument();

    await user.click(within(confirm).getByRole('button', { name: 'Quitar todo' }));

    expect(latest().charges.map((charge) => charge.id)).toEqual(['life']);
    expect(screen.queryByRole('group', { name: 'Confirmar que se quitan varios cargos' })).not.toBeInTheDocument();
  });

  it('keeps everything when the removal is declined', async () => {
    const { user, onRows } = setup();

    await user.click(screen.getByRole('button', { name: 'Quitar Comisión' }));
    await user.click(screen.getByRole('button', { name: 'Conservar' }));

    expect(onRows).not.toHaveBeenCalled();
    expect(screen.getByRole('group', { name: 'IVA sobre la comisión' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Confirmar que se quitan varios cargos' })).not.toBeInTheDocument();
  });
});

describe('ChargesEditor additions', () => {
  const addable = () => within(screen.getByRole('group', { name: 'Agregar un cargo' })).getAllByRole('button').map((button) => button.textContent);

  it('offers the wizard presets still missing, the IVA only with a fee, and always a custom charge', async () => {
    const { user } = setup({ charges: [] });
    expect(addable()).toEqual(['Seguro de vida', 'Otro seguro', 'Comisión o cuota de manejo', 'GMF (4 x 1000)', 'Otro cargo']);

    await user.click(screen.getByRole('button', { name: 'Comisión o cuota de manejo' }));

    expect(addable()).toEqual(['Seguro de vida', 'Otro seguro', 'IVA sobre la comisión', 'GMF (4 x 1000)', 'Otro cargo']);
  });

  it('adds an IVA preset on the fee at 19 % and asks for the fee value inline', async () => {
    const { user, latest } = setup({ charges: [] });

    await user.click(screen.getByRole('button', { name: 'Comisión o cuota de manejo' }));
    await user.click(screen.getByRole('button', { name: 'IVA sobre la comisión' }));

    expect(within(chargeOf('IVA sobre la comisión')).getByLabelText('Valor')).toHaveValue('19');
    expect(within(chargeOf('IVA sobre la comisión')).getByLabelText('Base')).toHaveValue('fee');
    expect(within(chargeOf('Comisión o cuota de manejo')).getByText('Escribe un valor en pesos, sin decimales.')).toBeInTheDocument();
    expect(latest().ok).toBe(false);

    await typeInto(user, within(chargeOf('Comisión o cuota de manejo')).getByLabelText('Valor'), '9500');
    expect(latest().charges.map((charge) => [charge.id, charge.value])).toEqual([['fee', 9500], ['iva', 19]]);
  });

  it('adds a blank custom charge that asks for a name and a value', async () => {
    const { user, latest } = setup({ charges: [] });

    await user.click(screen.getByRole('button', { name: 'Otro cargo' }));

    const row = within(chargeOf('Cargo nuevo'));
    expect(row.getByText('Escribe un nombre.')).toBeInTheDocument();
    await user.type(row.getByLabelText('Nombre'), 'Aval');
    await user.type(within(chargeOf('Aval')).getByLabelText('Valor'), '5000');
    expect(latest().charges).toEqual(normalizeCharges([{ id: 'extra', kind: 'other', label: 'Aval', basis: 'fixed', value: 5000 }]));
  });
});

describe('ChargesEditor disabled', () => {
  it('freezes every control while saving', () => {
    render(<ChargesEditor rows={draftsFromCharges(CHARGES)} onChange={() => {}} disabled />);

    for (const control of [...screen.getAllByRole('textbox'), ...screen.getAllByRole('combobox'), ...screen.getAllByRole('button')]) {
      expect(control).toBeDisabled();
    }
  });
});
