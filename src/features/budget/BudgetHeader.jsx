import { addMonths } from '../../shared/lib/dates';
import { formatMoney, formatMonth, formatSignedMoney } from '../../shared/lib/format';
import { Card } from '../../shared/ui/Card';
import { Chip } from '../../shared/ui/Chip';
import { cn } from '../../shared/ui/cn';

export const LEGACY_NOTICE = 'Los presupuestos se están migrando; la edición se habilita al terminar.';
const SCOPE_NOTICE = 'Estás viendo solo una parte del hogar. Cambia a Hogar para editar los presupuestos.';
const NO_INCOME_HINT = 'Registra un ingreso este mes para calcular cuánto te queda por asignar.';

const TONES = { danger: 'text-danger', accent: 'text-accent', muted: 'text-ink-muted' };

function Stat({ label, value, tone, children }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[13px] text-ink-muted">{label}</span>
      <span className={cn('text-[22px] font-semibold tracking-[-0.4px] tabular-nums', TONES[tone] || 'text-ink')}>{value}</span>
      {children}
    </div>
  );
}

function Notice({ children }) {
  return <p role="note" className="rounded-sm bg-surface-2 px-4 py-3 text-sm text-ink-2">{children}</p>;
}

/**
 * Income base, Asignado and Por asignar of the month, plus the notice that explains why editing is off
 * (legacy migration wins over the scope note, since neither Tú nor Pareja could edit anyway).
 */
export default function BudgetHeader({ budgetMonth, scope, linesMode }) {
  const { base, totals, warnings, month } = budgetMonth;
  const noIncome = base.source === 'none';
  const over = warnings.some((warning) => warning.code === 'over_allocated');
  const porAsignar = totals.porAsignarMinor;
  const notice = linesMode === 'legacy' ? LEGACY_NOTICE : scope !== 'total' ? SCOPE_NOTICE : null;

  return (
    <>
      {notice && <Notice>{notice}</Notice>}
      <Card aria-label="Resumen de asignación" className="flex flex-col gap-3">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-4">
          <Stat label="Ingreso base" value={noIncome ? 'Sin definir' : formatMoney(base.incomeMinor)} tone={noIncome ? 'muted' : undefined}>
            {base.source === 'reference' && <Chip tone="neutral" className="self-start">{`Referencia: ${formatMonth(addMonths(month, -1))}`}</Chip>}
          </Stat>
          <Stat label="Asignado" value={formatMoney(totals.allocatedMinor)} />
          <Stat label="Por asignar" value={porAsignar < 0 ? formatSignedMoney(porAsignar) : formatMoney(porAsignar)} tone={over ? 'danger' : 'accent'}>
            {over && <Chip tone="danger" className="self-start font-semibold">Sobreasignado</Chip>}
          </Stat>
        </div>
        {noIncome && <p className="text-sm text-ink-2">{NO_INCOME_HINT}</p>}
      </Card>
    </>
  );
}
