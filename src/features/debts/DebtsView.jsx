import { CloudOff, Landmark, Plus } from 'lucide-react';
import { formatMoney } from '../../shared/lib/format';
import { Button } from '../../shared/ui/Button';
import { Card } from '../../shared/ui/Card';
import { EmptyState } from '../../shared/ui/EmptyState';
import { PageHeader } from '../../shared/ui/PageHeader';
import DebtCard from './DebtCard';
import { formatDueDate } from './debtLabels';

function Totals({ totals }) {
  const figure = (label, value) => (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[13px] text-ink-muted">{label}</span>
      <b className="text-xl font-semibold text-ink tabular-nums">{value}</b>
    </div>
  );
  return (
    <Card as="section" aria-label="Totales de deudas" className="grid grid-cols-1 gap-4 min-[560px]:grid-cols-3">
      {figure('Saldo total', formatMoney(totals.balanceMinor))}
      {figure('Cuotas por pagar', formatMoney(totals.installmentsMinor))}
      {figure('Próximo vencimiento', totals.nextDueOn ? formatDueDate(totals.nextDueOn) : 'Sin vencimientos')}
    </Card>
  );
}

function LoadingBlock() {
  const block = 'animate-pulse rounded-sm bg-surface-2 motion-reduce:animate-none';
  return (
    <div role="status" aria-label="Cargando deudas…" className="grid grid-cols-[repeat(auto-fill,minmax(min(320px,100%),1fr))] gap-4">
      {[0, 1].map((key) => <Card key={key} className="flex h-[200px] flex-col gap-3"><div className={`${block} h-5 w-40`} /><div className={`${block} h-8 w-32`} /></Card>)}
    </div>
  );
}

/** Presentational list of debts with totals; loading, failure and empty states included. */
export default function DebtsView({ status, items, totals, currentOwnerScope, scopeControl, onAdd, onOpen, onRetry }) {
  const actions = (scopeControl || onAdd) && (
    <>
      {scopeControl}
      {onAdd && status === 'ready' && <Button onClick={onAdd}><Plus size={16} strokeWidth={2.25} aria-hidden="true" />Nueva deuda</Button>}
    </>
  );

  const body = () => {
    if (status === 'loading') return <LoadingBlock />;
    if (status === 'error') {
      return <Card><EmptyState icon={CloudOff} message="No se pudieron cargar las deudas." actionLabel="Reintentar" onAction={onRetry} /></Card>;
    }
    if (items.length === 0) {
      return <Card><EmptyState icon={Landmark} message="Aún no hay deudas registradas." actionLabel="Registrar una deuda" actionIcon={Plus} onAction={onAdd} /></Card>;
    }
    return (
      <>
        <Totals totals={totals} />
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(320px,100%),1fr))] gap-4">
          {items.map((item) => <DebtCard key={item.id} item={item} currentOwnerScope={currentOwnerScope} onOpen={onOpen} />)}
        </div>
      </>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Deudas" subtitle="Lo que deben, cuánto falta y cuándo vence cada cuota." actions={actions} />
      {body()}
    </div>
  );
}
