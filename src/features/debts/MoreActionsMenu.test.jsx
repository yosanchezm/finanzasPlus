import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import MoreActionsMenu from './MoreActionsMenu';

const handlers = () => ({ onRateChange: vi.fn(), onChargeChange: vi.fn(), onLatePolicy: vi.fn(), onRestructure: vi.fn() });
const names = () => screen.getAllByRole('menuitem').map((item) => item.textContent);
const trigger = () => screen.getByRole('button', { name: 'Más acciones' });

describe('MoreActionsMenu', () => {
  it('is a closed disclosure menu until the trigger is pressed', async () => {
    render(<MoreActionsMenu {...handlers()} />);

    expect(trigger()).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    await userEvent.click(trigger());

    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('lists the four actions of a loan', async () => {
    render(<MoreActionsMenu {...handlers()} />);
    await userEvent.click(trigger());

    expect(names()).toEqual(['Cambiar tasa', 'Cambiar seguros y cargos', 'Configurar mora', 'Reestructurar']);
  });

  it('omits "Reestructurar" for a card even when the handler is wired', async () => {
    render(<MoreActionsMenu isCard {...handlers()} />);
    await userEvent.click(trigger());

    expect(names()).toEqual(['Cambiar tasa', 'Cambiar seguros y cargos', 'Configurar mora']);
  });

  it('shows only the actions that have a handler, and nothing when none is wired', async () => {
    const { unmount } = render(<MoreActionsMenu onRateChange={vi.fn()} />);
    await userEvent.click(trigger());
    expect(names()).toEqual(['Cambiar tasa']);
    unmount();

    render(<MoreActionsMenu />);
    expect(screen.queryByRole('button', { name: 'Más acciones' })).not.toBeInTheDocument();
  });

  it('runs the chosen action once and closes', async () => {
    const wired = handlers();
    render(<MoreActionsMenu {...wired} />);
    await userEvent.click(trigger());
    await userEvent.click(screen.getByRole('menuitem', { name: 'Configurar mora' }));

    expect(wired.onLatePolicy).toHaveBeenCalledTimes(1);
    expect(wired.onRateChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes with Escape and gives the focus back to the trigger', async () => {
    render(<MoreActionsMenu {...handlers()} />);
    await userEvent.click(trigger());
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
  });

  it('closes on a click outside, and stays open on a click inside the menu', async () => {
    render(<div><MoreActionsMenu {...handlers()} /><p>Fuera</p></div>);
    await userEvent.click(trigger());
    await userEvent.click(screen.getByRole('menu'));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await userEvent.click(screen.getByText('Fuera'));

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('moves the focus through the items with the arrow keys and wraps around', async () => {
    render(<MoreActionsMenu {...handlers()} />);
    await userEvent.click(trigger());
    const items = screen.getAllByRole('menuitem');
    expect(items[0]).toHaveFocus();

    await userEvent.keyboard('{ArrowDown}');
    expect(items[1]).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}{ArrowUp}');
    expect(items[3]).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(items[0]).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(items[3]).toHaveFocus();
  });
});
