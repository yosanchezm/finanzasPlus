import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { formatMoney } from '../../shared/lib/format';
import { Button } from '../../shared/ui/Button';
import { DialogContent, DialogHeader, DialogRoot } from '../../shared/ui/Dialog';
import { TextField } from '../../shared/ui/TextField';
import BackdatedNotice from './BackdatedNotice';
import BeforeAfterPreview from './BeforeAfterPreview';
import ChargesEditor from './ChargesEditor';
import RateField from './RateField';
import { formatDueDate } from './debtLabels';
import { STEPS, canAdvance, initialRestructureForm, previewRestructure, restructureView, systemsFor } from './restructureModel';
import Notices from './wizard/Notices';
import PlanStep from './wizard/steps/PlanStep';
import { PERIODICITY_ADJECTIVES, SYSTEM_LABELS } from './wizard/wizardModel';

// "mensual" -> "mensuales"; "cada 14 días" stays as it is.
const plural = (adjective) => (adjective.endsWith('l') ? `${adjective}es` : adjective);
const dateOrDash = (day) => (day ? formatDueDate(day) : '—');

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

function PlanSummary({ view }) {
  const { terms } = view.plan;
  const rows = [
    ['Tasa', view.echo.label],
    ['Sistema', SYSTEM_LABELS[terms.system]],
    ['Plazo', `${terms.n} cuotas ${plural(PERIODICITY_ADJECTIVES[terms.periodicity])}`],
    ['Primera cuota', dateOrDash(terms.firstDueOn)],
    ...(view.waive ? [['Mora condonada', formatMoney(view.waivableMinor)]] : []),
  ];
  return (
    <div role="group" aria-label="Nuevo plan" className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-ink-2">Nuevo plan</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-ink-muted">{label}</dt>
            <dd className="text-right text-ink tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function SummaryStep({ view, preview, saveState }) {
  const { before, after } = preview;
  const rows = before && after ? [
    { label: 'Saldo', before: formatMoney(before.balanceMinor), after: formatMoney(after.balanceMinor) },
    { label: 'Vencido', before: formatMoney(before.pastDueMinor), after: formatMoney(after.pastDueMinor) },
    ...(before.lateInterestMinor > 0 || after.lateInterestMinor > 0
      ? [{ label: 'Mora por pagar', before: formatMoney(before.lateInterestMinor), after: formatMoney(after.lateInterestMinor) }] : []),
    { label: 'Próxima cuota', before: formatMoney(before.installmentMinor), after: formatMoney(after.installmentMinor) },
    { label: 'Cuotas restantes', before: before.remainingPeriods, after: after.remainingPeriods },
    { label: 'Intereses por pagar', before: formatMoney(before.remainingInterestMinor), after: formatMoney(after.remainingInterestMinor) },
    { label: 'Última cuota', before: dateOrDash(before.lastDueOn), after: dateOrDash(after.lastDueOn) },
  ] : [];
  return (
    <>
      {preview.backdated && <BackdatedNotice impacted={preview.impacted} />}
      <PlanSummary view={view} />
      {view.echo.notice && <Notices notices={[view.echo.notice]} />}
      {rows.length > 0 && <BeforeAfterPreview rows={rows} />}
      {preview.issue && <p role="alert" className="text-sm font-medium text-danger">{preview.issue}</p>}
      {saveState.status === 'error' && <p role="alert" className="text-sm font-medium text-danger">{saveState.error}</p>}
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
  const preview = useMemo(
    () => (step === 'summary' ? previewRestructure({ debt, events, view, form, today }) : null),
    [step, debt, events, view, form, today],
  );
  const index = STEPS.findIndex((item) => item.key === step);
  const last = index === STEPS.length - 1;
  const saving = saveState.status === 'saving';
  const ready = canAdvance(step, view, preview);
  const primaryLabel = !last ? 'Siguiente' : saving ? 'Guardando…' : saveState.status === 'error' ? 'Reintentar' : 'Guardar reestructuración';

  const submit = (event) => {
    event.preventDefault();
    if (!ready || saving) return;
    if (last) onSubmit(preview.draft);
    else setStep(STEPS[index + 1].key);
  };

  return (
    <DialogRoot open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent variant="center" aria-describedby={undefined}>
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogHeader title="Reestructurar" description={`Paso ${index + 1} de ${STEPS.length}: ${STEPS[index].title}`} />
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
            {step === 'situation' && <SituationStep view={view} form={form} set={set} />}
            {step === 'terms' && <TermsStep view={view} form={form} set={set} kind={projection.terms.kind} />}
            {last && <SummaryStep view={view} preview={preview} saveState={saveState} />}
          </div>
          <div className="flex justify-end gap-2 border-t border-[#eef1ed] px-6 py-4 pb-[calc(16px+env(safe-area-inset-bottom))] sm:pb-4">
            {index > 0 && <Button variant="secondary" disabled={saving} onClick={() => setStep(STEPS[index - 1].key)}>Atrás</Button>}
            <Button type="submit" disabled={!ready || saving}>{last && <Check size={16} aria-hidden="true" />}{primaryLabel}</Button>
          </div>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}
