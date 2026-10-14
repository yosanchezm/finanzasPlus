import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveLegal } from '@finance-core';
import { createCostRow, deleteCostRow, ensureCostCategory, listCostRows, listDebtEvents, listDebts, listLegalRates, updateCostRow } from '../../appwrite';
import { planReconcile } from './reconcile';

const LOADING = { status: 'loading', debts: [], events: [], error: null, legal: null, legalStatus: null };

const isMissingTable = (error) => error?.code === 404 || error?.status === 404;

// The household legal tables (LR6): a table that cannot be read never fails the load. Debts then compute with the
// code tables, and `legalStatus` says why: 'missing' (404: the migration has not run) or 'unavailable' (any other failure).
async function readLegal() {
  try {
    return { legal: resolveLegal(await listLegalRates()), legalStatus: 'ok' };
  } catch (error) {
    return { legal: resolveLegal.unavailable(), legalStatus: isMissingTable(error) ? 'missing' : 'unavailable' };
  }
}

/**
 * Loads debts, their events and the household legal tables when the Deudas view mounts (AD9). Every debt is
 * decorated with the same resolved `legal` tables (also returned as `legal`, with `legalStatus`: 'ok' | 'missing' | 'unavailable'). No optimistic updates and
 * no stale data: a failed load or reload leaves `status: 'error'` with empty rows, so the view
 * never shows balances it could not confirm. Only the newest request may update the state.
 * - `retry()`: back to `loading`, then fetch. `reload()`: fetch while the current rows stay visible.
 * Both resolve (never reject); read `status` and `error`.
 * - `reconcileCosts(debtId, { fresh })`: repairs the debt's cost rows against its events (AD8) and resolves with
 *   `{ created, updated, removed }`. It rejects when a read or a repair write fails. It reads the events held in state,
 *   which are current right after a load; right after a save pass `{ fresh: true }` to read that debt's events again,
 *   because the state only catches up on the next render (AD16).
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
      const [rows, events, { legal, legalStatus }] = await Promise.all([listDebts(), listDebtEvents(), readLegal()]);
      const debts = rows.map((debt) => ({ ...debt, legal }));
      if (request === latest.current) setState({ status: 'ready', debts, events, error: null, legal, legalStatus });
    } catch (error) {
      if (request === latest.current) setState({ ...LOADING, status: 'error', error });
    }
  }, []);

  useEffect(() => { load({ showLoading: false }); }, [load]);

  const retry = useCallback(() => load({ showLoading: true }), [load]);
  const reload = useCallback(() => load({ showLoading: false }), [load]);

  const reconcileCosts = useCallback(async (debtId, { fresh = false } = {}) => {
    const none = { created: 0, updated: 0, removed: 0 };
    const debt = current.current.debts.find((item) => item.$id === debtId);
    if (!debt) return none;
    const events = fresh ? await listDebtEvents(debtId) : current.current.events.filter((event) => event.debtId === debtId);
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
