import { serializeTerms } from '@finance-core';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../../appwrite';
import { useDebtData } from './useDebtData';

vi.mock('../../appwrite', () => ({
  listDebts: vi.fn(), listDebtEvents: vi.fn(), listCostRows: vi.fn(), ensureCostCategory: vi.fn(), createCostRow: vi.fn(), updateCostRow: vi.fn(), deleteCostRow: vi.fn(),
}));

const DEBTS = [{ $id: 'db1', name: 'Libre inversión' }];
const EVENTS = [{ $id: 'ev1', debtId: 'db1', kind: 'disbursement' }];

beforeEach(() => {
  vi.clearAllMocks();
  api.listDebts.mockResolvedValue(DEBTS);
  api.listDebtEvents.mockResolvedValue(EVENTS);
});

describe('useDebtData', () => {
  it('goes from loading to ready with the debts and their events', async () => {
    const { result } = renderHook(() => useDebtData());

    expect(result.current).toMatchObject({ status: 'loading', debts: [], events: [] });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    expect(result.current).toMatchObject({ debts: DEBTS, events: EVENTS, error: null });
    expect(api.listDebtEvents).toHaveBeenCalledWith();
  });

  it('reports a load failure as an error with no data, and retry recovers', async () => {
    api.listDebts.mockRejectedValueOnce(new Error('sin conexión'));
    const { result } = renderHook(() => useDebtData());

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current).toMatchObject({ debts: [], events: [] });
    expect(result.current.error.message).toBe('sin conexión');

    await act(() => result.current.retry());

    expect(result.current).toMatchObject({ status: 'ready', debts: DEBTS, error: null });
  });

  it('reload swaps in fresh rows without going back to loading', async () => {
    const { result } = renderHook(() => useDebtData());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const seen = [];
    api.listDebts.mockImplementationOnce(async () => { seen.push(result.current.status); return [...DEBTS, { $id: 'db2', name: 'Moto' }]; });

    await act(() => result.current.reload());

    expect(seen).toEqual(['ready']);
    expect(result.current.debts).toHaveLength(2);
  });

  it('turns a failed reload into the error state instead of keeping stale rows', async () => {
    const { result } = renderHook(() => useDebtData());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    api.listDebtEvents.mockRejectedValueOnce(new Error('timeout'));

    await act(() => result.current.reload());

    expect(result.current).toMatchObject({ status: 'error', debts: [], events: [] });
  });

  it('ignores a slow response that a newer request has replaced', async () => {
    let releaseFirst;
    api.listDebts.mockImplementationOnce(() => new Promise((resolve) => { releaseFirst = () => resolve([{ $id: 'old' }]); }));
    const { result } = renderHook(() => useDebtData());

    await act(() => result.current.reload());
    await act(async () => { releaseFirst(); });

    expect(result.current.debts).toEqual(DEBTS);
  });
});

describe('useDebtData reconcileCosts', () => {
  const terms = {
    kind: 'consumer', principalMinor: 1000000, openedOn: '2026-01-05', system: 'french', periodicity: 'monthly', n: 12, firstDueOn: '2026-02-05',
    rate: { value: 24, basis: 'effective', periodicity: 'annual', timing: 'arrears' },
  };
  const loan = { $id: 'd1', householdId: 'h1', name: 'Crédito', ownerScope: 'you', status: 'active', termsVersion: 1, principalMinor: 1000000, termsJson: serializeTerms(terms) };
  const payment = (id, on) => ({ $id: id, $createdAt: `${on}T10:00:00.000Z`, debtId: 'd1', kind: 'payment', effectiveOn: on, amountMinor: 93453, payloadJson: '{}', actorId: 'u1', source: 'web', dedupeKey: `k${id}` });
  const row = (id, amountMinor) => ({ $id: id, debtId: 'd1', source: 'debt', amountMinor });

  const ready = async (events) => {
    api.listDebts.mockResolvedValue([loan]);
    api.listDebtEvents.mockResolvedValue(events);
    api.ensureCostCategory.mockResolvedValue('cat1');
    const hook = renderHook(() => useDebtData());
    await waitFor(() => expect(hook.result.current.status).toBe('ready'));
    return hook;
  };

  it('creates the missing row with the category, then finds nothing to do', async () => {
    const { result } = await ready([payment('e1', '2026-02-05')]);
    api.listCostRows.mockResolvedValueOnce([]);

    const first = await result.current.reconcileCosts('d1');

    expect(first).toEqual({ created: 1, updated: 0, removed: 0 });
    expect(api.listCostRows).toHaveBeenCalledWith('d1');
    expect(api.createCostRow).toHaveBeenCalledWith({ id: 'dce1', data: expect.objectContaining({ categoryId: 'cat1', amountMinor: 18088, debtId: 'd1' }) });

    api.listCostRows.mockResolvedValueOnce([row('dce1', 18088)]);
    api.createCostRow.mockClear();
    expect(await result.current.reconcileCosts('d1')).toEqual({ created: 0, updated: 0, removed: 0 });
    expect(api.createCostRow).not.toHaveBeenCalled();
    expect(api.ensureCostCategory).toHaveBeenCalledTimes(1);
  });

  it('updates a stale amount and deletes an orphan', async () => {
    const { result } = await ready([payment('e1', '2026-02-05')]);
    api.listCostRows.mockResolvedValueOnce([row('dce1', 5), row('dcghost', 70)]);

    expect(await result.current.reconcileCosts('d1')).toEqual({ created: 0, updated: 1, removed: 1 });

    expect(api.updateCostRow).toHaveBeenCalledWith('dce1', { amountMinor: 18088 });
    expect(api.deleteCostRow).toHaveBeenCalledWith('dcghost');
    expect(api.ensureCostCategory).not.toHaveBeenCalled();
  });

  it('rejects when a repair write fails so the caller can warn without blocking', async () => {
    const { result } = await ready([payment('e1', '2026-02-05')]);
    api.listCostRows.mockResolvedValueOnce([]);
    api.createCostRow.mockRejectedValueOnce(new Error('sin red'));

    await expect(result.current.reconcileCosts('d1')).rejects.toThrow('sin red');
  });

  it('does nothing for a debt it does not know', async () => {
    const { result } = await ready([]);

    expect(await result.current.reconcileCosts('missing')).toEqual({ created: 0, updated: 0, removed: 0 });
    expect(api.listCostRows).not.toHaveBeenCalled();
  });
});
