import { useRef, useState } from 'react';
import { readableError } from '../../shared/lib/errors';
import { Button } from '../../shared/ui/Button';
import BudgetHeader from './BudgetHeader';
import BudgetView from './BudgetView';

const IDLE = { status: 'idle', error: null };

/**
 * Container of Presupuesto: owns the save state and the refresh, and hands the month figures to the view.
 * No optimistic updates (as in Deudas): `onCommit(write)` runs the write, refreshes the data, and only then
 * returns to idle. A failed write keeps its error and "Reintentar" repeats the same write.
 */
export default function BudgetContainer({ budgetMonth, canEdit, linesMode, scope, onRefresh, ...viewProps }) {
  const [saveState, setSaveState] = useState(IDLE);
  const lastWrite = useRef(null);

  const commit = async (write) => {
    lastWrite.current = write;
    setSaveState({ status: 'saving', error: null });
    try {
      await write();
    } catch (error) {
      setSaveState({ status: 'error', error: readableError(error) });
      throw error;
    }
    setSaveState(IDLE);
    lastWrite.current = null;
    await Promise.resolve(onRefresh?.()).catch(() => {});
  };

  const retry = () => commit(lastWrite.current).catch(() => {});

  return (
    <BudgetView
      {...viewProps}
      budgetMonth={budgetMonth}
      canEdit={canEdit}
      linesMode={linesMode}
      saveState={saveState}
      onCommit={commit}
      header={(
        <>
          <BudgetHeader budgetMonth={budgetMonth} scope={scope} linesMode={linesMode} />
          {saveState.status === 'error' && (
            <div role="alert" className="flex flex-col gap-2 rounded-sm bg-danger-soft px-4 py-3 text-sm text-[#9a3412] sm:flex-row sm:items-center sm:justify-between">
              <span>{saveState.error}</span>
              <Button variant="secondary" onClick={retry}>Reintentar</Button>
            </div>
          )}
        </>
      )}
    />
  );
}
