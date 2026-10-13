import { serializeTerms } from '@finance-core';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../../appwrite';
import DebtsContainer from './DebtsContainer';

vi.mock('../../appwrite', () => ({ listDebts: vi.fn(), listDebtEvents: vi.fn() }));

const debt = (id, name, ownerScope) => ({
  $id: id, name, lender: 'Banco', kind: 'consumer', ownerScope, status: 'active', principalMinor: 1200000, termsVersion: 1,
  termsJson: serializeTerms({
    kind: 'consumer', principalMinor: 1200000, openedOn: '2026-09-01', rate: { convention: 'ZERO' },
    system: 'french', periodicity: 'monthly', n: 12, firstDueOn: '2099-01-05',
  }),
});

const DEBTS = [debt('d1', 'Libre inversión', 'you'), debt('d2', 'Deuda de la pareja', 'partner')];
const inScope = (item) => item.ownerScope !== 'partner';

beforeEach(() => {
  vi.clearAllMocks();
  api.listDebts.mockResolvedValue(DEBTS);
  api.listDebtEvents.mockResolvedValue([]);
});

describe('DebtsContainer list', () => {
  it('loads the debts, projects them and applies the scope filter', async () => {
    render(<DebtsContainer inScope={inScope} currentOwnerScope="you" />);

    const card = await screen.findByRole('article', { name: 'Libre inversión' });
    expect(within(card).getByText('$ 1.200.000')).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Deuda de la pareja' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Totales de deudas' })).getByText('$ 1.200.000')).toBeInTheDocument();
  });

  it('shows the error panel when loading fails and recovers with Reintentar', async () => {
    api.listDebts.mockRejectedValueOnce(new Error('sin red'));
    const user = userEvent.setup();
    render(<DebtsContainer inScope={inScope} currentOwnerScope="you" />);

    expect(await screen.findByText('No se pudieron cargar las deudas.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Totales de deudas' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));

    await waitFor(() => expect(screen.getByRole('article', { name: 'Libre inversión' })).toBeInTheDocument());
    expect(api.listDebts).toHaveBeenCalledTimes(2);
  });
});
