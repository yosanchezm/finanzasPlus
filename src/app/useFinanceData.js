import { useCallback, useEffect, useRef, useState } from 'react';
import { getTransactionsInRange, getWorkspace } from '../appwrite';
import { addMonths, monthRange } from '../shared/lib/dates';

export const HISTORY_MONTHS = 5;

const EMPTY_PERIOD = { month: null, transactions: [], history: [] };

/**
 * Workspace data that stays mounted while it refreshes.
 * - `workspace`: household, members, categories, budgets, goals (every row, paginated).
 * - `period`: the selected month's transactions plus the raw rows of the 5 months before it,
 *   which the container aggregates per month (with the scope filter applied).
 * Requests for a month that is no longer selected are ignored when they resolve.
 */
export function useFinanceData(initialWorkspace, month) {
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [period, setPeriod] = useState(EMPTY_PERIOD);
  const [periodLoading, setPeriodLoading] = useState(false);
  const [periodError, setPeriodError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const latestRequest = useRef(0);

  const loadPeriod = useCallback(async (target) => {
    const request = ++latestRequest.current;
    setPeriodLoading(true);
    setPeriodError(null);
    try {
      const { start, end } = monthRange(target);
      const [transactions, history] = await Promise.all([
        getTransactionsInRange(start, end),
        getTransactionsInRange(monthRange(addMonths(target, -HISTORY_MONTHS)).start, start),
      ]);
      if (request === latestRequest.current) setPeriod({ month: target, transactions, history });
    } catch (error) {
      if (request === latestRequest.current) setPeriodError(error);
      throw error;
    } finally {
      if (request === latestRequest.current) setPeriodLoading(false);
    }
  }, []);

  useEffect(() => {
    // The error is kept in state and rendered by the container.
    loadPeriod(month).catch(() => {});
  }, [month, loadPeriod]);

  /** Reloads everything in place. Rejects so callers can report the failure. */
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [nextWorkspace] = await Promise.all([getWorkspace(), loadPeriod(month)]);
      setWorkspace(nextWorkspace);
    } finally {
      setRefreshing(false);
    }
  }, [month, loadPeriod]);

  return {
    workspace,
    period,
    periodReady: period.month === month,
    periodLoading,
    periodError,
    refreshing,
    refresh,
    retryPeriod: () => loadPeriod(month).catch(() => {}),
  };
}
