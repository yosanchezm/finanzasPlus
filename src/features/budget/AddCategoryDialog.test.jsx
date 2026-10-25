import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CATEGORY_PALETTE } from '../../shared/lib/categories';
import AddCategoryDialog from './AddCategoryDialog';

const renderDialog = (overrides = {}) => {
  const props = {
    existingNames: ['Mercado'],
    onClose: vi.fn(),
    onSubmit: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  render(<AddCategoryDialog {...props} />);
  return { props, user: userEvent.setup() };
};

describe('AddCategoryDialog', () => {
  it('offers only the palette colors as swatches', () => {
    renderDialog();

    const colors = within(screen.getByRole('radiogroup', { name: 'Color' })).getAllByRole('radio');
    expect(colors).toHaveLength(CATEGORY_PALETTE.length);
    expect(colors.map((radio) => radio.value)).toEqual(CATEGORY_PALETTE);
    expect(colors[0]).toBeChecked();
  });

  it('submits name, kind, color and icon', async () => {
    const { props, user } = renderDialog();

    await user.type(screen.getByLabelText('Nombre'), '  Mascotas ');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Tipo' }), 'income');
    await user.click(screen.getByRole('radio', { name: 'Morado' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Icono (opcional)' }), 'sparkles');
    await user.click(screen.getByRole('button', { name: 'Crear categoría' }));

    expect(props.onSubmit).toHaveBeenCalledWith({ name: 'Mascotas', kind: 'income', color: '#7A5AF8', icon: 'sparkles' });
  });

  it('offers the expense groups and income, never the system-owned debt kind', () => {
    renderDialog();

    const options = within(screen.getByRole('combobox', { name: 'Tipo' })).getAllByRole('option');
    expect(options.map((option) => [option.value, option.textContent])).toEqual([
      ['need', 'Necesidades'], ['want', 'Gustos'], ['saving', 'Ahorro'], ['investment', 'Inversión'], ['income', 'Ingreso'],
    ]);
  });

  it('stores the chosen group as the category kind', async () => {
    const { props, user } = renderDialog();

    await user.type(screen.getByLabelText('Nombre'), 'ETF');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Tipo' }), 'investment');
    await user.click(screen.getByRole('button', { name: 'Crear categoría' }));

    expect(props.onSubmit).toHaveBeenCalledWith({ name: 'ETF', kind: 'investment', color: CATEGORY_PALETTE[0], icon: '' });
  });

  it('defaults to an expense category without icon', async () => {
    const { props, user } = renderDialog();

    await user.type(screen.getByLabelText('Nombre'), 'Salud');
    await user.click(screen.getByRole('button', { name: 'Crear categoría' }));

    expect(props.onSubmit).toHaveBeenCalledWith({ name: 'Salud', kind: 'need', color: CATEGORY_PALETTE[0], icon: '' });
  });

  it('rejects a name that only differs in accents, case or spaces', async () => {
    const { props, user } = renderDialog({ existingNames: ['Alimentación'] });

    await user.type(screen.getByLabelText('Nombre'), '  ALIMENTACION ');
    await user.click(screen.getByRole('button', { name: 'Crear categoría' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Ya existe una categoría con ese nombre.');
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it('rejects a duplicate name without calling onSubmit', async () => {
    const { props, user } = renderDialog();

    await user.type(screen.getByLabelText('Nombre'), 'mercado');
    await user.click(screen.getByRole('button', { name: 'Crear categoría' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Ya existe una categoría con ese nombre.');
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it('closes on Escape', async () => {
    const { props, user } = renderDialog();

    await user.keyboard('{Escape}');

    expect(props.onClose).toHaveBeenCalled();
  });
});
