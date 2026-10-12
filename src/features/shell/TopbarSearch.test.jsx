import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import TopbarSearch from './TopbarSearch';

describe('TopbarSearch', () => {
  it('focuses the search box with Ctrl+K', async () => {
    const user = userEvent.setup();
    render(<TopbarSearch onSearch={vi.fn()} />);
    const input = screen.getByRole('searchbox', { name: 'Buscar movimientos' });

    expect(input).not.toHaveFocus();
    await user.keyboard('{Control>}k{/Control}');

    expect(input).toHaveFocus();
  });

  it('focuses the search box with ⌘+K', async () => {
    const user = userEvent.setup();
    render(<TopbarSearch onSearch={vi.fn()} />);

    await user.keyboard('{Meta>}k{/Meta}');

    expect(screen.getByRole('searchbox', { name: 'Buscar movimientos' })).toHaveFocus();
  });

  it('ignores K without a modifier', async () => {
    const user = userEvent.setup();
    render(<TopbarSearch onSearch={vi.fn()} />);

    await user.keyboard('k');

    expect(screen.getByRole('searchbox', { name: 'Buscar movimientos' })).not.toHaveFocus();
  });

  it('submits the trimmed query', async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    render(<TopbarSearch onSearch={onSearch} />);

    await user.type(screen.getByRole('searchbox', { name: 'Buscar movimientos' }), '  mercado {Enter}');

    expect(onSearch).toHaveBeenCalledWith('mercado');
  });

  it('removes the shortcut listener on unmount', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(<TopbarSearch onSearch={vi.fn()} />);
    const handler = add.mock.calls.find(([type]) => type === 'keydown')?.[1];

    unmount();

    expect(handler).toBeTypeOf('function');
    expect(remove).toHaveBeenCalledWith('keydown', handler);
    add.mockRestore();
    remove.mockRestore();
  });
});
