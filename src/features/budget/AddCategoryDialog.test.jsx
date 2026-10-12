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
    await user.click(within(screen.getByRole('group', { name: 'Tipo' })).getByRole('button', { name: 'Ingreso' }));
    await user.click(screen.getByRole('radio', { name: 'Morado' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Icono (opcional)' }), 'sparkles');
    await user.click(screen.getByRole('button', { name: 'Crear categoría' }));

    expect(props.onSubmit).toHaveBeenCalledWith({ name: 'Mascotas', kind: 'income', color: '#7A5AF8', icon: 'sparkles' });
  });

  it('defaults to an expense category without icon', async () => {
    const { props, user } = renderDialog();

    await user.type(screen.getByLabelText('Nombre'), 'Salud');
    await user.click(screen.getByRole('button', { name: 'Crear categoría' }));

    expect(props.onSubmit).toHaveBeenCalledWith({ name: 'Salud', kind: 'need', color: CATEGORY_PALETTE[0], icon: '' });
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
