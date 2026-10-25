import { useRef, useState } from 'react';
import { planLineEdit, resolveLines, targetKey } from '@finance-core';
import { saveBudgetLine, updateBudgetLine } from '../../appwrite';
import { readableError } from '../../shared/lib/errors';
import { Button } from '../../shared/ui/Button';
import BudgetHeader from './BudgetHeader';
import BudgetView from './BudgetView';
import { GROUP_LABELS } from './groupLabels';
import LineEditorDialog from './LineEditorDialog';

const IDLE = { status: 'idle', error: null };

/**
 * Container of Presupuesto: owns the save state and the refresh, and hands the month figures to the view.
 * No optimistic updates (as in Deudas): `onCommit(write)` runs the write, refreshes the data, and only then
 * returns to idle. A failed write keeps its error and "Reintentar" repeats the same write.
 */
export default function BudgetContainer({ budgetMonth, canEdit, linesMode, scope, lines = [], actorId, onRefresh, ...viewProps }) {
  const [saveState, setSaveState] = useState(IDLE);
  const [editing, setEditing] = useState(null);
  const [planError, setPlanError] = useState('');
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

  const month = budgetMonth.month;
  const categories = viewProps.allCategories || [];
  const category = (target) => categories.find((item) => item.$id === target.targetId);
  const key = editing && targetKey(editing);
  const current = editing ? resolveLines(lines, month).get(key) : null;
  const monthOverride = editing ? lines.some((line) => targetKey(line) === key && line.fromMonth === month && line.toMonth === month) : false;

  // The plan is written in order (close the old line, then upsert the new one); a retry repeats the same ids.
  const submit = async ({ action, span, rule, value }) => {
    const plan = planLineEdit(lines, {
      target: { targetType: editing.targetType, targetId: editing.targetId }, rule, value, month, span, action,
      actorId, source: 'web', categoriesById: new Map(categories.map((item) => [item.$id, item])),
    });
    if (!plan.ok) { setPlanError('No se pudo preparar el cambio: revisa el valor e inténtalo de nuevo.'); return; }
    setPlanError('');
    const write = async () => {
      for (const row of plan.updates) await updateBudgetLine(row.id, row.data);
      for (const row of plan.creates) await saveBudgetLine(row.id, row.data);
    };
    try { await commit(write); setEditing(null); } catch { /* the dialog shows the error */ }
  };

  const retry = () => commit(lastWrite.current).then(() => setEditing(null)).catch(() => {});

  return (
    <BudgetView
      {...viewProps}
      budgetMonth={budgetMonth}
      canEdit={canEdit}
      linesMode={linesMode}
      saveState={saveState}
      onCommit={commit}
      onEditLine={canEdit ? (target) => { setPlanError(''); setEditing(target); } : undefined}
      header={(
        <>
          <BudgetHeader budgetMonth={budgetMonth} scope={scope} linesMode={linesMode} />
          {editing && (
            <LineEditorDialog
              name={editing.targetType === 'group' ? GROUP_LABELS[editing.targetId] || editing.targetId : category(editing)?.name || 'categoría'}
              kind={editing.targetId === 'income' ? 'income' : category(editing)?.kind}
              initial={current}
              base={budgetMonth.base}
              monthOverride={monthOverride}
              busy={saveState.status === 'saving'}
              error={planError || (saveState.status === 'error' ? saveState.error : '')}
              onRetry={planError ? undefined : retry}
              onSubmit={submit}
              onClose={() => setEditing(null)}
            />
          )}
          {saveState.status === 'error' && !editing && (
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
