import { CloudOff } from 'lucide-react';
import { Card } from '../shared/ui/Card';
import { EmptyState } from '../shared/ui/EmptyState';

const block = 'animate-pulse rounded-sm bg-surface-2 motion-reduce:animate-none';

/** Placeholder for a view while its month loads; shaped like a page header, KPI row and two cards. */
export function ViewSkeleton({ label = 'Cargando el periodo…' }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className={`${block} h-8 w-48`} />
        <div className={`${block} h-4 w-72 max-w-full`} />
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
        {[0, 1, 2, 3].map((key) => <Card key={key} className="flex h-[128px] flex-col gap-3"><div className={`${block} h-4 w-24`} /><div className={`${block} h-8 w-36`} /></Card>)}
      </div>
      <div className="grid gap-4 min-[1100px]:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
        <Card className="h-[300px]"><div className={`${block} size-full`} /></Card>
        <Card className="h-[300px]"><div className={`${block} size-full`} /></Card>
      </div>
    </div>
  );
}

export function PeriodError({ onRetry }) {
  return (
    <Card>
      <EmptyState icon={CloudOff} message="No se pudieron cargar los movimientos de este mes." actionLabel="Reintentar" onAction={onRetry} />
    </Card>
  );
}
