import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import BudgetContainer from './BudgetContainer';

vi.mock('./BudgetView', () => ({
  default: ({ canEdit, saveState, onCommit, header }) => (
    <div>
      {header}
      <span data-testid="can-edit">{String(canEdit)}</span>
      <span data-testid="save-status">{saveState.status}</span>
      <button type="button" onClick={() => onCommit(window.__write).catch(() => {})}>commit</button>
    </div>
  ),
}));

const budgetMonth = {
  month: '2026-10',
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
});
