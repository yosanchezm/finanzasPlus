import { useId } from 'react';
import { formatMoney, formatPercent } from '../../shared/lib/format';
import { Card } from '../../shared/ui/Card';
import { Chip, OwnerChip } from '../../shared/ui/Chip';
import { IconTile } from '../../shared/ui/IconTile';
import { ProgressBar } from '../../shared/ui/ProgressBar';
import { formatDueDate, formatEa, kindInfo } from './debtLabels';

function Fact({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-[13px] text-ink-muted">{label}</dt>
      <dd className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-sm font-medium text-ink tabular-nums">{children}</dd>
    </div>
  );
}

export default function DebtCard({ item, currentOwnerScope }) {
  const titleId = useId();
  const { label, icon } = kindInfo(item.kind);
  const { nextDue } = item;

  return (
    <Card as="article" aria-labelledby={titleId} className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <IconTile icon={icon} size={40} className="rounded-[10px]" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 id={titleId} className="truncate text-base font-semibold text-ink">{item.name}</h2>
          <span className="truncate text-[13px] text-ink-faint">{item.lender || label}</span>
        </div>
        <OwnerChip ownerScope={item.ownerScope} currentOwnerScope={currentOwnerScope} />
      </div>

      {item.unreadable ? (
        <p className="text-sm text-danger">No se pudo leer esta deuda.</p>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <span className="text-2xl font-semibold tracking-[-0.5px] text-ink tabular-nums">{formatMoney(item.balanceMinor)}</span>
            <ProgressBar value={item.progressPercent} />
            <span className="text-[13px] text-ink-muted tabular-nums">Pagado {formatPercent(item.progressPercent)}</span>
          </div>
          <dl className="mt-auto flex flex-col gap-2 border-t border-[#eef1ed] pt-4">
            <Fact label="Próxima cuota">
              {nextDue ? (
                <>
                  <span>{formatMoney(nextDue.amountMinor)}</span>
                  <span className="text-ink-muted">{formatDueDate(nextDue.dueOn)}</span>
                  {nextDue.status === 'pastDue' && <Chip tone="danger">Vencida</Chip>}
                </>
              ) : 'Sin cuota pendiente'}
            </Fact>
            <Fact label="Tasa">{formatEa(item.eaPercent)}</Fact>
          </dl>
        </>
      )}
    </Card>
  );
}
