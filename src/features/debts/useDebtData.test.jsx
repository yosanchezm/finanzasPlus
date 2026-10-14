import { serializeTerms } from '@finance-core';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../../appwrite';
import { useDebtData } from './useDebtData';

vi.mock('../../appwrite', () => ({
  listDebts: vi.fn(), listDebtEvents: vi.fn(), listLegalRates: vi.fn(), listCostRows: vi.fn(), ensureCostCategory: vi.fn(), createCostRow: vi.fn(), updateCostRow: vi.fn(), deleteCostRow: vi.fn(),
}));

const DEBTS = [{ $id: 'db1', name: 'Libre inversión' }];
const EVENTS = [{ $id: 'ev1', debtId: 'db1', kind: 'disbursement' }];

beforeEach(() => {
  vi.clearAllMocks();
  api.listDebts.mockResolvedValue(DEBTS);
  api.listDebtEvents.mockResolvedValue(EVENTS);
  api.listLegalRates.mockResolvedValue([]);
});

describe('useDebtData', () => {
  it('goes from loading to ready with the debts and their events', async () => {
    const { result } = renderHook(() => useDebtData());

    expect(result.current).toMatchObject({ status: 'loading', debts: [], events: [] });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    expect(result.current).toMatchObject({ debts: [{ $id: 'db1', name: 'Libre inversión' }], events: EVENTS, error: null });
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

    expect(result.current.debts.map((debt) => debt.$id)).toEqual(['db1']);
  });
});

describe('useDebtData legal rates', () => {
  const USURY_ROW = { kind: 'usury', modality: 'consumer', validFrom: '2026-11-01', validTo: '2026-11-30', value: 2900, source: 'Resolución', verified: true };
  const capOf = (legal, validFrom) => legal.usuryTable.find((entry) => entry.modality === 'consumer' && entry.validFrom === validFrom)?.capEA;

  it('decorates every debt with the resolved household tables and exposes them with legalStatus ok', async () => {
    api.listLegalRates.mockResolvedValue([USURY_ROW]);
    api.listDebts.mockResolvedValue([...DEBTS, { $id: 'db2', name: 'Moto' }]);
    const { result } = renderHook(() => useDebtData());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    expect(result.current.legalStatus).toBe('ok');
    expect(result.current.legal.status).toBe('table');
    expect(result.current.debts).toHaveLength(2);
    for (const debt of result.current.debts) {
      expect(capOf(debt.legal, '2026-11-01')).toBe(29);
      expect(capOf(debt.legal, '2026-10-01')).toBe(28.59); // the code default fills the rest
    }
    expect(result.current.debts[0]).toMatchObject({ $id: 'db1', name: 'Libre inversión' });
  });

  it('an empty but readable table is ok and resolves to the code defaults', async () => {
    const { result } = renderHook(() => useDebtData());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    expect(result.current.legalStatus).toBe('ok');
    expect(result.current.legal.status).toBe('defaults');
    expect(capOf(result.current.debts[0].legal, '2026-10-01')).toBe(28.59);
  });

  it('a 404 (migration not run) still loads the debts, with code defaults and legalStatus missing', async () => {
    api.listLegalRates.mockRejectedValue(Object.assign(new Error('Collection not found'), { code: 404 }));
    const { result } = renderHook(() => useDebtData());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    expect(result.current).toMatchObject({ legalStatus: 'missing', error: null, events: EVENTS });
    expect(result.current.debts).toHaveLength(1);
    expect(result.current.debts[0].legal.status).toBe('unavailable');
    expect(capOf(result.current.debts[0].legal, '2026-10-01')).toBe(28.59);
    expect(result.current.legal.status).toBe('unavailable');
  });

  it('any other read failure is legalStatus unavailable and never turns the load into an error', async () => {
    api.listLegalRates.mockRejectedValue(Object.assign(new Error('Server error'), { code: 500 }));
    const { result } = renderHook(() => useDebtData());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    expect(result.current).toMatchObject({ legalStatus: 'unavailable', error: null });
    expect(result.current.debts[0].legal.status).toBe('unavailable');
  });

  it('a reload reads the rates again, so a saved rate or a recovered table shows up', async () => {
    api.listLegalRates.mockRejectedValueOnce(Object.assign(new Error('nope'), { code: 404 }));
    const { result } = renderHook(() => useDebtData());
    await waitFor(() => expect(result.current.legalStatus).toBe('missing'));
    api.listLegalRates.mockResolvedValue([USURY_ROW]);

    await act(() => result.current.reload());

    expect(result.current.legalStatus).toBe('ok');
    expect(capOf(result.current.debts[0].legal, '2026-11-01')).toBe(29);
  });

  it('a failed debts read is still an error even when the rates were readable', async () => {
    api.listDebts.mockRejectedValueOnce(new Error('sin conexión'));
    const { result } = renderHook(() => useDebtData());

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.debts).toEqual([]);
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

  describe('with fresh events', () => {
    const rateChange = {
      $id: 'rc1', $createdAt: '2026-03-01T10:00:00.000Z', debtId: 'd1', kind: 'rate_change', effectiveOn: '2026-01-20', amountMinor: 0,
      payloadJson: JSON.stringify({ rate: { value: 30, basis: 'effective', periodicity: 'annual', timing: 'arrears' }, mode: 'keep_term' }),
      actorId: 'u1', source: 'web', dedupeKey: 'krc1',
    };

    it('reads the debt events again so a change saved a moment ago is not missed by the stale hook state', async () => {
      const { result } = await ready([payment('e1', '2026-02-05')]); // the hook loaded before the rate change existed
      api.listDebtEvents.mockResolvedValueOnce([payment('e1', '2026-02-05'), rateChange]);
      api.listCostRows.mockResolvedValueOnce([row('dce1', 18088)]);

      const outcome = await result.current.reconcileCosts('d1', { fresh: true });

      expect(api.listDebtEvents).toHaveBeenLastCalledWith('d1');
      expect(outcome).toEqual({ created: 0, updated: 1, removed: 0 });
      expect(api.updateCostRow).toHaveBeenCalledWith('dce1', { amountMinor: 22104 }); // the backdated 30% EA re-costs the payment
    });

    it('does not read the events again by default, where the loaded state is current', async () => {
      const { result } = await ready([payment('e1', '2026-02-05')]);
      api.listCostRows.mockResolvedValueOnce([row('dce1', 18088)]);
      api.listDebtEvents.mockClear();

      expect(await result.current.reconcileCosts('d1')).toEqual({ created: 0, updated: 0, removed: 0 });
      expect(api.listDebtEvents).not.toHaveBeenCalled();
    });

    it('rejects and writes nothing when the fresh read fails', async () => {
      const { result } = await ready([payment('e1', '2026-02-05')]);
      api.listDebtEvents.mockRejectedValueOnce(new Error('timeout'));

      await expect(result.current.reconcileCosts('d1', { fresh: true })).rejects.toThrow('timeout');
      expect(api.listCostRows).not.toHaveBeenCalled();
      expect(api.updateCostRow).not.toHaveBeenCalled();
    });
  });
});
