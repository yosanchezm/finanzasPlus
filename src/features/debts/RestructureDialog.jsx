import { useMemo, useState } from 'react';
import { formatMoney } from '../../shared/lib/format';
import { Button } from '../../shared/ui/Button';
import { DialogContent, DialogHeader, DialogRoot } from '../../shared/ui/Dialog';
import { TextField } from '../../shared/ui/TextField';
import ChargesEditor from './ChargesEditor';
import RateField from './RateField';
import { STEPS, canAdvance, initialRestructureForm, restructureView, systemsFor } from './restructureModel';
import PlanStep from './wizard/steps/PlanStep';

function SituationStep({ view, form, set }) {
  const { situation } = view;
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <TextField label="Vigente desde" type="date" value={form.effectiveOn} onChange={(event) => set({ effectiveOn: event.target.value })} />
        <p className="text-[13px] text-ink-muted">Esto es lo que pasaría al nuevo plan si lo cambias desde esa fecha.</p>
      </div>
      {situation.ok ? (
        <div role="group" aria-label="Lo que se refinancia" className="flex flex-col gap-2 rounded-sm bg-surface-2 p-4">
          <table className="w-full text-sm">
            <tbody>
              {situation.rows.map((row) => (
                <tr key={row.key} className="border-t border-[#eef1ed] first:border-t-0">
                  <th scope="row" className="py-2 pr-3 text-left font-normal text-ink-muted">{row.label}</th>
                  <td className="py-2 text-right text-ink tabular-nums">{formatMoney(row.minor)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border-strong">
                <th scope="row" className="pt-3 pr-3 text-left font-semibold text-ink">Saldo que se refinancia</th>
                <td className="pt-3 text-right font-semibold text-ink tabular-nums">{formatMoney(situation.totalMinor)}</td>
              </tr>
            </tfoot>
          </table>
          {view.waivable && <p className="text-[13px] text-ink-muted">Si quieres, en el siguiente paso puedes condonar la mora.</p>}
        </div>
      ) : (
        <p role="alert" className="text-sm font-medium text-danger">{situation.issue}</p>
      )}
    </>
  );
}

function TermsStep({ view, form, set, kind }) {
  const issues = Object.entries(view.plan.issues);
  const planState = { ...form, kind, openedOn: form.effectiveOn };
  return (
    <>
      <RateField rate={form.rate} echo={view.echo} onChange={(patch) => set({ rate: { ...form.rate, ...patch } })} />
      <PlanStep state={planState} set={set} systems={systemsFor(kind)} invalid={view.plan.issues} />
      {issues.map(([field, message]) => <p key={field} role="alert" className="text-sm font-medium text-danger">{message}</p>)}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-ink-2">Seguros y cargos</h3>
        <ChargesEditor rows={form.chargeRows} onChange={(chargeRows) => set({ chargeRows })} />
      </div>

      {view.waivable && (
        <label className="flex items-start gap-3 rounded-sm border border-border-strong p-3 text-sm text-ink has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
          <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-accent" checked={view.waive} onChange={(event) => set({ waiveLate: event.target.checked })} />
          <span className="flex flex-col gap-0.5">
            <b className="font-semibold">Condonar los intereses de mora</b>
            <span className="text-[13px] text-ink-muted">La mora de {formatMoney(view.waivableMinor)} no pasa al nuevo plan.</span>
          </span>
        </label>
      )}
      {view.situation.ok && <p className="text-sm text-ink-muted">Saldo que se refinancia: <b className="font-semibold text-ink tabular-nums">{formatMoney(view.carriedMinor)}</b></p>}
    </>
  );
}

/**
 * Restructure form in three steps: 1) the arrears the restructure refinances, with the mora; 2) the new conditions
 * (rate, system, periodicity, number of installments, first due date after the effective date, grace or balloon,
 * charges, and whether to forgive the mora); 3) the summary. See `restructureModel`.
 * `saveState`: `{ status, error, locked }`; `onSubmit(draft)` receives the `restructure` draft to write.
 */
export default function RestructureDialog({ debt, events, projection, today, saveState, onSubmit, onClose }) {
  const [form, setForm] = useState(() => initialRestructureForm(projection, today));
  const [step, setStep] = useState(STEPS[0].key);
  const view = useMemo(() => restructureView({ debt, events, projection, form }), [debt, events, projection, form]);
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));
  const index = STEPS.findIndex((item) => item.key === step);
  const saving = saveState.status === 'saving';
  const ready = canAdvance(step, view);

  const submit = (event) => {
    event.preventDefault();
    if (ready && !saving && index < STEPS.length - 1) setStep(STEPS[index + 1].key);
  };

  return (
    <DialogRoot open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent variant="center" aria-describedby={undefined}>
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogHeader title="Reestructurar" description={`Paso ${index + 1} de ${STEPS.length}: ${STEPS[index].title}`} />
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
            {step === 'situation' && <SituationStep view={view} form={form} set={set} />}
            {step === 'terms' && <TermsStep view={view} form={form} set={set} kind={projection.terms.kind} />}
          </div>
          <div className="flex justify-end gap-2 border-t border-[#eef1ed] px-6 py-4 pb-[calc(16px+env(safe-area-inset-bottom))] sm:pb-4">
            {index > 0 && <Button variant="secondary" disabled={saving} onClick={() => setStep(STEPS[index - 1].key)}>Atrás</Button>}
            <Button type="submit" disabled={!ready || saving}>Siguiente</Button>
          </div>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}
