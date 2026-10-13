import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../../appwrite';
import { useDebtData } from './useDebtData';

vi.mock('../../appwrite', () => ({ listDebts: vi.fn(), listDebtEvents: vi.fn() }));

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
