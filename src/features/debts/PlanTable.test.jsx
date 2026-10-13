import { project } from '@finance-core';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { makeDebt, makeEvent, makePayment } from './debtFixtures';
import PlanTable from './PlanTable';

const planOf = (events, asOf, terms) => project(makeDebt({}, terms), events, asOf).plan;
const rowOf = (period) => screen.getByRole('row', { name: new RegExp(`^${period} `) });
const THREE_PAID = [makePayment('e1', '2026-02-05'), makePayment('e2', '2026-03-05'), makePayment('e3', '2026-04-05')];

describe('PlanTable', () => {
  it('marks the paid rows, the next due one and the future ones, and closes at 0', () => {
    render(<PlanTable plan={planOf(THREE_PAID, '2026-04-20')} />);

    for (const period of [1, 2, 3]) expect(within(rowOf(period)).getByText('Pagada')).toBeInTheDocument();
    expect(within(rowOf(4)).getByText('Próxima')).toBeInTheDocument();
    expect(within(rowOf(5)).getByText('Pendiente')).toBeInTheDocument();
    expect(within(rowOf(1)).getByText('$ 75.365')).toBeInTheDocument(); // principal
    expect(within(rowOf(1)).getByText('$ 18.088')).toBeInTheDocument(); // interest
    expect(within(rowOf(1)).getByText('5 feb')).toBeInTheDocument();
    expect(within(rowOf(12)).getAllByRole('cell')[5]).toHaveTextContent('$ 0'); // closing balance
  });

  it('flags a partially paid row with what is left, and an overdue row as vencida', () => {
    const partial = planOf([makePayment('e1', '2026-02-05'), makeEvent('e2', 'payment', '2026-02-10', 40000)], '2026-03-01');
    const { unmount } = render(<PlanTable plan={partial} />);
    expect(within(rowOf(2)).getByText('Parcial')).toBeInTheDocument();
    expect(within(rowOf(2)).getByText('Faltan $ 53.453')).toBeInTheDocument();
    unmount();

    render(<PlanTable plan={planOf([makePayment('e1', '2026-02-05')], '2026-04-01')} />);
    expect(within(rowOf(2)).getByText('Vencida')).toBeInTheDocument();
    expect(within(rowOf(3)).getByText('Próxima')).toBeInTheDocument();
  });

  it('pages a long plan, opening on the page of the next due installment', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<PlanTable plan={planOf([], '2026-01-10', { n: 30 })} />);
    expect(screen.getByText('Cuotas 1–12 de 30')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(13); // header + 12
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(screen.getByText('Cuotas 13–24 de 30')).toBeInTheDocument();
    expect(rowOf(13)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Anterior' }));
    expect(screen.getByText('Cuotas 1–12 de 30')).toBeInTheDocument();
    unmount();

    const longPlan = planOf([], '2026-01-10', { n: 30 });
    const payments = longPlan.slice(0, 14).map((row, index) => makePayment(`p${index}`, row.dueOn, row.totalDueMinor));
    render(<PlanTable plan={planOf(payments, '2027-03-06', { n: 30 })} />);
    expect(screen.getByText('Cuotas 13–24 de 30')).toBeInTheDocument();
    expect(within(rowOf(14)).getByText('Pagada')).toBeInTheDocument();
    expect(within(rowOf(15)).getByText('Próxima')).toBeInTheDocument();
  });

  it('itemizes charge lines and keeps bundled charges inside the total', () => {
    const charges = [
      { id: 'life', kind: 'insurance', label: 'Seguro de vida', basis: 'fixed', value: 12000, cadence: 'per_installment', fromPeriod: 1, display: 'itemized' },
      { id: 'fee', kind: 'fee', label: 'Comisión', basis: 'fixed', value: 5000, cadence: 'per_installment', fromPeriod: 1, display: 'bundled' },
      { id: 'iva', kind: 'tax', label: 'IVA', basis: 'pctOfCharge', refId: 'fee', value: 19, cadence: 'per_installment', fromPeriod: 1, display: 'itemized' },
    ];
    render(<PlanTable plan={planOf([], '2026-01-10', { charges })} />);

    const row = within(rowOf(1));
    expect(row.getByText('Seguro de vida')).toBeInTheDocument();
    expect(row.getByText('IVA')).toBeInTheDocument();
    expect(row.queryByText('Comisión')).not.toBeInTheDocument();
    expect(row.getByText('$ 17.950')).toBeInTheDocument(); // 12,000 + 5,000 + 950 IVA, all in the charges total
    expect(row.getByText('$ 111.403')).toBeInTheDocument(); // total installment with charges
  });

  it('shows condensed cards instead of a table on a phone', () => {
    window.innerWidth = 400;
    render(<PlanTable plan={planOf(THREE_PAID, '2026-04-20')} />);

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const cards = screen.getAllByRole('listitem');
    expect(cards).toHaveLength(12);
    expect(within(cards[0]).getByText('Pagada')).toBeInTheDocument();
    expect(within(cards[3]).getByText('Próxima')).toBeInTheDocument();
    expect(within(cards[3]).getByText('Cuota 4')).toBeInTheDocument();
  });
});
