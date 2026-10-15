import { toEffectiveAnnual } from '@finance-core';
import { formatMoney } from '../../shared/lib/format';
import { formatDueDate, formatEa } from './debtLabels';
import WhatIsThis from './explain/WhatIsThis';

const KIND_TEXT = { revolving: 'Compras y saldo sin cuotas', advance: 'Avance en efectivo' };

function describeTranche(tranche) {
  const rate = formatEa(toEffectiveAnnual(tranche.rate));
  if (tranche.type === 'deferred') return `Compra a ${tranche.n} cuotas, quedan ${tranche.installmentsLeft} · ${rate}`;
  return `${KIND_TEXT[tranche.type]} · ${rate}`;
}

/**
 * Card-specific part of the detail: the cut-off and due dates, each tranche with its own rate, and what the
 * last statement billed. Presentational; everything comes from the card projection. `explain` holds the «¿Qué es esto?»
 * popovers by figure (`mora`, `statement`); a figure without one shows no trigger.
 */
export default function CardPanel({ projection, explain = {} }) {
  const { card, tranches, plan } = projection;
  const last = plan.length > 0 ? plan[plan.length - 1] : null;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-muted">
        Próximo corte: {formatDueDate(card.nextStatementOn)}. Próximo pago: {formatDueDate(card.nextDueOn)}.
      </p>
      <ul className="flex flex-col divide-y divide-[#eef1ed]">
        {tranches.map((tranche) => (
          <li key={tranche.id} className="flex items-center justify-between gap-3 py-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-sm font-medium text-ink">{tranche.type === 'revolving' ? 'Saldo rotativo' : tranche.label}</span>
              <span className="text-[13px] text-ink-muted">{describeTranche(tranche)}</span>
            </div>
            <span className="shrink-0 text-sm font-semibold text-ink tabular-nums">{formatMoney(tranche.balanceMinor)}</span>
          </li>
        ))}
      </ul>
      {last && last.lateMinor > 0 && (
        <p className="flex items-center gap-1 text-sm text-ink-muted">
          <span>Mora en curso: {formatMoney(last.lateMinor)} (se cobra en el corte del {formatDueDate(card.nextStatementOn)})</span>
          <WhatIsThis popover={explain.mora} subject="Mora en curso" />
        </p>
      )}
      {last && (
        <div className="flex flex-col gap-2 rounded-sm bg-surface-2 p-4 text-sm">
          <h3 className="flex items-center gap-1 text-[13px] font-semibold text-ink-2">
            <span>Último extracto, corte del {formatDueDate(last.statementOn)}</span>
            <WhatIsThis popover={explain.statement} subject="Último extracto" />
          </h3>
          <dl className="flex flex-col gap-2">
            {[['Intereses', last.interestMinor], ['Cuota de manejo e IVA', last.chargesMinor + last.taxesMinor], ['Cuotas del mes', last.principalMinor], ...(last.lateInterestMinor > 0 ? [['Mora', last.lateInterestMinor]] : [])].map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-3">
                <dt className="text-ink-muted">{label}</dt>
                <dd className="text-ink tabular-nums">{formatMoney(value)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
