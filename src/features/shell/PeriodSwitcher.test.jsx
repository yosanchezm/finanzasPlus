import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import PeriodSwitcher from './PeriodSwitcher';

const renderSwitcher = (month, maxMonth = '2026-10') => {
  const onChange = vi.fn();
  render(<PeriodSwitcher month={month} maxMonth={maxMonth} onChange={onChange} />);
  return { onChange, user: userEvent.setup() };
};

describe('PeriodSwitcher', () => {
  it('shows the selected month as a labelled group', () => {
    renderSwitcher('2026-10');

    expect(screen.getByRole('group', { name: 'Periodo' })).toHaveTextContent('Octubre 2026');
  });

  it('goes to the previous month', async () => {
    const { onChange, user } = renderSwitcher('2026-01');

    await user.click(screen.getByRole('button', { name: 'Mes anterior' }));

    expect(onChange).toHaveBeenCalledWith('2025-12');
  });

  it('disables the next month beyond the current one', async () => {
    const { onChange, user } = renderSwitcher('2026-10');

    const next = screen.getByRole('button', { name: 'Mes siguiente' });
    expect(next).toBeDisabled();
    await user.click(next);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('allows moving forward from a past month', async () => {
    const { onChange, user } = renderSwitcher('2026-08');

    await user.click(screen.getByRole('button', { name: 'Mes siguiente' }));

    expect(onChange).toHaveBeenCalledWith('2026-09');
  });
});
