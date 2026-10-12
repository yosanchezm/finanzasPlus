import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import GoalModal from './GoalModal';

const renderModal = () => {
  const props = { onClose: vi.fn(), onSubmit: vi.fn() };
  render(<GoalModal {...props} />);
  return { props, user: userEvent.setup() };
};

describe('GoalModal', () => {
  it('submits name, target, date and owner', async () => {
    const { props, user } = renderModal();
    expect(screen.getByRole('dialog', { name: 'Nueva meta' })).toBeInTheDocument();

    await user.type(screen.getByLabelText('Nombre'), 'Fondo de emergencia');
    await user.type(screen.getByLabelText('Objetivo'), '15000000');
    await user.click(within(screen.getByRole('group', { name: '¿Para quién?' })).getByRole('button', { name: 'Tú' }));
    await user.click(screen.getByRole('button', { name: 'Crear meta' }));

    expect(props.onSubmit).toHaveBeenCalledWith({ name: 'Fondo de emergencia', targetMinor: '15000000', targetDate: '', ownerScope: 'you' });
  });

  it('does not submit without a name and a target', async () => {
    const { props, user } = renderModal();

    await user.type(screen.getByLabelText('Nombre'), '   ');
    await user.click(screen.getByRole('button', { name: 'Crear meta' }));

    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it('closes on Escape', async () => {
    const { props, user } = renderModal();

    await user.keyboard('{Escape}');

    expect(props.onClose).toHaveBeenCalled();
  });
});
