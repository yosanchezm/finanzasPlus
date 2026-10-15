import { useId } from 'react';
import { rateInForce, toEffectiveAnnual } from '@finance-core';
import { ArrowLeft, Calculator, Wallet } from 'lucide-react';
import { formatMoney, formatPercent } from '../../shared/lib/format';
import { Button } from '../../shared/ui/Button';
import { Card, CardHeader } from '../../shared/ui/Card';
import { Chip, OwnerChip } from '../../shared/ui/Chip';
import { PageHeader } from '../../shared/ui/PageHeader';
import { ProgressBar } from '../../shared/ui/ProgressBar';
import CardPanel from './CardPanel';
import EventHistory from './EventHistory';
import LateNotices from './LateNotices';
import LegalRatesNotice from './LegalRatesNotice';
import MoreActionsMenu from './MoreActionsMenu';
import PlanTable from './PlanTable';
import { formatDueDate, formatEa, kindInfo } from './debtLabels';
import WhatIsThis from './explain/WhatIsThis';

const UNKNOWN_EVENTS = 'Esta deuda tiene movimientos de una versión más nueva de la app que esta versión no entiende. Actualiza la app para verlos; mientras tanto no se actualizan sus costos financieros.';

// `popover` is the «¿Qué es esto?» explanation of the figure (see `popoverOf`); without one, no trigger shows.
function Figure({ label, children, emphasis = false, popover }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="flex items-center gap-1 text-[13px] text-ink-muted">{label}<WhatIsThis popover={popover} subject={label} className="-my-1.5" /></span>
      <span className={`flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold text-ink tabular-nums ${emphasis ? 'text-2xl tracking-[-0.5px]' : 'text-base'}`}>{children}</span>
    </div>
  );
}

function Section({ title, children }) {
  const titleId = useId();
  return (
    <Card as="section" aria-labelledby={titleId} className="flex flex-col gap-4">
      <CardHeader title={title} titleId={titleId} />
      {children}
    </Card>
  );
}

/**
 * Detail of one debt: state, real cost, the full plan and the history. Presentational; it renders
 * the projection it is given and nothing else (no optimistic figures). `detail` is `buildDebtDetail(...)`
 * or null when the stored terms cannot be read. Actions only appear when their handler is passed; the plan-change
 * handlers (`onRateChange`, `onChargeChange`, `onLatePolicy`, `onTermsCorrection`, `onRestructure`) fill the "Más acciones" menu.
 * `legalStatus` ('ok' | 'missing' | 'unavailable') adds the legal rates notice; events of a newer app version add their own.
 * `onOpenSettings` lets the usury-cap notices of the mora link to Ajustes. `detail.explain` holds the «¿Qué es esto?» popovers by
 * figure (rate, mora, charges, minimum, statement); a figure without one shows no trigger.
 */
export default function DebtDetail({ debt, detail, currentOwnerScope, notice, legalStatus, onBack, onPay, onSimulate, onVoid, onStatement, onCharge, onRateChange, onChargeChange, onLatePolicy, onTermsCorrection, onRestructure, onOpenSettings }) {
  const { label } = kindInfo(debt.kind);
  const back = <Button variant="ghost" onClick={onBack} className="self-start"><ArrowLeft size={16} aria-hidden="true" />Volver a deudas</Button>;

  if (!detail) {
    return <div className="flex flex-col gap-4">{back}<Card><p className="text-sm text-danger">No se pudo leer esta deuda.</p></Card></div>;
  }

  const { projection, history, cost } = detail;
  const explain = detail.explain ?? {};
  const { nextDue, plan, card } = projection;
  const hasPlan = plan.length > 0;
  const hasUnknownEvents = projection.notices.some((item) => item.code === 'unknown_event_kind');
  const open = projection.balanceMinor > 0;
  const lateMinor = projection.lateInterestMinor ?? 0;
  const rate = formatEa(toEffectiveAnnual(rateInForce(projection)));
  const progress = debt.principalMinor > 0 ? Math.max(0, Math.min(100, ((debt.principalMinor - projection.balanceMinor) / debt.principalMinor) * 100)) : 0;
  const planChanges = { onRateChange, onChargeChange, onLatePolicy, onTermsCorrection, onRestructure };
  const hasPlanChanges = Object.values(planChanges).some(Boolean);
  const actions = (onPay || onSimulate || onStatement || onCharge || hasPlanChanges) && (
    <>
      {onStatement && <Button variant="secondary" onClick={onStatement}>Registrar extracto</Button>}
      {onCharge && <Button variant="secondary" onClick={onCharge}>Registrar compra</Button>}
      {onSimulate && !card && hasPlan && open && <Button variant="secondary" onClick={onSimulate}><Calculator size={16} aria-hidden="true" />Simular abono</Button>}
      {hasPlanChanges && <MoreActionsMenu isCard={Boolean(card)} {...planChanges} />}
      {onPay && <Button onClick={onPay} disabled={!open}><Wallet size={16} aria-hidden="true" />Registrar pago</Button>}
    </>
  );

  return (
    <div className="flex flex-col gap-6">
      {back}
      <PageHeader title={debt.name} subtitle={`${debt.lender || label} · ${rate}`} actions={actions} />
      {projection.pastDueMinor > 0 && (
        <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2.5 text-sm font-medium text-[#9a3412]">
          Tienes {formatMoney(projection.pastDueMinor)} vencidos{lateMinor > 0 ? `, con ${formatMoney(lateMinor)} de mora` : ''}. Registra el pago para ponerte al día.
        </p>
      )}
      <LegalRatesNotice legalStatus={legalStatus} />
      <LateNotices notices={projection.notices} onOpenSettings={onOpenSettings} explain={explain.mora} />
      {hasUnknownEvents && <p role="status" className="rounded-sm bg-shared-soft px-3 py-2.5 text-[13px] text-shared">{UNKNOWN_EVENTS}</p>}
      {notice && <p role="status" className="rounded-sm bg-shared-soft px-3 py-2.5 text-[13px] text-shared">{notice}</p>}

      <Section title="Estado de la deuda">
        <div className="grid grid-cols-1 gap-4 min-[560px]:grid-cols-2 lg:grid-cols-4">
          <Figure label="Saldo" emphasis>{formatMoney(projection.balanceMinor)}</Figure>
          <Figure label={card ? 'Pago mínimo' : 'Próxima cuota'} popover={card ? explain.minimum : undefined}>
            {nextDue ? (
              <>
                <span>{formatMoney(nextDue.outstandingMinor)}</span>
                <span className="text-sm font-medium text-ink-muted">{formatDueDate(nextDue.dueOn)}</span>
                {nextDue.status === 'pastDue' && <Chip tone="danger">{card ? 'Vencido' : 'Vencida'}</Chip>}
              </>
            ) : card ? 'Sin pago mínimo pendiente' : 'Sin cuota pendiente'}
          </Figure>
          <Figure label="Tasa" popover={explain.rate}>{rate}</Figure>
          {card ? <Figure label="Pago total del extracto">{formatMoney(card.payInFullMinor)}</Figure> : hasPlan
            ? <Figure label="Cuotas restantes"><span>{projection.remainingPeriods}</span></Figure>
            : <Figure label="Dueño"><OwnerChip ownerScope={debt.ownerScope} currentOwnerScope={currentOwnerScope} /></Figure>}
          {lateMinor > 0 && <Figure label="Mora acumulada" popover={explain.mora}>{formatMoney(lateMinor)}</Figure>}
        </div>
        {!card && (
          <div className="flex flex-col gap-1.5">
            <ProgressBar value={progress} />
            <span className="text-[13px] text-ink-muted tabular-nums">Pagado {formatPercent(progress)}</span>
          </div>
        )}
      </Section>

      {hasPlan && (
        <Section title="Costo real del crédito">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Figure label="Intereses">{formatMoney(cost.interestMinor)}</Figure>
            <Figure label="Cargos y seguros" popover={explain.charges}>{formatMoney(cost.chargesMinor)}</Figure>
            <Figure label="Impuestos">{formatMoney(cost.taxesMinor)}</Figure>
            {cost.lateMinor > 0 && <Figure label="Intereses de mora">{formatMoney(cost.lateMinor)}</Figure>}
            <Figure label="Costo total">{formatMoney(cost.totalMinor)}</Figure>
          </div>
          <span className="text-[13px] text-ink-muted tabular-nums">Ya pagaste {formatMoney(cost.paidMinor)} de este costo.</span>
        </Section>
      )}

      {card ? (
        <Section title="Tu tarjeta"><CardPanel projection={projection} explain={explain} /></Section>
      ) : (
        <Section title="Plan de pagos">
          {hasPlan ? <PlanTable plan={plan} /> : <p className="text-sm text-ink-muted">Esta deuda no tiene plan de cuotas: solo se lleva el saldo.</p>}
        </Section>
      )}

      <Section title="Historial">
        <EventHistory history={history} onVoid={onVoid} />
      </Section>
    </div>
  );
}
