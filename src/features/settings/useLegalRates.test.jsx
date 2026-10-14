import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../../appwrite';
import { useLegalRates } from './useLegalRates';

vi.mock('../../appwrite', () => ({ listLegalRates: vi.fn(), upsertLegalRate: vi.fn() }));

const IBC_ROW = { $id: 'r1', kind: 'ibc', modality: 'consumer', validFrom: '2026-11-01', validTo: '2026-11-30', value: 1949, source: '', verified: false };
const NEW_ROW = { kind: 'usury', modality: 'mortgage', validFrom: '2026-11-01', validTo: '2026-11-30', value: 2200, source: 'Resolución', verified: true };

const capOf = (legal, modality, validFrom) => legal.usuryTable.find((entry) => entry.modality === modality && entry.validFrom === validFrom)?.capEA;

beforeEach(() => {
  vi.clearAllMocks();
  api.listLegalRates.mockResolvedValue([IBC_ROW]);
  api.upsertLegalRate.mockResolvedValue({});
});

describe('useLegalRates load', () => {
  it('goes from loading to ready with the resolved household tables', async () => {
    const { result } = renderHook(() => useLegalRates({ actorId: 'u1' }));

    expect(result.current).toMatchObject({ status: 'loading', legal: null });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    expect(capOf(result.current.legal, 'consumer', '2026-11-01')).toBe(29.24);
    expect(result.current.legal.status).toBe('table');
  });

  it('reports a missing table (404) and degrades to the code tables', async () => {
    api.listLegalRates.mockRejectedValue(Object.assign(new Error('Collection not found'), { code: 404 }));
    const { result } = renderHook(() => useLegalRates({ actorId: 'u1' }));

    await waitFor(() => expect(result.current.status).toBe('missing'));

    expect(result.current.legal.status).toBe('unavailable');
    expect(capOf(result.current.legal, 'consumer', '2026-10-01')).toBe(28.59);
  });

  it('reports any other read failure as unavailable, and reload recovers', async () => {
    api.listLegalRates.mockRejectedValueOnce(new Error('sin red'));
    const { result } = renderHook(() => useLegalRates({ actorId: 'u1' }));
    await waitFor(() => expect(result.current.status).toBe('unavailable'));

    await act(() => result.current.reload());

    expect(result.current.status).toBe('ready');
    expect(capOf(result.current.legal, 'consumer', '2026-11-01')).toBe(29.24);
  });
});

describe('useLegalRates save', () => {
  it('writes the row with the actor, then reloads the tables (no optimistic update)', async () => {
    const { result } = renderHook(() => useLegalRates({ actorId: 'u1' }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    api.listLegalRates.mockResolvedValue([IBC_ROW, { ...NEW_ROW, $id: 'r2' }]);
    expect(capOf(result.current.legal, 'mortgage', '2026-11-01')).toBeUndefined();

    let saved;
    await act(async () => { saved = await result.current.save(NEW_ROW); });

    expect(saved).toBe(true);
    expect(api.upsertLegalRate).toHaveBeenCalledWith({ ...NEW_ROW, actorId: 'u1' });
    expect(api.listLegalRates).toHaveBeenCalledTimes(2);
    expect(capOf(result.current.legal, 'mortgage', '2026-11-01')).toBe(22);
    expect(result.current.saveState).toEqual({ status: 'idle', error: null });
  });

  it('keeps the tables and exposes the error when the write fails, and a retry completes it', async () => {
    const { result } = renderHook(() => useLegalRates({ actorId: 'u1' }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    api.upsertLegalRate.mockRejectedValueOnce(Object.assign(new Error('El valor está fuera del rango permitido.'), { reason: 'value_out_of_range' }));

    let saved;
    await act(async () => { saved = await result.current.save(NEW_ROW); });

    expect(saved).toBe(false);
    expect(result.current.saveState).toEqual({ status: 'error', error: 'El valor está fuera del rango permitido.' });
    expect(api.listLegalRates).toHaveBeenCalledTimes(1);

    await act(async () => { saved = await result.current.save(NEW_ROW); });

    expect(saved).toBe(true);
    expect(result.current.saveState).toEqual({ status: 'idle', error: null });
    expect(api.upsertLegalRate).toHaveBeenCalledTimes(2);
  });

  it('writes once when the form is submitted twice in a row', async () => {
    let finish;
    api.upsertLegalRate.mockImplementation(() => new Promise((resolve) => { finish = () => resolve({}); }));
    const { result } = renderHook(() => useLegalRates({ actorId: 'u1' }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let first;
    let second;
    await act(async () => {
      first = result.current.save(NEW_ROW);
      second = result.current.save(NEW_ROW);
    });
    expect(result.current.saveState.status).toBe('saving');
    await act(async () => { finish(); await Promise.all([first, second]); });

    expect(api.upsertLegalRate).toHaveBeenCalledTimes(1);
    await expect(second).resolves.toBe(false);
  });

  it('does not write while the table cannot be read', async () => {
    api.listLegalRates.mockRejectedValue(Object.assign(new Error('missing'), { code: 404 }));
    const { result } = renderHook(() => useLegalRates({ actorId: 'u1' }));
    await waitFor(() => expect(result.current.status).toBe('missing'));

    let saved;
    await act(async () => { saved = await result.current.save(NEW_ROW); });

    expect(saved).toBe(false);
    expect(api.upsertLegalRate).not.toHaveBeenCalled();
  });
});
