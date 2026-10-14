import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import Sidebar from './Sidebar';

const renderSidebar = (overrides = {}) => {
  const props = {
    householdName: 'Casa Sánchez',
    members: [{ $id: 'm1', alias: 'Camilo' }, { $id: 'm2', alias: 'Laura' }],
    displayName: 'Camilo Sánchez',
    email: 'camilo@example.com',
    activeView: 'Resumen',
    transactionsCount: 12,
    onNavigate: vi.fn(),
    onOpenAssistant: vi.fn(),
    onLogout: vi.fn(),
    ...overrides,
  };
  render(<Sidebar {...props} />);
  return { props, user: userEvent.setup() };
};

describe('Sidebar', () => {
  it('marks only the active item with aria-current="page"', () => {
    renderSidebar({ activeView: 'Presupuesto' });
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' });

    expect(within(nav).getByRole('button', { name: 'Presupuesto' })).toHaveAttribute('aria-current', 'page');
    for (const label of ['Resumen', 'Metas']) {
      expect(within(nav).getByRole('button', { name: label })).not.toHaveAttribute('aria-current');
    }
    expect(within(nav).getByRole('button', { name: /Movimientos/ })).not.toHaveAttribute('aria-current');
  });

  it('calls onNavigate with the label of the clicked item', async () => {
    const { props, user } = renderSidebar();

    await user.click(screen.getByRole('button', { name: 'Metas' }));

    expect(props.onNavigate).toHaveBeenCalledWith('Metas');
  });

  it('offers Deudas and navigates to it', async () => {
    const { props, user } = renderSidebar({ activeView: 'Deudas' });

    expect(screen.getByRole('button', { name: 'Deudas' })).toHaveAttribute('aria-current', 'page');
    await user.click(screen.getByRole('button', { name: 'Deudas' }));

    expect(props.onNavigate).toHaveBeenCalledWith('Deudas');
  });

  it('offers an enabled Ajustes that marks itself current and navigates to it', async () => {
    const { props, user } = renderSidebar({ activeView: 'Ajustes' });
    const settings = screen.getByRole('button', { name: 'Ajustes' });

    expect(settings).toBeEnabled();
    expect(settings).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByText('Próximamente')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deudas' })).not.toHaveAttribute('aria-current');
    await user.click(settings);

    expect(props.onNavigate).toHaveBeenCalledWith('Ajustes');
  });

  it('does not mark Ajustes current on another view', () => {
    renderSidebar({ activeView: 'Deudas' });

    expect(screen.getByRole('button', { name: 'Ajustes' })).not.toHaveAttribute('aria-current');
  });

  it('shows the transactions count next to Movimientos', () => {
    renderSidebar({ transactionsCount: 48 });

    expect(screen.getByRole('button', { name: /Movimientos/ })).toHaveTextContent('48');
  });

  it('shows the household and member count', () => {
    renderSidebar();

    expect(screen.getByText('Casa Sánchez')).toBeInTheDocument();
    expect(screen.getByText('2 integrantes')).toBeInTheDocument();
  });

  it('opens the assistant from Nia', async () => {
    const { props, user } = renderSidebar();

    await user.click(screen.getByRole('button', { name: 'Nia' }));

    expect(props.onOpenAssistant).toHaveBeenCalled();
  });

  it('calls onLogout from the profile row', async () => {
    const { props, user } = renderSidebar();

    expect(screen.getByText('camilo@example.com')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cerrar sesión' }));

    expect(props.onLogout).toHaveBeenCalled();
  });
});
