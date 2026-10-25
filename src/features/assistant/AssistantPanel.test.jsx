import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import AssistantPanel from './AssistantPanel';

const renderPanel = () => {
  const props = { onClose: vi.fn(), onNavigate: vi.fn(), balanceMinor: 4000000, transactionsCount: 12 };
  render(<AssistantPanel {...props} />);
  return { props, user: userEvent.setup() };
};

describe('AssistantPanel', () => {
  it('opens as a dialog named Nia with the month data', () => {
    renderPanel();

    expect(screen.getByRole('dialog', { name: 'Nia' })).toBeInTheDocument();
    expect(screen.getByText('$ 4.000.000')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('keeps the composer disabled', () => {
    renderPanel();

    expect(screen.getByRole('textbox', { name: 'Mensaje para Nia' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled();
  });

  it('navigates from the suggestions', async () => {
    const { props, user } = renderPanel();

    await user.click(screen.getByRole('button', { name: 'Ver presupuesto' }));

    expect(props.onNavigate).toHaveBeenCalledWith('Presupuesto');
  });

  it('closes on Escape', async () => {
    const { props, user } = renderPanel();

    await user.keyboard('{Escape}');

    expect(props.onClose).toHaveBeenCalled();
  });
});
