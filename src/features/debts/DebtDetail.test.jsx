import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import DebtDetail from './DebtDetail';
import { buildDebtDetail } from './debtDetailModel';
import { formatMoney, formatMonthLabel } from '../../shared/lib/format';
import { DAY_10, MORA_DISBURSEMENT, makeDebt, makeEvent, makeMoraLoan, makePayment, usuryLegal } from './debtFixtures';

const DISBURSEMENT = makeEvent('e0', 'disbursement', '2026-01-05', 1000000);
const THREE_PAYMENTS = [DISBURSEMENT, makePayment('e1', '2026-02-05'), makePayment('e2', '2026-03-05'), makePayment('e3', '2026-04-05')];
const detailOf = (events, asOf, debt = makeDebt()) => buildDebtDetail({ debt, events, asOf });
const renderDetail = (props = {}) => {
  const debt = props.debt ?? makeDebt();
  return render(<DebtDetail debt={debt} detail={props.detail === undefined ? detailOf(THREE_PAYMENTS, '2026-04-20', debt) : props.detail} currentOwnerScope="you" onBack={vi.fn()} {...props} />);
};

describe('DebtDetail', () => {
  it('shows the state, the real cost, the plan and the history of a loan with 3 payments', () => {
    renderDetail();

    expect(screen.getByRole('heading', { level: 1, name: 'Crédito de consumo' })).toBeInTheDocument();
    const state = screen.getByRole('region', { name: 'Estado de la deuda' });
    expect(within(state).getByText(/^\$ 7\d\d\.\d{3}$/)).toBeInTheDocument(); // balance after 3 paid installments
    expect(within(state).getByText('$ 93.453')).toBeInTheDocument(); // next installment
    expect(within(state).getByText('5 may')).toBeInTheDocument();
    expect(within(state).getByText('24 % E.A.')).toBeInTheDocument();
    expect(within(state).getByText('9')).toBeInTheDocument(); // installments left

    const cost = screen.getByRole('region', { name: 'Costo real del crédito' });
    expect(within(cost).getByText('Intereses')).toBeInTheDocument();
    expect(within(cost).getByText('Costo total')).toBeInTheDocument();

    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows).toHaveLength(13);
    expect(within(rows[1]).getByText('Pagada')).toBeInTheDocument();
    expect(within(rows[4]).getByText('Próxima')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Historial' })).getAllByRole('listitem')).toHaveLength(4);
  });

  it('calls out an overdue amount', () => {
    renderDetail({ detail: detailOf([DISBURSEMENT], '2026-03-20') });

    expect(screen.getByRole('alert')).toHaveTextContent('Tienes $ 186.906 vencidos');
    expect(within(screen.getByRole('region', { name: 'Estado de la deuda' })).getByText('Vencida')).toBeInTheDocument();
  });

  it('explains a balance-only debt instead of showing an empty plan', () => {
    const informal = makeDebt({}, { system: 'none', n: undefined, firstDueOn: undefined, periodicity: undefined, rate: { convention: 'ZERO' } });
    renderDetail({ debt: informal, detail: detailOf([DISBURSEMENT], '2026-02-01', informal) });

    expect(screen.getByText('Esta deuda no tiene plan de cuotas: solo se lleva el saldo.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows the repair notice without hiding anything, and the back action works', async () => {
    const onBack = vi.fn();
    renderDetail({ onBack, notice: 'No se pudieron verificar los costos financieros.' });

    expect(screen.getByRole('status')).toHaveTextContent('No se pudieron verificar los costos financieros.');
    expect(screen.getByRole('table')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Volver a deudas' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('offers payment and simulation only when the container wires them', async () => {
    const onPay = vi.fn();
    const { unmount } = renderDetail();
    expect(screen.queryByRole('button', { name: 'Registrar pago' })).not.toBeInTheDocument();
    unmount();

    renderDetail({ onPay, onSimulate: vi.fn() });
    await userEvent.click(screen.getByRole('button', { name: 'Registrar pago' }));
    expect(onPay).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Simular abono' })).toBeInTheDocument();
  });

  it('shows Más acciones only when an action is wired, and runs the one chosen', async () => {
    const onRateChange = vi.fn();
    const { unmount } = renderDetail();
    expect(screen.queryByRole('button', { name: 'Más acciones' })).not.toBeInTheDocument();
    unmount();

    renderDetail({ onRateChange });
    await userEvent.click(screen.getByRole('button', { name: 'Más acciones' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Cambiar tasa']);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Cambiar tasa' }));
    expect(onRateChange).toHaveBeenCalledTimes(1);
  });

  it('lists the charge change next to the rate change and runs the one chosen', async () => {
    const onRateChange = vi.fn();
    const onChargeChange = vi.fn();
    renderDetail({ onRateChange, onChargeChange });
    await userEvent.click(screen.getByRole('button', { name: 'Más acciones' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Cambiar tasa', 'Cambiar seguros y cargos']);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Cambiar seguros y cargos' }));
    expect(onChargeChange).toHaveBeenCalledTimes(1);
    expect(onRateChange).not.toHaveBeenCalled();
  });

  it('reports a debt it cannot read', () => {
    renderDetail({ detail: null });

    expect(screen.getByText('No se pudo leer esta deuda.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

describe('DebtDetail load-time notices', () => {
  const LEGAL_COPY = 'No pudimos leer las tasas legales del hogar; usamos los valores de la app.';
  const UNKNOWN_COPY = /movimientos de una versión más nueva de la app/;

  it.each(['missing', 'unavailable'])('shows the legal rates notice without hiding the debt (legalStatus %s)', (legalStatus) => {
    renderDetail({ legalStatus });

    expect(screen.getByText(LEGAL_COPY)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Estado de la deuda' })).toBeInTheDocument();
  });

  it('shows no legal rates notice when the rates were read', () => {
    renderDetail({ legalStatus: 'ok' });
    expect(screen.queryByText(LEGAL_COPY)).not.toBeInTheDocument();
  });

  it('warns about events of a newer app version and still shows what it understands', () => {
    const events = [...THREE_PAYMENTS, makeEvent('f1', 'late_policy_v9', '2026-04-10', 0, { late: { mode: 'usury' } })];
    renderDetail({ detail: detailOf(events, '2026-04-20') });

    expect(screen.getByText(UNKNOWN_COPY)).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Historial' })).getAllByRole('listitem')).toHaveLength(4);
  });

  it('shows no newer-version warning when every event is known', () => {
    renderDetail();
    expect(screen.queryByText(UNKNOWN_COPY)).not.toBeInTheDocument();
  });
});

describe('DebtDetail mora', () => {
  const moraDetail = (options = {}, events = [MORA_DISBURSEMENT], asOf = DAY_10) => {
    const debt = makeMoraLoan(options);
    return { debt, detail: buildDebtDetail({ debt, events, asOf }) };
  };
  const NO_CAP = usuryLegal(['2026-01-01', '2026-12-31', 30, 'mortgage']);

  it('shows the accrued mora as a figure, in the cost and in the overdue call-out (1,375 after 10 days)', () => {
    renderDetail(moraDetail());

    const state = screen.getByRole('region', { name: 'Estado de la deuda' });
    expect(within(state).getByText('Mora acumulada').nextSibling).toHaveTextContent(formatMoney(1375));
    expect(within(screen.getByRole('region', { name: 'Costo real del crédito' })).getByText('Intereses de mora').nextSibling).toHaveTextContent(formatMoney(1375));
    expect(screen.getByRole('alert')).toHaveTextContent(`Tienes ${formatMoney(391756)} vencidos, con ${formatMoney(1375)} de mora.`);
    expect(screen.getByRole('columnheader', { name: 'Mora' })).toBeInTheDocument();
  });

  it('shows no mora figure for a debt without a policy, and the call-out keeps its plain wording', () => {
    renderDetail(moraDetail({ late: null }));

    expect(screen.queryByText('Mora acumulada')).not.toBeInTheDocument();
    expect(screen.queryByText('Intereses de mora')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(`Tienes ${formatMoney(390381)} vencidos. Registra el pago`);
    expect(screen.queryByRole('columnheader', { name: 'Mora' })).not.toBeInTheDocument();
  });

  it('adds the mora to the total cost', () => {
    renderDetail(moraDetail());
    const { detail } = moraDetail();
    const cost = within(screen.getByRole('region', { name: 'Costo real del crédito' }));

    expect(cost.getByText('Costo total').nextSibling).toHaveTextContent(formatMoney(detail.cost.totalMinor));
    expect(detail.cost.totalMinor).toBe(detail.cost.interestMinor + detail.cost.chargesMinor + detail.cost.taxesMinor + 1375);
  });

  it('tells the user a carried-forward cap is stale and links to Ajustes, without blocking anything', async () => {
    const onOpenSettings = vi.fn();
    renderDetail({ ...moraDetail({ legal: usuryLegal(['2025-01-01', '2026-01-31', 28.59]) }), onOpenSettings, onPay: vi.fn() });

    const notice = screen.getByText((text) => text.includes(`la mora usa el último tope vigente (hasta ${formatMonthLabel('2026-01')})`));
    expect(notice).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Registrar pago' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Actualizar los topes en Ajustes' }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('says when no usury cap is known for the modality, and links to Ajustes', () => {
    renderDetail({ ...moraDetail({ legal: NO_CAP }), onOpenSettings: vi.fn() });

    expect(screen.getByText(/No hay un tope de usura registrado para esta modalidad; la mora usa la tasa del contrato/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Actualizar los topes en Ajustes' })).toBeInTheDocument();
  });

  it('warns that a mortgage mora does not apply Ley 546, next to the missing mortgage cap, and keeps both non-blocking', () => {
    renderDetail({ ...moraDetail({ kind: 'mortgage' }), onPay: vi.fn() });

    expect(screen.getByText(/En créditos hipotecarios la mora no aplica las reglas de la Ley 546 de 1999/)).toBeInTheDocument();
    expect(screen.getByText(/No hay un tope de usura registrado para esta modalidad/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Registrar pago' })).toBeEnabled();
  });

  it('shows the Ley 546 notice for a mortgage even when its cap is known', () => {
    renderDetail(moraDetail({ kind: 'mortgage', legal: NO_CAP }));

    expect(screen.getByText(/En créditos hipotecarios la mora no aplica las reglas de la Ley 546 de 1999/)).toBeInTheDocument();
    expect(screen.queryByText(/No hay un tope de usura/)).not.toBeInTheDocument();
  });

  it('shows no legal notice when the cap is current, and omits the Ajustes link without a handler', () => {
    renderDetail(moraDetail());

    expect(screen.queryByText(/último tope vigente/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No hay un tope de usura/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Actualizar los topes en Ajustes' })).not.toBeInTheDocument();
  });

  it('keeps the history line of a late_policy event instead of an amount', () => {
    const policy = makeEvent('lp', 'late_policy', '2026-02-01', 0, { late: { mode: 'usury', graceDays: 0 } });
    renderDetail(moraDetail({ late: null }, [MORA_DISBURSEMENT, policy], '2026-02-15'));

    expect(within(screen.getByRole('region', { name: 'Historial' })).getByText(/^Mora: tasa de usura desde /)).toBeInTheDocument();
  });
});

describe('DebtDetail explain popovers', () => {
  const DISCLAIMER = 'Información educativa con tus datos; no es asesoría financiera.';
  const moraDetail = (options = {}) => {
    const debt = makeMoraLoan(options);
    return { debt, detail: buildDebtDetail({ debt, events: [MORA_DISBURSEMENT], asOf: DAY_10 }) };
  };
  const without = (detail, ...figures) => ({ ...detail, explain: Object.fromEntries(Object.entries(detail.explain).filter(([figure]) => !figures.includes(figure))) });

  it('opens the mora explanation with its disclaimer next to the mora figure and writes nothing', async () => {
    const handlers = { onPay: vi.fn(), onVoid: vi.fn(), onSimulate: vi.fn(), onRateChange: vi.fn(), onChargeChange: vi.fn(), onLatePolicy: vi.fn(), onTermsCorrection: vi.fn(), onRestructure: vi.fn() };
    const user = userEvent.setup();
    renderDetail({ ...moraDetail(), ...handlers });
    const state = screen.getByRole('region', { name: 'Estado de la deuda' });

    await user.click(within(state).getByRole('button', { name: '¿Qué es esto? Mora acumulada' }));

    const dialog = screen.getByRole('dialog', { name: 'Intereses de mora' });
    expect(within(dialog).getByText(/Mora acumulada: \$ 1\.375 por 10 días|Mora acumulada: \$ 1\.375 por 10 días/)).toBeInTheDocument();
    expect(within(dialog).getByText(DISCLAIMER)).toBeInTheDocument();
    expect(within(dialog).getByText(/^Fuente: Crédito de consumo · cálculo de mora/)).toBeInTheDocument();
    Object.values(handlers).forEach((handler) => expect(handler).not.toHaveBeenCalled());
  });

  it('offers the rate and charges explanations next to their figures', async () => {
    const user = userEvent.setup();
    renderDetail({ ...moraDetail() });

    await user.click(within(screen.getByRole('region', { name: 'Estado de la deuda' })).getByRole('button', { name: '¿Qué es esto? Tasa' }));
    expect(screen.getByRole('dialog', { name: 'Tu tasa' })).toHaveTextContent(DISCLAIMER);
    await user.keyboard('{Escape}');

    await user.click(within(screen.getByRole('region', { name: 'Costo real del crédito' })).getByRole('button', { name: '¿Qué es esto? Cargos y seguros' }));
    expect(screen.getByRole('dialog', { name: 'Cargos, seguros e impuestos' })).toHaveTextContent(DISCLAIMER);
  });

  it('keeps the figure value as the sibling of its label', () => {
    renderDetail({ ...moraDetail() });

    expect(within(screen.getByRole('region', { name: 'Estado de la deuda' })).getByText('Mora acumulada').nextSibling).toHaveTextContent(formatMoney(1375));
  });

  it('shows no trigger for a topic that is not released', () => {
    const { debt, detail } = moraDetail();
    renderDetail({ debt, detail: without(detail, 'mora', 'charges') });

    expect(screen.queryByRole('button', { name: '¿Qué es esto? Mora acumulada' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '¿Qué es esto? Cargos y seguros' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '¿Qué es esto? Tasa' })).toBeInTheDocument();
  });

  it('shows no trigger at all when the detail carries no explanations', () => {
    const { debt, detail } = moraDetail();
    renderDetail({ debt, detail: { ...detail, explain: undefined } });

    expect(screen.queryByRole('button', { name: /¿Qué es esto\?/ })).not.toBeInTheDocument();
  });

  it('offers the mora explanation next to the legal notices of the mora', async () => {
    const user = userEvent.setup();
    renderDetail({ ...moraDetail({ legal: usuryLegal(['2025-01-01', '2026-01-31', 28.59]) }) });

    await user.click(screen.getByRole('button', { name: '¿Qué es esto? Aviso de mora' }));

    expect(screen.getByRole('dialog', { name: 'Intereses de mora' })).toHaveTextContent(DISCLAIMER);
  });

  it('has no mora notice trigger without a notice', () => {
    renderDetail({ ...moraDetail() });

    expect(screen.queryByRole('button', { name: '¿Qué es esto? Aviso de mora' })).not.toBeInTheDocument();
  });
});
