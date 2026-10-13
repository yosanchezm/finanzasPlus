import { useRef, useState } from 'react';
import { CommitError } from '@finance-core';
import { readableError } from '../../shared/lib/errors';

const IDLE = { status: 'idle', error: null, locked: false };
const UNKNOWN = 'No pudimos confirmar si el intento anterior se guardó. Vuelve a intentarlo.';
const PARTIAL = 'El movimiento se guardó, pero falta actualizar su gasto financiero. Pulsa Reintentar para completarlo.';

/**
 * State machine of a dialog that writes through `commitPlan` (no optimistic updates).
 * - `open(context)` starts a dialog with a fresh nonce; a retry of the same input reuses it, so the writes are idempotent.
 *   If the input was edited after a failure it is a different movement, but a failed attempt may still have reached the
 *   server: `findSaved({ nonce, context })` must say whether it did. If it did, nothing more is written (the dialog closes
 *   after a reload); a new nonce is minted only when it is known that nothing was saved, and while that is unknown
 *   (the check fails) the nonce stays and the form asks to retry.
 * - `submit(input)` runs `save({ input, nonce, context })`; only after it resolves does it `reload()`, then `onRefresh()`.
 * - A half-saved write (`CommitError`: event saved, expense not) locks the form until the retry completes it;
 *   closing a locked dialog reloads, so the saved event shows.
 * @returns {{ dialog: ({ context: unknown, nonce: string, signature: (string | null) } | null),
 *   saveState: { status: string, error: (string | null), locked: boolean }, open: Function, close: Function, submit: Function }}
 */
export function useCommitDialog({ createNonce, save, findSaved, reload, onRefresh, onNotify, successMessage, alreadySaved }) {
  const [dialog, setDialog] = useState(null);
  const [saveState, setSaveState] = useState(IDLE);
  const busy = useRef(false);

  const open = (context = null) => {
    setSaveState(IDLE);
    setDialog({ context, nonce: createNonce(), signature: null });
  };

  const close = async () => {
    if (busy.current) return;
    const stale = saveState.locked;
    setDialog(null);
    setSaveState(IDLE);
    if (stale) await reload();
  };

  const submit = async (input) => {
    if (busy.current) return;
    busy.current = true;
    const signature = JSON.stringify(input);
    let { nonce } = dialog;
    if (dialog.signature && dialog.signature !== signature) {
      let saved;
      try {
        saved = await findSaved({ nonce, context: dialog.context });
      } catch {
        setSaveState({ status: 'error', error: UNKNOWN, locked: true });
        busy.current = false;
        return;
      }
      if (saved) {
        await reload();
        Promise.resolve(onRefresh?.()).catch(() => {});
        setDialog(null);
        setSaveState(IDLE);
        busy.current = false;
        onNotify?.(alreadySaved);
        return;
      }
      nonce = createNonce();
    }
    setDialog({ ...dialog, nonce, signature });
    setSaveState({ status: 'saving', error: null, locked: false });
    try {
      await save({ input, nonce, context: dialog.context });
    } catch (error) {
      const partial = error instanceof CommitError;
      const message = partial ? PARTIAL : readableError(error);
      setSaveState({ status: 'error', error: message, locked: partial });
      onNotify?.(message);
      busy.current = false;
      return;
    }
    await reload();
    Promise.resolve(onRefresh?.()).catch(() => {});
    setDialog(null);
    setSaveState(IDLE);
    busy.current = false;
    onNotify?.(successMessage(input));
  };

  return { dialog, saveState, open, close, submit };
}
