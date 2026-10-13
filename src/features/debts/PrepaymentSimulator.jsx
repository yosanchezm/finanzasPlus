import { useId, useMemo, useState } from 'react';
import { formatMoney } from '../../shared/lib/format';
import { Button } from '../../shared/ui/Button';
import { Card } from '../../shared/ui/Card';
import { Chip } from '../../shared/ui/Chip';
import { DialogContent, DialogHeader, DialogRoot } from '../../shared/ui/Dialog';
import { TextField } from '../../shared/ui/TextField';
import { VERDICT_LABELS, reasonTexts, runSimulation } from './prepaymentModel';
import Notices from './wizard/Notices';

function Figure({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="font-medium text-ink tabular-nums">{value}</dd>
    </div>
  );
}

function StrategyCard({ card, claimsSavings, onRecord }) {
  const titleId = useId();
  const { data } = card;
  return (
    <Card as="article" aria-labelledby={titleId} className={`flex flex-col gap-3 ${card.recommended ? 'border-accent' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={titleId} className="text-sm font-semibold text-ink">{card.title}</h3>
        {card.recommended && <Chip tone="you">Recomendado</Chip>}
      </div>
      {data.paidOff ? <p className="text-sm font-medium text-ink">Este abono liquida la deuda.</p> : (
        <dl className="flex flex-col gap-1.5 text-[13px]">
          <Figure label="Nuevo plazo" value={`${data.after.remainingPeriods} cuotas`} />
          <Figure label="Nueva cuota" value={formatMoney(data.after.installmentMinor)} />
          {claimsSavings && <Figure label="Intereses ahorrados" value={formatMoney(data.savings.interestMinor)} />}
          {claimsSavings && <Figure label="Cargos ahorrados" value={formatMoney(data.savings.chargesMinor)} />}
        </dl>
      )}
      <Button variant="secondary" className="mt-auto" onClick={() => onRecord({ amountMinor: data.amountMinor, strategy: card.key })}>Registrar como abono</Button>
    </Card>
  );
}

/**
 * Extra-payment simulator: pure what-if, it never writes. Shows the strategies side by side with the
 * deterministic recommendation and its reasons; "Registrar como abono" hands amount and strategy to the payment form.
 * `cashflow` is the 3-month average or null (unknown); `otherDebts` feeds the "more expensive debt first" rule.
 */
export default function PrepaymentSimulator({ debt, events, today, otherDebts, cashflow, onRecord, onClose }) {
  const verdictId = useId();
  const [amount, setAmount] = useState('');
  const { issue, cards, advice } = useMemo(
    () => runSimulation({ debt, events, amount, on: today, otherDebts, cashflow }),
    [debt, events, amount, today, otherDebts, cashflow],
  );

  return (
    <DialogRoot open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent variant="center" aria-describedby={undefined} className="sm:w-[760px]">
        <DialogHeader title="Simular abono" description={`${debt.name}: mira qué pasa si abonas de más. No se guarda nada hasta que lo registres.`} />
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
          <TextField label="Monto del abono" type="number" inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="$ 0" inputClassName="tabular-nums" />
          {issue && <p role="alert" className="text-sm font-medium text-danger">{issue}</p>}
          {advice && (
            <>
              <section aria-labelledby={verdictId} className="flex flex-col gap-2 rounded-sm bg-surface-2 p-4">
                <h3 id={verdictId} className="text-sm font-semibold text-ink-2">Recomendación</h3>
                <b className="text-base font-semibold text-ink">{VERDICT_LABELS[advice.verdict]}</b>
                <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-ink-muted">
                  {reasonTexts(advice).map((text) => <li key={text}>{text}</li>)}
                </ul>
              </section>
              <Notices notices={advice.notices} />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
                {cards.map((card) => <StrategyCard key={card.key} card={card} claimsSavings={advice.claimsSavings} onRecord={onRecord} />)}
              </div>
              {advice.comparison.identical && <p className="text-[13px] text-ink-muted">En este tipo de crédito reducir el plazo o la cuota dan el mismo resultado.</p>}
            </>
          )}
        </div>
      </DialogContent>
    </DialogRoot>
  );
}
