import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import MobileTabBar from './MobileTabBar';

const renderTabBar = (overrides = {}) => {
  const props = {
    activeView: 'Resumen',
    onNavigate: vi.fn(),
    onAdd: vi.fn(),
    onOpenAssistant: vi.fn(),
    onRefresh: vi.fn(),
    onLogout: vi.fn(),
    ...overrides,
  };
  render(<MobileTabBar {...props} />);
  return { props, user: userEvent.setup() };
};

const openSheet = async (user) => {
  await user.click(screen.getByRole('button', { name: 'Más' }));
  return screen.getByRole('dialog', { name: 'Más opciones' });
};

describe('MobileTabBar', () => {
  it('calls onAdd from the central action button', async () => {
    const { props, user } = renderTabBar();

    await user.click(screen.getByRole('button', { name: 'Nuevo movimiento' }));

    expect(props.onAdd).toHaveBeenCalled();
  });

  it('calls onNavigate from the tabs and marks the active one', async () => {
    const { props, user } = renderTabBar({ activeView: 'Movimientos' });

    expect(screen.getByRole('button', { name: 'Movimientos' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Resumen' })).not.toHaveAttribute('aria-current');

    await user.click(screen.getByRole('button', { name: 'Presupuesto' }));
    expect(props.onNavigate).toHaveBeenCalledWith('Presupuesto');
  });

  it('opens the more sheet and moves focus into it', async () => {
    const { user } = renderTabBar();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const sheet = await openSheet(user);

    expect(sheet).toContainElement(document.activeElement);
    // The modal sheet hides the background from assistive tech, so the trigger is queried with hidden: true.
    expect(screen.getByRole('button', { name: 'Más', hidden: true })).toHaveAttribute('aria-expanded', 'true');
  });

  it('closes the sheet on Escape and returns focus to the trigger', async () => {
    const { user } = renderTabBar();
    await openSheet(user);

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Más' })).toHaveFocus();
  });

  it('closes the sheet when the backdrop is clicked', async () => {
    const { user } = renderTabBar();
    await openSheet(user);

    await user.click(screen.getByTestId('more-sheet-backdrop'));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('navigates to Metas, opens Nia and refreshes from the sheet', async () => {
    const { props, user } = renderTabBar();

    await user.click(within(await openSheet(user)).getByRole('button', { name: 'Metas' }));
    expect(props.onNavigate).toHaveBeenCalledWith('Metas');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(within(await openSheet(user)).getByRole('button', { name: 'Nia' }));
    expect(props.onOpenAssistant).toHaveBeenCalled();

    await user.click(within(await openSheet(user)).getByRole('button', { name: 'Actualizar datos' }));
    expect(props.onRefresh).toHaveBeenCalled();
  });

  it('calls onLogout from "Cerrar sesión" in the sheet', async () => {
    const { props, user } = renderTabBar();
    const sheet = await openSheet(user);

    await user.click(within(sheet).getByRole('button', { name: 'Cerrar sesión' }));

    expect(props.onLogout).toHaveBeenCalled();
  });
});
