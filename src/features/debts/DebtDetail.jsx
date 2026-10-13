import { useId } from 'react';
import { toEffectiveAnnual } from '@finance-core';
import { ArrowLeft, Calculator, Wallet } from 'lucide-react';
import { formatMoney, formatPercent } from '../../shared/lib/format';
import { Button } from '../../shared/ui/Button';
import { Card, CardHeader } from '../../shared/ui/Card';
import { Chip, OwnerChip } from '../../shared/ui/Chip';
import { PageHeader } from '../../shared/ui/PageHeader';
import { ProgressBar } from '../../shared/ui/ProgressBar';
import EventHistory from './EventHistory';
import PlanTable from './PlanTable';
import { formatDueDate, formatEa, kindInfo } from './debtLabels';

function Figure({ label, children, emphasis = false }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[13px] text-ink-muted">{label}</span>
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
 * or null when the stored terms cannot be read. Actions only appear when their handler is passed.
 */
export default function DebtDetail({ debt, detail, currentOwnerScope, notice, onBack, onPay, onSimulate, onVoid }) {
  const { label } = kindInfo(debt.kind);
  const back = <Button variant="ghost" onClick={onBack} className="self-start"><ArrowLeft size={16} aria-hidden="true" />Volver a deudas</Button>;

  if (!detail) {
    return <div className="flex flex-col gap-4">{back}<Card><p className="text-sm text-danger">No se pudo leer esta deuda.</p></Card></div>;
  }

  const { projection, history, cost } = detail;
  const { nextDue, plan } = projection;
  const hasPlan = plan.length > 0;
  const open = projection.balanceMinor > 0;
  const rate = formatEa(toEffectiveAnnual(projection.terms.rate));
  const progress = debt.principalMinor > 0 ? Math.max(0, Math.min(100, ((debt.principalMinor - projection.balanceMinor) / debt.principalMinor) * 100)) : 0;
  const actions = (onPay || onSimulate) && (
    <>
      {onSimulate && hasPlan && open && <Button variant="secondary" onClick={onSimulate}><Calculator size={16} aria-hidden="true" />Simular abono</Button>}
      {onPay && <Button onClick={onPay} disabled={!open}><Wallet size={16} aria-hidden="true" />Registrar pago</Button>}
    </>
  );

  return (
    <div className="flex flex-col gap-6">
      {back}
      <PageHeader title={debt.name} subtitle={`${debt.lender || label} · ${rate}`} actions={actions} />
      {projection.pastDueMinor > 0 && (
        <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2.5 text-sm font-medium text-[#9a3412]">
          Tienes {formatMoney(projection.pastDueMinor)} vencidos. Registra el pago para ponerte al día.
        </p>
      )}
      {notice && <p role="status" className="rounded-sm bg-shared-soft px-3 py-2.5 text-[13px] text-shared">{notice}</p>}

      <Section title="Estado de la deuda">
        <div className="grid grid-cols-1 gap-4 min-[560px]:grid-cols-2 lg:grid-cols-4">
          <Figure label="Saldo" emphasis>{formatMoney(projection.balanceMinor)}</Figure>
          <Figure label="Próxima cuota">
            {nextDue ? (
              <>
                <span>{formatMoney(nextDue.outstandingMinor)}</span>
                <span className="text-sm font-medium text-ink-muted">{formatDueDate(nextDue.dueOn)}</span>
                {nextDue.status === 'pastDue' && <Chip tone="danger">Vencida</Chip>}
              </>
            ) : 'Sin cuota pendiente'}
          </Figure>
          <Figure label="Tasa">{rate}</Figure>
          {hasPlan
            ? <Figure label="Cuotas restantes"><span>{projection.remainingPeriods}</span></Figure>
            : <Figure label="Dueño"><OwnerChip ownerScope={debt.ownerScope} currentOwnerScope={currentOwnerScope} /></Figure>}
        </div>
        <div className="flex flex-col gap-1.5">
          <ProgressBar value={progress} />
          <span className="text-[13px] text-ink-muted tabular-nums">Pagado {formatPercent(progress)}</span>
        </div>
      </Section>

      {hasPlan && (
        <Section title="Costo real del crédito">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Figure label="Intereses">{formatMoney(cost.interestMinor)}</Figure>
            <Figure label="Cargos y seguros">{formatMoney(cost.chargesMinor)}</Figure>
            <Figure label="Impuestos">{formatMoney(cost.taxesMinor)}</Figure>
            <Figure label="Costo total">{formatMoney(cost.totalMinor)}</Figure>
          </div>
          <span className="text-[13px] text-ink-muted tabular-nums">Ya pagaste {formatMoney(cost.paidMinor)} de este costo.</span>
        </Section>
      )}

      <Section title="Plan de pagos">
        {hasPlan ? <PlanTable plan={plan} /> : <p className="text-sm text-ink-muted">Esta deuda no tiene plan de cuotas: solo se lleva el saldo.</p>}
      </Section>

      <Section title="Historial">
        <EventHistory history={history} onVoid={onVoid} />
      </Section>
    </div>
  );
}
