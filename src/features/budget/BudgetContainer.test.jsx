import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { lineIds } from '@finance-core';
import { saveBudgetLine, updateBudgetLine } from '../../appwrite';
import BudgetContainer from './BudgetContainer';

vi.mock('../../appwrite', () => ({ saveBudgetLine: vi.fn(), updateBudgetLine: vi.fn() }));
vi.mock('./BudgetView', () => ({
  default: ({ canEdit, saveState, onCommit, onEditLine, header }) => (
    <div>
      {header}
      <span data-testid="has-edit">{String(Boolean(onEditLine))}</span>
      <button type="button" onClick={() => onEditLine(window.__target)}>edit</button>
      <span data-testid="can-edit">{String(canEdit)}</span>
      <span data-testid="save-status">{saveState.status}</span>
      <button type="button" onClick={() => onCommit(window.__write).catch(() => {})}>commit</button>
    </div>
  ),
}));

const budgetMonth = {
  month: '2026-07',
  base: { source: 'actual', incomeMinor: 5000000 },
  totals: { allocatedMinor: 1000000, porAsignarMinor: 4000000 },
  warnings: [],
};

const renderContainer = (props = {}) => {
  const onRefresh = vi.fn().mockResolvedValue(undefined);
  render(<BudgetContainer budgetMonth={budgetMonth} canEdit linesMode="lines" scope="total" onRefresh={onRefresh} {...props} />);
  return { onRefresh, user: userEvent.setup() };
};

describe('BudgetContainer', () => {
  it('renders the header and passes the editing flag down', () => {
    renderContainer();
    expect(screen.getByText('Por asignar')).toBeInTheDocument();
    expect(screen.getByTestId('can-edit')).toHaveTextContent('true');
  });

  it('keeps editing off and shows the legacy notice in legacy mode', () => {
    renderContainer({ canEdit: false, linesMode: 'legacy' });
    expect(screen.getByTestId('can-edit')).toHaveTextContent('false');
    expect(screen.getByText(/se están migrando/)).toBeInTheDocument();
  });

  it('is not optimistic: saving, then refresh, then idle', async () => {
    let finish;
    window.__write = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const { user, onRefresh } = renderContainer();
    await user.click(screen.getByRole('button', { name: 'commit' }));
    expect(screen.getByTestId('save-status')).toHaveTextContent('saving');
    expect(onRefresh).not.toHaveBeenCalled();
    finish();
    await waitFor(() => expect(screen.getByTestId('save-status')).toHaveTextContent('idle'));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('shows the readable error with Reintentar, and retry repeats the same write', async () => {
    window.__write = vi.fn().mockRejectedValueOnce({ code: 403 }).mockResolvedValueOnce(undefined);
    const { user, onRefresh } = renderContainer();
    await user.click(screen.getByRole('button', { name: 'commit' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Tu usuario no tiene acceso a este hogar');
    expect(onRefresh).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(window.__write).toHaveBeenCalledTimes(2);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  describe('line editor', () => {
    const cat = { targetType: 'category', targetId: 'c1' };
    const line = (extra) => ({ $id: 'old', ...cat, rule: 'fixed', amountMinor: 100, percentBp: null, fromMonth: '2026-01', toMonth: null, ...extra });
    const categories = [{ $id: 'c1', name: 'Mercado', kind: 'need' }, { $id: 'c9', name: 'Nómina', kind: 'income' }];
    const open = async (props = {}) => {
      window.__target = cat;
      const ctx = renderContainer({ lines: [line()], allCategories: categories, actorId: 'u1', ...props });
      await ctx.user.click(screen.getByRole('button', { name: 'edit' }));
      return ctx;
    };
    const fill = async (user, text, button = 'Guardar') => {
      await user.clear(screen.getByRole('textbox'));
      if (text) await user.type(screen.getByRole('textbox'), text);
      await user.click(screen.getByRole('button', { name: button }));
    };

    beforeEach(() => {
      saveBudgetLine.mockReset().mockResolvedValue({});
      updateBudgetLine.mockReset().mockResolvedValue({});
    });

    it('closes the open-ended line at the previous month, then opens the new one, then refreshes', async () => {
      const { user, onRefresh } = await open();
      await fill(user, '700');
      await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
      expect(updateBudgetLine).toHaveBeenCalledWith('old', expect.objectContaining({ toMonth: '2026-06', actorId: 'u1', source: 'web' }));
      expect(saveBudgetLine).toHaveBeenCalledWith(lineIds.recurring(cat, '2026-07'), expect.objectContaining({ amountMinor: 700, fromMonth: '2026-07', toMonth: null, source: 'web' }));
      expect(updateBudgetLine.mock.invocationCallOrder[0]).toBeLessThan(saveBudgetLine.mock.invocationCallOrder[0]);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('updates a migrated one-month line instead of duplicating it', async () => {
      const { user } = await open({ lines: [line({ $id: 'blabc', fromMonth: '2026-07', toMonth: '2026-07' })] });
      await user.click(screen.getByRole('button', { name: 'Solo este mes' }));
      await fill(user, '900');
      await waitFor(() => expect(updateBudgetLine).toHaveBeenCalledWith('blabc', expect.objectContaining({ amountMinor: 900 })));
      expect(saveBudgetLine).not.toHaveBeenCalled();
    });

    it('closes the open-ended line when removing from this month on', async () => {
      const { user } = await open();
      await user.click(screen.getByRole('button', { name: 'Quitar desde este mes' }));
      await waitFor(() => expect(saveBudgetLine).not.toHaveBeenCalled());
      await waitFor(() => expect(updateBudgetLine).toHaveBeenCalledWith('old', expect.objectContaining({ toMonth: '2026-06' })));
    });

    it('writes a one-month tombstone when removing only this month', async () => {
      const { user } = await open();
      await user.click(screen.getByRole('button', { name: 'Quitar solo este mes' }));
      await waitFor(() => expect(saveBudgetLine).toHaveBeenCalledWith(lineIds.override(cat, '2026-07'), expect.objectContaining({ amountMinor: 0, fromMonth: '2026-07', toMonth: '2026-07' })));
    });

    it('writes nothing for an invalid plan and says so', async () => {
      window.__target = { targetType: 'group', targetId: 'bogus' };
      const { user } = renderContainer({ lines: [], allCategories: categories, actorId: 'u1' });
      await user.click(screen.getByRole('button', { name: 'edit' }));
      await fill(user, '5');
      expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo preparar el cambio');
      expect(saveBudgetLine).not.toHaveBeenCalled();
      expect(updateBudgetLine).not.toHaveBeenCalled();
    });

    it('keeps the dialog open on a write error and retries with the same ids', async () => {
      saveBudgetLine.mockRejectedValueOnce({ code: 403 });
      const { user, onRefresh } = await open({ lines: [] });
      await fill(user, '700');
      expect(await screen.findByRole('alert')).toHaveTextContent('Tu usuario no tiene acceso a este hogar');
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(onRefresh).not.toHaveBeenCalled();
      await user.click(screen.getByRole('button', { name: 'Reintentar' }));
      await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
      expect(saveBudgetLine).toHaveBeenCalledTimes(2);
      expect(saveBudgetLine.mock.calls[1][0]).toBe(saveBudgetLine.mock.calls[0][0]);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('tells that a one-month adjustment keeps applying', async () => {
      await open({ lines: [line(), line({ $id: 'bo1', fromMonth: '2026-07', toMonth: '2026-07' })] });
      expect(screen.getByRole('note')).toHaveTextContent('ajuste puntual');
    });

    it('offers no editor when editing is off', () => {
      renderContainer({ canEdit: false, lines: [line()], allCategories: categories });
      expect(screen.getByTestId('has-edit')).toHaveTextContent('false');
    });
  });
});
