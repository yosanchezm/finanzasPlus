import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import LineEditorDialog from './LineEditorDialog';

const renderDialog = (overrides = {}) => {
  const props = {
    name: 'Mercado',
    kind: 'need',
    base: { source: 'actual', incomeMinor: 5000000 },
    onSubmit: vi.fn(),
    onRetry: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<LineEditorDialog {...props} />);
  return { props, user: userEvent.setup() };
};

const save = () => screen.getByRole('button', { name: 'Guardar' });
const amount = () => screen.getByRole('textbox', { name: /Monto|Porcentaje/ });

describe('LineEditorDialog', () => {
  it('saves a fixed amount from this month on by default', async () => {
    const { props, user } = renderDialog();
    await user.type(amount(), '500000');
    await user.click(save());
    expect(props.onSubmit).toHaveBeenCalledWith({ action: 'set', span: 'onward', rule: 'fixed', value: 500000 });
  });

  it('saves a percent as basis points for this month only, with an Equivale a preview', async () => {
    const { props, user } = renderDialog();
    await user.click(screen.getByRole('button', { name: 'Porcentaje' }));
    await user.click(screen.getByRole('button', { name: 'Solo este mes' }));
    await user.type(amount(), '12,5');
    expect(screen.getByText(/Equivale a .*625\.000/)).toBeInTheDocument();
    await user.click(save());
    expect(props.onSubmit).toHaveBeenCalledWith({ action: 'set', span: 'month', rule: 'percent', value: 1250 });
  });

  it('blocks a percent over 100 with an inline message', async () => {
    const { user } = renderDialog();
    await user.click(screen.getByRole('button', { name: 'Porcentaje' }));
    await user.type(amount(), '100,5');
    expect(screen.getByText('El porcentaje no puede pasar de 100 %.')).toBeInTheDocument();
    expect(save()).toBeDisabled();
  });

  it('disables save for empty or non-integer fixed amounts', async () => {
    const { user } = renderDialog();
    expect(save()).toBeDisabled();
    await user.type(amount(), '10.5');
    expect(save()).toBeDisabled();
  });

  it('explains there is no income base instead of a preview', async () => {
    const { user } = renderDialog({ base: { source: 'none', incomeMinor: 0 } });
    await user.click(screen.getByRole('button', { name: 'Porcentaje' }));
    await user.type(amount(), '10');
    expect(screen.getByText(/Aún no hay ingresos/)).toBeInTheDocument();
    expect(screen.queryByText(/Equivale a/)).not.toBeInTheDocument();
  });

  it('removes only this month or from this month on', async () => {
    const { props, user } = renderDialog();
    await user.click(screen.getByRole('button', { name: 'Quitar solo este mes' }));
    expect(props.onSubmit).toHaveBeenLastCalledWith({ action: 'remove', span: 'month' });
    await user.click(screen.getByRole('button', { name: 'Quitar desde este mes' }));
    expect(props.onSubmit).toHaveBeenLastCalledWith({ action: 'remove', span: 'onward' });
  });

  it('does not offer a limit for income categories', () => {
    renderDialog({ kind: 'income' });
    expect(screen.getByText(/Los ingresos no tienen límite/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar' })).not.toBeInTheDocument();
  });

  it('warns that a one-month adjustment keeps applying when saving from this month on', async () => {
    const { user } = renderDialog({ monthOverride: true });
    expect(screen.getByRole('note')).toHaveTextContent('Este mes tiene un ajuste puntual que seguirá aplicando');
    await user.click(screen.getByRole('button', { name: 'Solo este mes' }));
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('shows the save error with Reintentar', async () => {
    const { props, user } = renderDialog({ error: 'Sin conexión' });
    expect(screen.getByRole('alert')).toHaveTextContent('Sin conexión');
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(props.onRetry).toHaveBeenCalled();
  });

  it('starts from the current rule', () => {
    renderDialog({ initial: { rule: 'percent', percentBp: 1500 } });
    expect(amount()).toHaveValue('15');
  });
});
