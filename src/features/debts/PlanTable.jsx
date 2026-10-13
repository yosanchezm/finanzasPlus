import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatMoney } from '../../shared/lib/format';
import { paginate } from '../../shared/lib/paginate';
import { useMediaQuery } from '../../shared/lib/useMediaQuery';
import { Button } from '../../shared/ui/Button';
import { Chip } from '../../shared/ui/Chip';
import { formatDueDate } from './debtLabels';

const PAGE_SIZE = 12;
const STATUS = {
  paid: { label: 'Pagada', tone: 'you' },
  partial: { label: 'Parcial', tone: 'shared' },
  due: { label: 'Próxima', tone: 'shared' },
  pastDue: { label: 'Vencida', tone: 'danger' },
  future: { label: 'Pendiente', tone: 'neutral' },
};

const itemizedLines = (row) => row.charges.filter((line) => line.display === 'itemized');
const feesOf = (row) => row.chargesMinor + row.taxesMinor;

function StatusChip({ row }) {
  const { label, tone } = STATUS[row.status];
  return (
    <span className="flex flex-col items-start gap-1">
      <Chip tone={tone}>{label}</Chip>
      {row.status === 'partial' && <span className="text-xs text-ink-muted tabular-nums">Faltan {formatMoney(row.outstandingMinor)}</span>}
    </span>
  );
}

function ChargeLines({ row }) {
  return itemizedLines(row).map((line) => (
    <span key={line.id} className="flex justify-between gap-3 text-xs text-ink-muted"><span>{line.label}</span><span className="tabular-nums">{formatMoney(line.amountMinor)}</span></span>
  ));
}

function Table({ rows }) {
  const head = 'px-3 py-2 text-right text-[13px] font-medium text-ink-muted';
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm text-ink tabular-nums">
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className={`${head} text-left`}>Cuota</th>
            <th scope="col" className={`${head} text-left`}>Vence</th>
            {['Capital', 'Intereses', 'Cargos', 'Total', 'Saldo'].map((label) => <th key={label} scope="col" className={head}>{label}</th>)}
            <th scope="col" className={`${head} text-left`}>Estado</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.period} className="border-b border-[#eef1ed] align-top last:border-0">
              <th scope="row" className="px-3 py-2.5 text-left font-semibold">{row.period}</th>
              <td className="px-3 py-2.5 whitespace-nowrap">{formatDueDate(row.dueOn)}</td>
              <td className="px-3 py-2.5 text-right">{formatMoney(row.principalMinor)}</td>
              <td className="px-3 py-2.5 text-right">{formatMoney(row.interestMinor)}</td>
              <td className="px-3 py-2.5 text-right"><span className="flex flex-col gap-0.5"><span>{formatMoney(feesOf(row))}</span><ChargeLines row={row} /></span></td>
              <td className="px-3 py-2.5 text-right font-semibold">{formatMoney(row.totalDueMinor)}</td>
              <td className="px-3 py-2.5 text-right">{formatMoney(row.closingMinor)}</td>
              <td className="px-3 py-2.5"><StatusChip row={row} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cards({ rows }) {
  const figure = (label, value) => <div className="flex justify-between gap-3"><dt className="text-ink-muted">{label}</dt><dd className="tabular-nums">{value}</dd></div>;
  return (
    <ul className="flex flex-col divide-y divide-[#eef1ed]">
      {rows.map((row) => (
        <li key={row.period} className="flex flex-col gap-2 py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-ink">Cuota {row.period}<span className="ml-2 font-normal text-ink-muted">{formatDueDate(row.dueOn)}</span></span>
            <StatusChip row={row} />
          </div>
          <b className="text-lg font-semibold text-ink tabular-nums">{formatMoney(row.totalDueMinor)}</b>
          <dl className="flex flex-col gap-1 text-[13px]">
            {figure('Capital', formatMoney(row.principalMinor))}
            {figure('Intereses', formatMoney(row.interestMinor))}
            {feesOf(row) > 0 && figure('Cargos', <span className="flex flex-col items-end gap-0.5"><span>{formatMoney(feesOf(row))}</span><ChargeLines row={row} /></span>)}
            {figure('Saldo', formatMoney(row.closingMinor))}
          </dl>
        </li>
      ))}
    </ul>
  );
}

/** The full plan (`projection.plan`) with a status chip per row, paged by 12. A table on wide screens, condensed cards on phones. */
export default function PlanTable({ plan }) {
  const wide = useMediaQuery('(min-width: 640px)');
  const firstOpen = plan.findIndex((row) => row.status !== 'paid');
  const [requested, setRequested] = useState(Math.floor(Math.max(firstOpen, 0) / PAGE_SIZE) + 1);
  const { pageItems, page, pageCount, start, end, total } = paginate(plan, requested, PAGE_SIZE);

  return (
    <div className="flex flex-col gap-3">
      {wide ? <Table rows={pageItems} /> : <Cards rows={pageItems} />}
      {pageCount > 1 && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] text-ink-muted tabular-nums">Cuotas {start}–{end} de {total}</span>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={page === 1} onClick={() => setRequested(page - 1)}><ChevronLeft size={16} aria-hidden="true" />Anterior</Button>
            <Button variant="secondary" disabled={page === pageCount} onClick={() => setRequested(page + 1)}>Siguiente<ChevronRight size={16} aria-hidden="true" /></Button>
          </div>
        </div>
      )}
    </div>
  );
}
