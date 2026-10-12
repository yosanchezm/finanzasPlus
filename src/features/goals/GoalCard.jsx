import { useId } from 'react';
import { Target } from 'lucide-react';
import { formatMoney, formatMonthOfDate, formatPercent } from '../../shared/lib/format';
import { Button } from '../../shared/ui/Button';
import { Card } from '../../shared/ui/Card';
import { OwnerChip } from '../../shared/ui/Chip';
import { IconTile } from '../../shared/ui/IconTile';
import { ProgressBar } from '../../shared/ui/ProgressBar';
import { goalProgress, suggestedMonthlyContribution } from './goalMath';

export function goalDateLabel(goal) {
  return goal.targetDate ? `Meta para ${formatMonthOfDate(goal.targetDate)}` : 'Sin fecha objetivo';
}

export function GoalCard({ goal, currentOwnerScope, today, onContribute }) {
  const titleId = useId();
  const { current, target, percent, remaining } = goalProgress(goal);
  const suggestion = suggestedMonthlyContribution(goal, today);

  return (
    <Card as="article" aria-labelledby={titleId} className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <IconTile icon={Target} size={40} className="rounded-[10px]" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 id={titleId} className="text-base font-semibold text-ink">{goal.name}</h2>
          <span className="text-[13px] text-ink-faint">{goalDateLabel(goal)}</span>
        </div>
        <OwnerChip ownerScope={goal.ownerScope} currentOwnerScope={currentOwnerScope} feminine />
      </div>

      <div className="flex flex-wrap items-baseline gap-1.5 tabular-nums">
        <span className="text-2xl font-semibold tracking-[-0.5px] text-ink">{formatMoney(current)}</span>
        <span className="text-sm text-ink-faint">de {formatMoney(target)}</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <ProgressBar value={percent} />
        <div className="flex justify-between gap-3 text-[13px] text-ink-muted tabular-nums">
          <span>{formatPercent(percent)}</span>
          <span>Faltan {formatMoney(remaining)}</span>
        </div>
      </div>

      {(suggestion !== null || onContribute) && (
      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-[#eef1ed] pt-4">
        {suggestion !== null ? (
          <span className="text-[13px] text-ink-muted tabular-nums">
            Sugerido: <b className="font-semibold text-ink">{formatMoney(suggestion)} / mes</b>
          </span>
        ) : <span />}
        {onContribute && <Button variant="secondary" onClick={() => onContribute(goal)} className="h-9 text-[13px]">Registrar aporte</Button>}
      </div>
      )}
    </Card>
  );
}
