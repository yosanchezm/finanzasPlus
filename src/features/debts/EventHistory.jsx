import { Ban } from 'lucide-react';
import { formatMoney } from '../../shared/lib/format';
import { Button } from '../../shared/ui/Button';
import { Chip } from '../../shared/ui/Chip';
import { formatDueDate } from './debtLabels';

const KIND_LABELS = {
  disbursement: 'Desembolso',
  payment: 'Pago',
  extra_payment: 'Abono extra',
  rate_change: 'Cambio de tasa',
  charge_change: 'Cambio de cargos',
  restructure: 'Reestructuración',
  adjustment: 'Extracto',
  charge: 'Compra',
  late_policy: 'Política de mora',
};
const STRATEGY_LABELS = { reduce_term: 'reducir plazo', reduce_installment: 'reducir cuota', advance_installments: 'adelantar cuotas' };

const labelOf = (entry) => KIND_LABELS[entry.kind] ?? 'Movimiento';

/**
 * Events of a debt, newest first, with voided ones kept and marked. Plan changes show their one-line summary instead of
 * an amount. `onVoid(entry)` asks to void the event (a restructure goes through the guarded dialog).
 */
export default function EventHistory({ history, onVoid }) {
  if (history.length === 0) return <p className="text-sm text-ink-muted">Aún no hay movimientos registrados.</p>;
  return (
    <ul className="flex flex-col divide-y divide-[#eef1ed]">
      {history.map((entry) => (
        <li key={entry.id} className="flex items-center justify-between gap-3 py-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
              {labelOf(entry)}
              {entry.voided && <Chip tone="neutral">Anulado</Chip>}
            </span>
            <span className="text-[13px] text-ink-muted">
              {formatDueDate(entry.effectiveOn)}{entry.strategy ? `, para ${STRATEGY_LABELS[entry.strategy]}` : ''}
            </span>
            {entry.summary && <span className="text-[13px] text-ink-muted">{entry.summary}</span>}
            {entry.voidReason && <span className="text-[13px] text-ink-muted">{entry.voidReason}</span>}
            {entry.costMinor > 0 && <span className="text-[13px] text-ink-muted tabular-nums">Costo financiero {formatMoney(entry.costMinor)}</span>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {!entry.summary && <span className={`text-sm font-semibold tabular-nums ${entry.voided ? 'text-ink-faint line-through' : 'text-ink'}`}>{formatMoney(entry.statedBalanceMinor ?? entry.amountMinor)}</span>}
            {entry.canVoid && (
              <Button variant="ghost" size="icon" aria-label={`Anular ${labelOf(entry).toLowerCase()} del ${formatDueDate(entry.effectiveOn)}`} onClick={() => onVoid(entry)}>
                <Ban size={16} aria-hidden="true" />
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
