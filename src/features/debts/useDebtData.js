import { useCallback, useEffect, useRef, useState } from 'react';
import { listDebtEvents, listDebts } from '../../appwrite';

const LOADING = { status: 'loading', debts: [], events: [], error: null };

/**
 * Loads debts and their events when the Deudas view mounts (AD9). No optimistic updates and
 * no stale data: a failed load or reload leaves `status: 'error'` with empty rows, so the view
 * never shows balances it could not confirm. Only the newest request may update the state.
 * - `retry()`: back to `loading`, then fetch. `reload()`: fetch while the current rows stay visible.
 * Both resolve (never reject); read `status` and `error`.
 */
export function useDebtData() {
  const [state, setState] = useState(LOADING);
  const latest = useRef(0);

  const load = useCallback(async ({ showLoading }) => {
    const request = ++latest.current;
    if (showLoading) setState(LOADING);
    try {
      const [debts, events] = await Promise.all([listDebts(), listDebtEvents()]);
      if (request === latest.current) setState({ status: 'ready', debts, events, error: null });
    } catch (error) {
      if (request === latest.current) setState({ status: 'error', debts: [], events: [], error });
    }
  }, []);

  useEffect(() => { load({ showLoading: false }); }, [load]);

  const retry = useCallback(() => load({ showLoading: true }), [load]);
  const reload = useCallback(() => load({ showLoading: false }), [load]);
  return { ...state, retry, reload };
}
