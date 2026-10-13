import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import MobileTopBar from './MobileTopBar';

const renderBar = (month = '2026-09') => {
  const onMonthChange = vi.fn();
  render(<MobileTopBar householdName="Hogar Sánchez" displayName="Camilo Sánchez" month={month} maxMonth="2026-10" onMonthChange={onMonthChange} />);
  return { onMonthChange, user: userEvent.setup() };
};

describe('MobileTopBar', () => {
  it('shows the household and a single month button instead of the full switcher', () => {
    renderBar();

    expect(screen.getByText('Hogar Sánchez')).toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: 'Cambiar mes: Septiembre 2026' });
    expect(trigger).toHaveTextContent('Sept 2026');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Mes anterior' })).not.toBeInTheDocument();
  });

  it('hides the month button for views that are not month-scoped', () => {
    render(<MobileTopBar householdName="Hogar Sánchez" displayName="Camilo Sánchez" month="2026-09" maxMonth="2026-10" onMonthChange={vi.fn()} showPeriod={false} />);

    expect(screen.getByText('Hogar Sánchez')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cambiar mes/ })).not.toBeInTheDocument();
  });

  it('opens a popover with previous and next month', async () => {
    const { onMonthChange, user } = renderBar();

    await user.click(screen.getByRole('button', { name: 'Cambiar mes: Septiembre 2026' }));
    const dialog = screen.getByRole('dialog', { name: 'Elegir mes' });
    await user.click(within(dialog).getByRole('button', { name: 'Mes anterior' }));

    expect(onMonthChange).toHaveBeenCalledWith('2026-08');
  });

  it('disables moving past the current month', async () => {
    const { user } = renderBar('2026-10');

    await user.click(screen.getByRole('button', { name: 'Cambiar mes: Octubre 2026' }));

    expect(within(screen.getByRole('dialog', { name: 'Elegir mes' })).getByRole('button', { name: 'Mes siguiente' })).toBeDisabled();
  });

  it('closes the popover with Escape and returns focus to the trigger', async () => {
    const { user } = renderBar();
    const trigger = screen.getByRole('button', { name: 'Cambiar mes: Septiembre 2026' });

    await user.click(trigger);
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Elegir mes' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
