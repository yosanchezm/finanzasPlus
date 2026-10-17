import { formatMoney } from '../../../../shared/lib/format';
import { formatDueDate, kindInfo } from '../../debtLabels';
import Notices from '../Notices';
import { MIN_RULES, SYSTEM_LABELS, describeRate } from '../wizardModel';

function Row({ label, children }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-[13px] text-ink-muted">{label}</dt>
      <dd className="text-right text-sm font-medium text-ink tabular-nums">{children}</dd>
    </div>
  );
}

function CardRows({ terms, preview }) {
  const { card, charges } = terms;
  const fee = charges.find((charge) => charge.id === 'mgmt_fee');
  const iva = charges.find((charge) => charge.id === 'mgmt_iva');
  return (
    <>
      <Row label="Corte y pago">Corte el día {card.statementDay}, pago el día {card.dueDay}</Row>
      <Row label="Último corte">{formatDueDate(preview.lastStatementOn)}</Row>
      <Row label="Próximo pago">{preview.minimumMinor > 0 ? `${formatMoney(preview.minimumMinor)} · ${formatDueDate(preview.nextDueOn)}` : formatDueDate(preview.nextDueOn)}</Row>
      <Row label="Pago mínimo">{MIN_RULES.find((rule) => rule.value === card.minPayment.rule).label}</Row>
      <Row label="Cuota de manejo">{fee ? `${formatMoney(fee.value)}${iva ? ` + IVA ${iva.value} %` : ''}` : 'Sin cuota de manejo'}</Row>
      {card.deferred.length > 0 && <Row label="Compras a cuotas">{card.deferred.length} {card.deferred.length === 1 ? 'compra a cuotas' : 'compras a cuotas'}</Row>}
    </>
  );
}

/** Everything shown here is a preview computed from the form; nothing is saved until the user confirms. */
export default function ReviewStep({ result }) {
  const { terms, summary, notices, issues, cardPreview } = result;
  if (issues.length) return <p role="alert" className="text-sm font-medium text-danger">{issues[0].message}</p>;

  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Vista previa" className="flex flex-col gap-3 rounded-md border border-border bg-surface-2 p-4">
        <h3 className="text-sm font-semibold text-ink">Vista previa</h3>
        <dl className="flex flex-col gap-2">
          <Row label="Tipo">{kindInfo(terms.kind).label}</Row>
          <Row label={terms.kind === 'card' ? 'Saldo del último extracto' : 'Monto del préstamo'}>{formatMoney(terms.principalMinor)}</Row>
          <Row label="Tasa">{describeRate(terms.rate)}</Row>
          {terms.kind === 'card' ? <CardRows terms={terms} preview={cardPreview} /> : <Row label="Plan">{SYSTEM_LABELS[terms.system]}</Row>}
          {summary && (
            <>
              <Row label="Primera cuota"><span>{formatMoney(summary.firstDueMinor)}</span> <span className="text-ink-muted">{formatDueDate(summary.firstDueOn)}</span></Row>
              <Row label="Número de cuotas">{summary.count}</Row>
              <Row label="Intereses totales">{formatMoney(summary.interestMinor)}</Row>
              <Row label="Costo financiero total">{formatMoney(summary.costMinor)}</Row>
              <Row label="Total a pagar">{formatMoney(summary.totalDueMinor)}</Row>
            </>
          )}
        </dl>
      </section>
      <Notices notices={notices} />
    </div>
  );
}
