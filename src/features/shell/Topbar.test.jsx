import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import Topbar from './Topbar';

const renderTopbar = (overrides = {}) => {
  const props = {
    householdName: 'Casa Sánchez',
    activeView: 'Movimientos',
    month: '2026-09',
    maxMonth: '2026-10',
    onMonthChange: vi.fn(),
    onSearch: vi.fn(),
    onAdd: vi.fn(),
    onRefresh: vi.fn(),
    refreshing: false,
    ...overrides,
  };
  render(<Topbar {...props} />);
  return { props, user: userEvent.setup() };
};

describe('Topbar', () => {
  it('renders the breadcrumb with household and current view', () => {
    renderTopbar();
    const breadcrumb = screen.getByRole('navigation', { name: 'Ruta' });

    expect(within(breadcrumb).getByText('Casa Sánchez')).toBeInTheDocument();
    expect(within(breadcrumb).getByText('Movimientos')).toHaveAttribute('aria-current', 'page');
  });

  it('hides the period switcher for views that are not month-scoped', () => {
    renderTopbar({ showPeriod: false });

    expect(screen.queryByRole('group', { name: 'Periodo' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Actualizar datos' })).toBeInTheDocument();
  });

  it('shows the selected period with month navigation', async () => {
    const { props, user } = renderTopbar();

    expect(screen.getByRole('group', { name: 'Periodo' })).toHaveTextContent('Septiembre 2026');
    await user.click(screen.getByRole('button', { name: 'Mes siguiente' }));

    expect(props.onMonthChange).toHaveBeenCalledWith('2026-10');
  });

  it('submits the global search', async () => {
    const { props, user } = renderTopbar();

    await user.type(within(screen.getByRole('search')).getByRole('searchbox'), 'taxi{Enter}');

    expect(props.onSearch).toHaveBeenCalledWith('taxi');
  });

  it('calls onAdd from "Nuevo movimiento"', async () => {
    const { props, user } = renderTopbar();

    await user.click(screen.getByRole('button', { name: 'Nuevo movimiento' }));

    expect(props.onAdd).toHaveBeenCalled();
  });

  it('calls onRefresh and reports the busy state', async () => {
    const { props, user } = renderTopbar();

    await user.click(screen.getByRole('button', { name: 'Actualizar datos' }));
    expect(props.onRefresh).toHaveBeenCalled();
  });

  it('marks the refresh button busy while refreshing', () => {
    renderTopbar({ refreshing: true });

    expect(screen.getByRole('button', { name: 'Actualizar datos' })).toHaveAttribute('aria-busy', 'true');
  });
});
