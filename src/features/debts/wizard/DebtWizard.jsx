import { useMemo, useReducer } from 'react';
import { Check } from 'lucide-react';
import { dateInputValue } from '../../../shared/lib/dates';
import { Button } from '../../../shared/ui/Button';
import { DialogContent, DialogHeader, DialogRoot } from '../../../shared/ui/Dialog';
import BasicsStep from './steps/BasicsStep';
import ChargesStep from './steps/ChargesStep';
import KindStep from './steps/KindStep';
import PlanStep from './steps/PlanStep';
import RateStep from './steps/RateStep';
import ReviewStep from './steps/ReviewStep';
import { STEP_TITLES, evaluate, initialWizard, rateEcho, stepsFor, wizardReducer } from './wizardModel';

/**
 * "Nueva deuda" dialog. Presentational: it validates through the wizard model and hands the
 * finished `{ name, lender, ownerScope, terms }` to `onSubmit`; the container does the writing.
 * `saveState` is `{ status: 'idle' | 'saving' | 'error', error? }`; after a failure the dialog and
 * every input stay as they were and the primary button becomes "Reintentar".
 */
export default function DebtWizard({ saveState, onSubmit, onClose, today = dateInputValue() }) {
  const [state, dispatch] = useReducer(wizardReducer, today, initialWizard);
  const result = useMemo(() => evaluate(state), [state]);
  const set = (patch) => dispatch({ type: 'set', patch });

  const steps = stepsFor(state.kind);
  const index = steps.indexOf(state.step);
  const isReview = state.step === 'review';
  const saving = saveState.status === 'saving';
  const stepIssue = result.issues.find((issue) => issue.step === state.step);
  const canContinue = state.step === 'kind' ? Boolean(state.kind) : isReview ? result.issues.length === 0 : !stepIssue;

  const submit = (event) => {
    event.preventDefault();
    if (!canContinue || saving) return;
    if (!isReview) dispatch({ type: 'step', to: 'next' });
    else onSubmit({ name: state.name.trim(), lender: state.lender.trim(), ownerScope: state.ownerScope, terms: result.terms });
  };

  const body = () => {
    switch (state.step) {
      case 'kind': return <KindStep kind={state.kind} onPick={(kind) => { dispatch({ type: 'kind', kind }); dispatch({ type: 'step', to: 'next' }); }} />;
      case 'basics': return <BasicsStep state={state} set={set} />;
      case 'rate': return <RateStep rate={state.rate} echo={rateEcho(state.rate, state.kind === 'mortgage' ? 'mortgage' : 'consumer', state.openedOn)} onChange={(patch) => dispatch({ type: 'rate', patch })} />;
      case 'plan': return <PlanStep state={state} set={set} />;
      case 'charges': return <ChargesStep charges={state.charges} dispatch={dispatch} />;
      default: return <ReviewStep result={result} />;
    }
  };

  const primaryLabel = !isReview ? 'Siguiente' : saving ? 'Guardando…' : saveState.status === 'error' ? 'Reintentar' : 'Guardar deuda';

  return (
    <DialogRoot open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent variant="center" aria-describedby={undefined}>
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogHeader title="Nueva deuda" description={`Paso ${index + 1} de ${steps.length}: ${STEP_TITLES[state.step]}`} />
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
            {body()}
            {stepIssue && !stepIssue.missing && <p role="alert" className="text-sm font-medium text-danger">{stepIssue.message}</p>}
            {isReview && saveState.status === 'error' && <p role="alert" className="text-sm font-medium text-danger">{saveState.error}</p>}
          </div>
          <div className="flex justify-end gap-2 border-t border-[#eef1ed] px-6 py-4 pb-[calc(16px+env(safe-area-inset-bottom))] sm:pb-4">
            {index > 0 && <Button variant="secondary" disabled={saving} onClick={() => dispatch({ type: 'step', to: 'back' })}>Atrás</Button>}
            <Button type="submit" disabled={!canContinue || saving}>
              {isReview && <Check size={16} aria-hidden="true" />}{primaryLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}
