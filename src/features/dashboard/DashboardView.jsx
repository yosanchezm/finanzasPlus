import { useId } from 'react';
import { Flag, Plus, Sparkles } from 'lucide-react';
import { formatMoney, formatPercent } from '../../shared/lib/format';
import { Card, CardHeader } from '../../shared/ui/Card';
import { EmptyState } from '../../shared/ui/EmptyState';
import { PageHeader } from '../../shared/ui/PageHeader';
import { ProgressBar } from '../../shared/ui/ProgressBar';
import { cn, focusRing, focusRingDark } from '../../shared/ui/cn';
import { goalProgress } from '../goals/goalMath';
import { TransactionRow } from '../transactions/TransactionRow';
import { CashflowCard } from './CashflowCard';
import { CategoryBreakdown } from './CategoryBreakdown';
import { KpiCards } from './KpiCards';
import { ScopeControl } from './ScopeControl';

const linkButton = cn('rounded-sm text-[13px] font-medium text-accent hover:text-accent-hover', focusRing);
const twoToOne = 'grid gap-4 min-[1100px]:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]';

function RecentTransactions({ items, currentOwnerScope, onSeeAll, onAdd }) {
  const titleId = useId();
  return (
    <Card as="article" padded={false} aria-labelledby={titleId} className="flex flex-col">
      <CardHeader
        titleId={titleId}
        title="Últimos movimientos"
        className="px-5 pt-5 pb-3"
        action={<button type="button" onClick={onSeeAll} className={linkButton}>Ver todos</button>}
      />
      {items.length ? (
        <ul className="flex flex-col px-2 pb-2">
          {items.map((item) => <TransactionRow key={item.$id} item={item} currentOwnerScope={currentOwnerScope} />)}
        </ul>
      ) : (
        <EmptyState message="Aún no hay movimientos en este periodo." actionLabel="Registrar movimiento" actionIcon={Plus} onAction={onAdd} />
      )}
    </Card>
  );
}

function GoalsSummary({ goals, onSeeAll, onAdd }) {
  const active = goals.filter((goal) => goal.status !== 'completed');
  const shown = (active.length ? active : goals).slice(0, 3);
  return (
    <Card as="article" className="flex flex-col gap-4">
      <CardHeader title="Metas" action={goals.length ? <button type="button" onClick={onSeeAll} className={linkButton}>Ver metas</button> : null} />
      {shown.length ? shown.map((goal) => {
        const { current, target, percent } = goalProgress(goal);
        return (
          <div key={goal.$id} className="flex flex-col gap-2">
            <div className="flex justify-between gap-3 text-sm">
              <span className="truncate font-medium text-ink">{goal.name}</span>
              <span className="text-ink-muted tabular-nums">{formatPercent(percent)}</span>
            </div>
            <ProgressBar value={percent} size="sm" />
            <span className="text-[13px] text-ink-faint tabular-nums">{formatMoney(current)} de {formatMoney(target)}</span>
          </div>
        );
      }) : (
        <EmptyState icon={Flag} message="Todavía no han creado metas." actionLabel="Crear meta" actionIcon={Plus} onAction={onAdd} className="py-6" />
      )}
    </Card>
  );
}

/** Keeps the existing insight rules: budget pace when limits exist, otherwise a nudge to define them. */
function NiaInsight({ budget, remainingDays, isCurrentMonth, onOpenAssistant, onSeeBudget }) {
  const used = budget.planned ? Math.round((budget.spent / budget.planned) * 100) : 0;
  const darkButton = 'inline-flex h-9 items-center rounded-sm px-3 text-[13px] font-semibold';
  return (
    <section aria-labelledby="nia-insight-title" className="flex flex-col gap-3 rounded-md bg-sidebar p-5 text-[#e7eeea]">
      <div className="flex items-center gap-2.5">
        <span aria-hidden="true" className="grid size-8 place-items-center rounded-sm bg-brand-mint/14 text-brand-mint"><Sparkles size={18} /></span>
        <h2 id="nia-insight-title" className="text-sm font-semibold">Nia notó algo</h2>
      </div>
      <p className="text-sm leading-[22px] text-[#c9d5cf]">
        <b className="font-semibold text-white">{budget.planned ? `${isCurrentMonth ? 'Han usado' : 'Usaron'} el ${used}% del presupuesto.` : 'Define presupuestos para ver el ritmo del hogar.'}</b>{' '}
        {budget.planned
          ? (isCurrentMonth
            ? `Quedan ${formatMoney(Math.max(budget.planned - budget.spent, 0))} y ${remainingDays} días del mes.`
            : `Quedaron ${formatMoney(Math.max(budget.planned - budget.spent, 0))} sin usar; el mes ya cerró.`)
          : 'La información ya está conectada; falta asignar límites por categoría.'}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onOpenAssistant} className={cn(darkButton, 'bg-brand-mint text-sidebar hover:bg-[#a6eecd]', focusRingDark)}>Preguntarle a Nia</button>
        <button type="button" onClick={onSeeBudget} className={cn(darkButton, 'text-brand-mint hover:bg-white/6', focusRingDark)}>Ver presupuesto</button>
      </div>
    </section>
  );
}

export default function DashboardView({
  dateLabel, periodLabel, scope, onScopeChange, totals, incomeCount, expenseCount, budget, remainingDays,
  isCurrentMonth = true, cashflow, history = [], categoryStats, recentTransactions, goals, currentOwnerScope,
  onNavigate, onAddTransaction, onAddGoal, onOpenAssistant,
}) {
  const seeBudget = () => onNavigate('Presupuesto');
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Resumen" subtitle={dateLabel} actions={<ScopeControl scope={scope} onScopeChange={onScopeChange} />} />

      <KpiCards totals={totals} incomeCount={incomeCount} expenseCount={expenseCount} budget={budget} history={history} />

      <div className={twoToOne}>
        <CashflowCard history={history} series={cashflow} periodLabel={periodLabel} />
        <CategoryBreakdown stats={categoryStats} periodLabel={periodLabel} onSeeBudget={seeBudget} />
      </div>

      <div className={twoToOne}>
        <RecentTransactions
          items={recentTransactions.slice(0, 5)}
          currentOwnerScope={currentOwnerScope}
          onSeeAll={() => onNavigate('Movimientos')}
          onAdd={onAddTransaction}
        />
        <div className="flex min-w-0 flex-col gap-4">
          <GoalsSummary goals={goals} onSeeAll={() => onNavigate('Metas')} onAdd={onAddGoal} />
          <NiaInsight budget={budget} remainingDays={remainingDays} isCurrentMonth={isCurrentMonth} onOpenAssistant={onOpenAssistant} onSeeBudget={seeBudget} />
        </div>
      </div>
    </div>
  );
}
