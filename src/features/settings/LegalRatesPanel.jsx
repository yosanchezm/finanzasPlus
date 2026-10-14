import { useEffect, useId, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { dateInputValue } from '../../shared/lib/dates';
import { formatMoney } from '../../shared/lib/format';
import { Button } from '../../shared/ui/Button';
import { Card, CardHeader } from '../../shared/ui/Card';
import { Chip } from '../../shared/ui/Chip';
import { Badges } from './FormParts';
import RateForm from './RateForm';
import SmmlvForm from './SmmlvForm';
import { buildLegalRatesView, formatPercentEA } from './legalRatesModel';

const IDLE = { status: 'idle', error: null };
const noteClass = 'rounded-sm bg-shared-soft px-3 py-2.5 text-[13px] text-shared';

const initialRateDraft = (today) => ({ kind: 'ibc', modality: 'consumer', month: today.slice(0, 7), valueText: '', source: '', verified: false });
const initialSmmlvDraft = (today) => ({ year: today.slice(0, 4), valueText: '', source: '', verified: false });

function StatusBanner({ status, onReload }) {
  if (status === 'missing') {
    return (
      <div role="status" className={`${noteClass} flex flex-col gap-0.5`}>
        <b className="font-semibold">Falta actualizar la base de datos</b>
        <span>Mientras tanto se usan los valores de la app y no se pueden guardar tasas. Pide a quien administra el hogar que corra la actualización.</span>
      </div>
    );
  }
  if (status !== 'unavailable') return null;
  return (
    <div role="status" className={`${noteClass} flex flex-wrap items-center justify-between gap-2`}>
      <span className="flex flex-col gap-0.5">
        <b className="font-semibold">No pudimos leer las tasas legales</b>
        <span>Mientras tanto se usan los valores de la app.</span>
      </span>
      <Button variant="secondary" onClick={onReload}>Reintentar</Button>
    </div>
  );
}

function LoadingBlock() {
  return <div role="status" aria-label="Cargando tasas legales…" className="h-40 animate-pulse rounded-sm bg-surface-2 motion-reduce:animate-none" />;
}

function RateRow({ group, row, onEdit }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-3">
      <span className="min-w-36 text-sm font-medium text-ink">{row.monthLabel}</span>
      <b className="text-sm font-semibold text-ink tabular-nums">{formatPercentEA(row.capEA)} % E.A.</b>
      {row.ibcEA !== null && <span className="text-[13px] text-ink-muted tabular-nums">IBC {formatPercentEA(row.ibcEA)} %</span>}
      <Badges badges={row.badges} />
      {onEdit && (
        <Button variant="ghost" className="ml-auto" aria-label={`Editar ${group.label}, ${row.monthLabel}`} onClick={() => onEdit(group, row)}>
          <Pencil size={14} aria-hidden="true" />Editar
        </Button>
      )}
    </li>
  );
}

function CapGroup({ group, onEdit, onUpdateStale }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-1">
      <h3 id={titleId} className="text-sm font-semibold text-ink">{group.label}</h3>
      {group.stale && (
        <div className={`${noteClass} flex flex-wrap items-center gap-x-3 gap-y-2`}>
          <span><b className="font-semibold">{group.stale.currentLabel}</b>: {formatPercentEA(group.stale.capEA)} % E.A.</span>
          <Chip tone="danger">{group.stale.badge}</Chip>
          {onUpdateStale && <Button variant="secondary" className="ml-auto" onClick={() => onUpdateStale(group)}>Actualizar {group.stale.currentLabel}</Button>}
        </div>
      )}
      <ul className="flex flex-col divide-y divide-border">
        {group.rows.map((row) => <RateRow key={row.key} group={group} row={row} onEdit={onEdit} />)}
      </ul>
    </section>
  );
}

function SmmlvSection({ smmlv, readOnly, onEdit, onUpdateStale, children }) {
  const titleId = useId();
  return (
    <Card as="section" aria-labelledby={titleId} className="flex flex-col gap-5">
      <CardHeader title="Salario mínimo (SMMLV)" titleId={titleId} subtitle="Un valor por año; sirve para los avisos de la Ley 1555." />
      {smmlv.stale && (
        <div className={`${noteClass} flex flex-wrap items-center gap-x-3 gap-y-2`}>
          <span><b className="font-semibold">{smmlv.stale.currentYear}</b>: {formatMoney(smmlv.stale.valueMinor)}</span>
          <Chip tone="danger">{smmlv.stale.badge}</Chip>
          {!readOnly && <Button variant="secondary" className="ml-auto" onClick={() => onUpdateStale(smmlv.stale.currentYear)}>Registrar SMMLV {smmlv.stale.currentYear}</Button>}
        </div>
      )}
      <ul className="flex flex-col divide-y divide-border">
        {smmlv.rows.map((row) => (
          <li key={row.year} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-3">
            <span className="min-w-36 text-sm font-medium text-ink tabular-nums">{row.year}</span>
            <b className="text-sm font-semibold text-ink tabular-nums">{formatMoney(row.valueMinor)}</b>
            <Badges badges={row.badges} />
            {!readOnly && (
              <Button variant="ghost" className="ml-auto" aria-label={`Editar SMMLV ${row.year}`} onClick={() => onEdit(row)}>
                <Pencil size={14} aria-hidden="true" />Editar
              </Button>
            )}
          </li>
        ))}
      </ul>
      {children}
    </Card>
  );
}

/**
 * "Tasas legales" panel of Ajustes: usury caps and IBC by modality and month, and the SMMLV by year, with badges for
 * where each value comes from (derived, manual, app value), unverified and stale (carried forward) values, and forms to
 * enter or correct them. Informational only: the bank statement wins. When the table cannot be read (`missing`,
 * `unavailable`) the app values are shown read-only. `onSave(row)` resolves `true` when the row was saved;
 * `saveState` is `{ status: 'idle' | 'saving' | 'error', error }` for the form that submitted last.
 */
export default function LegalRatesPanel({ status, legal, today = dateInputValue(), saveState = IDLE, onSave, onReload }) {
  const titleId = useId();
  const [rateDraft, setRateDraft] = useState(() => initialRateDraft(today));
  const [smmlvDraft, setSmmlvDraft] = useState(() => initialSmmlvDraft(today));
  const [lastForm, setLastForm] = useState(null);
  const [focus, setFocus] = useState(null);
  const rateInput = useRef(null);
  const smmlvInput = useRef(null);

  useEffect(() => {
    if (focus) (focus.target === 'rate' ? rateInput : smmlvInput).current?.focus();
  }, [focus]);

  if (status === 'loading' || !legal) return <Card><LoadingBlock /></Card>;

  const view = buildLegalRatesView(legal, today);
  const readOnly = status !== 'ready';
  const stateOf = (form) => (lastForm === form ? saveState : IDLE);
  const patch = (setDraft) => (partial) => setDraft((draft) => ({ ...draft, ...partial }));
  const saveFrom = (form) => (row) => { setLastForm(form); return onSave(row); };

  const fillRate = (partial) => { setRateDraft((draft) => ({ ...draft, ...partial })); setFocus({ target: 'rate' }); };
  const editRate = (group, row) => fillRate({
    modality: group.modality,
    month: row.month,
    kind: row.origin === 'ibc' ? 'ibc' : 'usury',
    valueText: formatPercentEA(row.origin === 'ibc' ? row.ibcEA : row.capEA),
    source: row.source,
    verified: row.verified,
  });
  const updateStale = (group) => fillRate({ modality: group.modality, month: group.stale.currentMonth, kind: group.modality === 'mortgage' ? 'usury' : rateDraft.kind, valueText: '', source: '', verified: false });
  const addMortgage = () => fillRate({ modality: 'mortgage', month: today.slice(0, 7), kind: 'usury', valueText: '', source: '', verified: false });

  const fillSmmlv = (partial) => { setSmmlvDraft((draft) => ({ ...draft, ...partial })); setFocus({ target: 'smmlv' }); };
  const editSmmlv = (row) => fillSmmlv({ year: String(row.year), valueText: String(row.valueMinor), source: row.source, verified: row.verified });
  const updateSmmlv = (year) => fillSmmlv({ year: String(year), valueText: '', source: '', verified: false });

  return (
    <div className="flex flex-col gap-6">
      <Card as="section" aria-labelledby={titleId} className="flex flex-col gap-5">
        <CardHeader title="Tasas legales" titleId={titleId} subtitle="Tope de usura por modalidad y mes, con el IBC del que sale." />
        <p className="text-sm text-ink-muted">Informativo: el extracto del banco manda. Estas tasas solo sirven para avisos y para calcular la mora; nada se bloquea.</p>
        <StatusBanner status={status} onReload={onReload} />
        {view.groups.map((group) => (
          <CapGroup key={group.modality} group={group} onEdit={readOnly ? undefined : editRate} onUpdateStale={readOnly ? undefined : updateStale} />
        ))}
        {view.mortgageCapMissing && (
          <div className={`${noteClass} flex flex-wrap items-center gap-x-3 gap-y-2`}>
            <span>Hipotecario: aún no hay tope de usura. Regístralo para calcular la mora de una hipoteca.</span>
            {!readOnly && <Button variant="secondary" className="ml-auto" onClick={addMortgage}>Registrar tope hipotecario</Button>}
          </div>
        )}
        {!readOnly && (
          <RateForm draft={rateDraft} onChange={patch(setRateDraft)} legal={legal} today={today} saveState={stateOf('rate')} inputRef={rateInput} onSave={saveFrom('rate')} />
        )}
      </Card>

      <SmmlvSection smmlv={view.smmlv} readOnly={readOnly} onEdit={editSmmlv} onUpdateStale={updateSmmlv}>
        {!readOnly && <SmmlvForm draft={smmlvDraft} onChange={patch(setSmmlvDraft)} saveState={stateOf('smmlv')} inputRef={smmlvInput} onSave={saveFrom('smmlv')} />}
      </SmmlvSection>
    </div>
  );
}
