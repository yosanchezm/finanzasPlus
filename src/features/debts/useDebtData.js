import { useCallback, useEffect, useRef, useState } from 'react';
import { createCostRow, deleteCostRow, ensureCostCategory, listCostRows, listDebtEvents, listDebts, updateCostRow } from '../../appwrite';
import { planReconcile } from './reconcile';

const LOADING = { status: 'loading', debts: [], events: [], error: null };

/**
 * Loads debts and their events when the Deudas view mounts (AD9). No optimistic updates and
 * no stale data: a failed load or reload leaves `status: 'error'` with empty rows, so the view
 * never shows balances it could not confirm. Only the newest request may update the state.
 * - `retry()`: back to `loading`, then fetch. `reload()`: fetch while the current rows stay visible.
 * Both resolve (never reject); read `status` and `error`.
 * - `reconcileCosts(debtId)`: repairs the debt's cost rows against its events (AD8) and resolves with
 *   `{ created, updated, removed }`. It rejects when a read or a repair write fails.
 */
export function useDebtData() {
  const [state, setState] = useState(LOADING);
  const latest = useRef(0);
  const current = useRef(state);
  current.current = state;

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

  const reconcileCosts = useCallback(async (debtId) => {
    const none = { created: 0, updated: 0, removed: 0 };
    const debt = current.current.debts.find((item) => item.$id === debtId);
    if (!debt) return none;
    const events = current.current.events.filter((event) => event.debtId === debtId);
    const plan = planReconcile(debt, events, await listCostRows(debtId));
    if (plan.create.length > 0) {
      const categoryId = await ensureCostCategory(debt.householdId);
      for (const row of plan.create) await createCostRow({ id: row.id, data: { ...row.data, categoryId } });
    }
    for (const change of plan.update) await updateCostRow(change.id, change.data);
    for (const id of plan.remove) await deleteCostRow(id);
    return { ...none, created: plan.create.length, updated: plan.update.length, removed: plan.remove.length };
  }, []);

  return { ...state, retry, reload, reconcileCosts };
}
