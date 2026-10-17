import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import DebtDetail from './DebtDetail';
import { buildDebtDetail } from './debtDetailModel';
import { serializeTerms } from '@finance-core';
import { CARD_TERMS, makeCard, makeEvent, makeMoraCard } from './debtFixtures';

const pay = (id, on, amount) => makeEvent(id, 'payment', on, amount);
const renderCard = (events, asOf, props = {}, debt = makeCard()) => {
  return render(<DebtDetail debt={debt} detail={buildDebtDetail({ debt, events: events.map((e) => ({ ...e, debtId: 'c1' })), asOf })} currentOwnerScope="you" onBack={vi.fn()} {...props} />);
};

describe('DebtDetail for a credit card', () => {
  it('shows the minimum payment, the full statement, the cycle dates and each tranche', () => {
    renderCard([], '2026-04-20');

    const state = screen.getByRole('region', { name: 'Estado de la deuda' });
    expect(within(state).getByText('Pago mínimo')).toBeInTheDocument();
    expect(within(state).getByText('$ 146.102')).toBeInTheDocument();
    expect(within(state).getByText('30 abr')).toBeInTheDocument();
    expect(within(state).getByText('$ 621.102')).toBeInTheDocument(); // pay in full
    expect(within(state).getByText('28 % E.A.')).toBeInTheDocument();

    const panel = screen.getByRole('region', { name: 'Tu tarjeta' });
    // The next payment is the pending minimum (30 abr), not the due date of the statement that has not closed yet.
    expect(within(panel).getByText('Próximo corte: 15 may. Próximo pago: 30 abr.')).toBeInTheDocument();
    const [revolving, nevera] = within(panel).getAllByRole('listitem');
    expect(revolving).toHaveTextContent('Saldo rotativo');
    expect(revolving).toHaveTextContent('$ 500.000');
    expect(nevera).toHaveTextContent('Nevera');
    expect(nevera).toHaveTextContent('Compra a 12 cuotas, quedan 11');
    expect(nevera).toHaveTextContent('$ 1.200.000');
    expect(within(panel).getByText('Último extracto, corte del 15 abr')).toBeInTheDocument();
    for (const amount of ['$ 10.392', '$ 10.710', '$ 100.000']) expect(within(panel).getByText(amount)).toBeInTheDocument(); // interest, fee + IVA, installment
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Simular abono' })).not.toBeInTheDocument();
  });

  it('shows the copied opening statement as its balance and minimum, not as zero interest and fees', () => {
    const opened = makeCard({ termsJson: serializeTerms({ ...CARD_TERMS, openedOn: '2026-04-15', card: { ...CARD_TERMS.card, deferred: [], openingMinimumMinor: 30000 } }) });
    renderCard([], '2026-04-20', {}, opened);

    const state = screen.getByRole('region', { name: 'Estado de la deuda' });
    expect(within(state).getByText('$ 30.000')).toBeInTheDocument();
    expect(within(state).getByText('30 abr')).toBeInTheDocument();
    const panel = screen.getByRole('region', { name: 'Tu tarjeta' });
    expect(within(panel).getByText('Último extracto, corte del 15 abr')).toBeInTheDocument();
    expect(within(panel).getByText('Saldo del extracto')).toBeInTheDocument();
    expect(within(panel).getByText('$ 500.000', { selector: 'dd' })).toBeInTheDocument();
    expect(within(panel).getByText('Pago mínimo del extracto')).toBeInTheDocument();
    expect(within(panel).queryByText('Intereses')).not.toBeInTheDocument();
  });

  it('shows the rate in force after an active rate change, and the original one once it is voided', () => {
    const to24 = makeEvent('r1', 'rate_change', '2026-04-20', 0, { rate: { value: 24, basis: 'effective', periodicity: 'annual', timing: 'arrears' }, mode: 'keep_term' });
    const { unmount } = renderCard([to24], '2026-05-20');
    expect(within(screen.getByRole('region', { name: 'Estado de la deuda' })).getByText('24 % E.A.')).toBeInTheDocument();
    unmount();

    renderCard([to24, makeEvent('v1', 'void', '2026-04-21', 0, { targetEventId: 'r1', reason: 'x' })], '2026-05-20');
    expect(within(screen.getByRole('region', { name: 'Estado de la deuda' })).getByText('28 % E.A.')).toBeInTheDocument();
  });

  it('flags a minimum that was not paid by the due date, and clears the flag once it is paid', () => {
    const { unmount } = renderCard([], '2026-05-02');
    expect(screen.getByRole('alert')).toHaveTextContent('Tienes $ 146.102 vencidos');
    expect(within(screen.getByRole('region', { name: 'Estado de la deuda' })).getByText('Vencido')).toBeInTheDocument();
    unmount();

    renderCard([pay('p1', '2026-04-30', 146102)], '2026-05-02');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Estado de la deuda' })).getByText('Sin pago mínimo pendiente')).toBeInTheDocument();
  });

  it('offers the statement and purchase actions only when the container wires them', async () => {
    const onStatement = vi.fn();
    const onCharge = vi.fn();
    const { unmount } = renderCard([], '2026-04-20');
    expect(screen.queryByRole('button', { name: 'Registrar extracto' })).not.toBeInTheDocument();
    unmount();

    renderCard([], '2026-04-20', { onStatement, onCharge });
    await userEvent.click(screen.getByRole('button', { name: 'Registrar extracto' }));
    await userEvent.click(screen.getByRole('button', { name: 'Registrar compra' }));
    expect(onStatement).toHaveBeenCalledTimes(1);
    expect(onCharge).toHaveBeenCalledTimes(1);
  });

  it('never offers "Reestructurar" in the Más acciones menu of a card', async () => {
    const wired = { onRateChange: vi.fn(), onChargeChange: vi.fn(), onLatePolicy: vi.fn(), onTermsCorrection: vi.fn(), onRestructure: vi.fn() };
    renderCard([], '2026-04-20', wired);
    await userEvent.click(screen.getByRole('button', { name: 'Más acciones' }));

    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Cambiar tasa', 'Cambiar seguros y cargos', 'Configurar mora', 'Corregir datos']);
  });
});

describe('DebtDetail for a credit card with mora', () => {
  const panel = () => screen.getByRole('region', { name: 'Tu tarjeta' });

  it('shows the mora running on the unmet capital and when it will be billed', () => {
    renderCard([], '2026-05-10', {}, makeMoraCard());

    expect(within(panel()).getByText('Mora en curso: $ 861 (se cobra en el corte del 15 may)')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Estado de la deuda' })).getByText('Mora acumulada')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('con $ 861 de mora');
  });

  it('shows the mora billed in the last statement as its own line', () => {
    renderCard([], '2026-05-20', {}, makeMoraCard());

    expect(within(panel()).getByText('Último extracto, corte del 15 may')).toBeInTheDocument();
    const mora = within(panel()).getByText('Mora');
    expect(mora.nextSibling).toHaveTextContent('$ 1.292');
    expect(within(panel()).queryByText(/Mora en curso/)).not.toBeInTheDocument();
  });

  it('shows no mora line for a card without mora, even when it is past due', () => {
    renderCard([], '2026-05-20', {}, makeCard());

    expect(within(panel()).queryByText('Mora')).not.toBeInTheDocument();
    expect(within(panel()).queryByText(/Mora en curso/)).not.toBeInTheDocument();
  });
});

describe('DebtDetail card explain popovers', () => {
  const DISCLAIMER = 'Información educativa con tus datos; no es asesoría financiera.';

  it('explains the minimum payment next to its figure and the last statement in the card panel, writing nothing', async () => {
    const onPay = vi.fn();
    const user = userEvent.setup();
    renderCard([], '2026-04-20', { onPay });

    await user.click(within(screen.getByRole('region', { name: 'Estado de la deuda' })).getByRole('button', { name: '¿Qué es esto? Pago mínimo' }));
    const minimum = screen.getByRole('dialog', { name: 'Pago mínimo' });
    expect(minimum).toHaveTextContent('Pago mínimo: $ 146.102');
    expect(minimum).toHaveTextContent(DISCLAIMER);
    await user.keyboard('{Escape}');

    await user.click(within(screen.getByRole('region', { name: 'Tu tarjeta' })).getByRole('button', { name: '¿Qué es esto? Último extracto' }));
    expect(screen.getByRole('dialog', { name: 'Extracto de la tarjeta' })).toHaveTextContent(DISCLAIMER);
    expect(onPay).not.toHaveBeenCalled();
  });

  it('explains the mora of the card next to its figure', async () => {
    const user = userEvent.setup();
    const debt = makeMoraCard();
    renderCard([], '2026-05-10', {}, debt);

    await user.click(within(screen.getByRole('region', { name: 'Tu tarjeta' })).getByRole('button', { name: '¿Qué es esto? Mora en curso' }));

    expect(screen.getByRole('dialog', { name: 'Intereses de mora' })).toHaveTextContent('(aproximado)');
  });

  it('shows no trigger for a topic that is not released', () => {
    const debt = makeCard();
    const detail = buildDebtDetail({ debt, events: [], asOf: '2026-04-20' });
    render(<DebtDetail debt={debt} detail={{ ...detail, explain: {} }} currentOwnerScope="you" onBack={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /¿Qué es esto\?/ })).not.toBeInTheDocument();
  });
});
