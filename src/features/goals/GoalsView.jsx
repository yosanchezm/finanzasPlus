import { useState } from 'react';
import { Plus } from 'lucide-react';
import { formatMoney } from '../../shared/lib/format';
import { Button } from '../../shared/ui/Button';
import { PageHeader } from '../../shared/ui/PageHeader';
import { cn, focusRing } from '../../shared/ui/cn';
import ContributionDialog from './ContributionDialog';
import { GoalCard } from './GoalCard';
import { goalProgress, suggestedMonthlyContribution } from './goalMath';

function Totals({ goals, today }) {
  const saved = goals.reduce((sum, goal) => sum + goalProgress(goal).current, 0);
  const target = goals.reduce((sum, goal) => sum + goalProgress(goal).target, 0);
  const suggestions = goals.map((goal) => suggestedMonthlyContribution(goal, today)).filter((value) => value !== null);
  const item = (label, value) => (
    <span>{label} <b className="ml-1 text-base font-semibold text-ink tabular-nums">{value}</b></span>
  );

  return (
    <section aria-label="Totales de metas" className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-muted">
      {item('Ahorrado en total', formatMoney(saved))}
      {item('Objetivo combinado', formatMoney(target))}
      {suggestions.length > 0 && item('Aporte sugerido', `${formatMoney(suggestions.reduce((sum, value) => sum + value, 0))} / mes`)}
    </section>
  );
}

export default function GoalsView({ goals, currentOwnerScope, onAdd, onContribute, today = new Date() }) {
  const [contributing, setContributing] = useState(null);

  const contribute = async (amount) => {
    await onContribute(contributing, amount);
    setContributing(null);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Metas"
        subtitle="Lo que están construyendo, y cuánto falta para llegar."
        actions={<Button onClick={onAdd}><Plus size={16} strokeWidth={2.25} aria-hidden="true" />Nueva meta</Button>}
      />

      {goals.length > 0 && <Totals goals={goals} today={today} />}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(320px,100%),1fr))] gap-4">
        {goals.map((goal) => <GoalCard key={goal.$id} goal={goal} currentOwnerScope={currentOwnerScope} today={today} onContribute={onContribute ? setContributing : undefined} />)}
        <button
          type="button"
          onClick={onAdd}
          className={cn(
            'flex min-h-60 flex-col items-center justify-center gap-2.5 rounded-md border-[1.5px] border-dashed border-[#c3cbc5] bg-transparent p-5 text-ink-2 hover:border-accent hover:bg-[#f7fbf9]',
            focusRing,
          )}
        >
          <span aria-hidden="true" className="grid size-10 place-items-center rounded-full bg-accent-soft text-accent"><Plus size={20} /></span>
          <span className="text-sm font-semibold">Crear una meta</span>
          <span className="text-[13px] text-ink-faint">Ahorro, viaje, deuda o compra grande</span>
        </button>
      </div>

      {contributing && <ContributionDialog goal={contributing} onClose={() => setContributing(null)} onSubmit={contribute} />}
    </div>
  );
}
