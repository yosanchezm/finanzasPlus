import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveLegal } from '@finance-core';
import { listLegalRates, upsertLegalRate } from '../../appwrite';
import { readableError } from '../../shared/lib/errors';

const IDLE = { status: 'idle', error: null };
const isMissingTable = (error) => error?.code === 404 || error?.status === 404;

/**
 * The household legal tables for Ajustes. `status`: 'loading' | 'ready' | 'missing' (404: the migration has not run)
 * | 'unavailable' (any other read failure). Unless 'ready', `legal` holds the code tables so the panel can still
 * show what the app uses; saving is refused then.
 * - `reload()` fetches again and resolves (never rejects). Only the newest request may update the state.
 * - `save(row)` upserts the row with the actor, then reloads (no optimistic update). It resolves `true` when
 *   saved and `false` otherwise (`saveState.error` says why; the same id is rewritten on retry, so a retry is safe).
 *   A second call while one is running is ignored.
 */
export function useLegalRates({ actorId }) {
  const [state, setState] = useState({ status: 'loading', legal: null });
  const [saveState, setSaveState] = useState(IDLE);
  const latest = useRef(0);
  const status = useRef('loading');
  const busy = useRef(false);

  const load = useCallback(async () => {
    const request = ++latest.current;
    let next;
    try {
      next = { status: 'ready', legal: resolveLegal(await listLegalRates()) };
    } catch (error) {
      next = { status: isMissingTable(error) ? 'missing' : 'unavailable', legal: resolveLegal.unavailable() };
    }
    if (request !== latest.current) return;
    status.current = next.status;
    setState(next);
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = useCallback(async (row) => {
    if (busy.current || status.current !== 'ready') return false;
    busy.current = true;
    setSaveState({ status: 'saving', error: null });
    try {
      await upsertLegalRate({ ...row, actorId });
    } catch (error) {
      setSaveState({ status: 'error', error: readableError(error) });
      busy.current = false;
      return false;
    }
    await load();
    setSaveState(IDLE);
    busy.current = false;
    return true;
  }, [actorId, load]);

  return { ...state, saveState, reload: load, save };
}
