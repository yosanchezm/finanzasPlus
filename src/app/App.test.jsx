import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addMonths, monthKey, monthRange } from '../shared/lib/dates';
import { formatMonth } from '../shared/lib/format';
import * as api from '../appwrite';
import App from './App';

vi.mock('../appwrite', () => ({
  appwriteConfig: { currency: 'COP' },
  missingAppwriteConfig: [],
  getCurrentUser: vi.fn(),
  getWorkspace: vi.fn(),
  getTransactionsInRange: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  createAccount: vi.fn(),
  createTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
  createReceipt: vi.fn(),
  upsertBudget: vi.fn(),
  createGoal: vi.fn(),
  updateGoal: vi.fn(),
  createCategory: vi.fn(),
  listAttachments: vi.fn(),
  listDebts: vi.fn(),
  listDebtEvents: vi.fn(),
  createDebt: vi.fn(),
  debtPort: vi.fn(),
  listLegalRates: vi.fn(),
  upsertLegalRate: vi.fn(),
}));

const USER = { $id: 'u1', name: 'Camilo', email: 'camilo@example.com' };
const WORKSPACE = {
  household: { $id: 'h1', name: 'Casa Sánchez', ownerId: 'u1' },
  members: [{ $id: 'm1', userId: 'u1', alias: 'Camilo' }],
  categories: [{ $id: 'c1', name: 'Mercado', kind: 'need', color: '#0B6E4F' }],
  budgets: [],
  goals: [],
};

const currentMonth = monthKey(new Date());
const previousMonth = addMonths(currentMonth, -1);
const middleOf = (key) => {
  const [year, month] = key.split('-').map(Number);
  return new Date(year, month - 1, 15, 12).toISOString();
};
const rowFor = (key, merchant) => ({
  $id: `t-${key}`, merchant, categoryId: 'c1', type: 'expense', amountMinor: 1000, currency: 'COP', ownerScope: 'you', occurredAt: middleOf(key),
});

beforeEach(() => {
  vi.clearAllMocks();
  api.getCurrentUser.mockResolvedValue(USER);
  api.getWorkspace.mockResolvedValue(WORKSPACE);
  api.listAttachments.mockResolvedValue([]);
  api.getTransactionsInRange.mockImplementation(async (start) => {
    if (start === monthRange(currentMonth).start) return [rowFor(currentMonth, 'Compra de este mes')];
    if (start === monthRange(previousMonth).start) return [rowFor(previousMonth, 'Compra del mes pasado')];
    return [];
  });
});

const renderReadyApp = async () => {
  const user = userEvent.setup();
  render(<App />);
  expect(await screen.findByRole('heading', { level: 1, name: 'Resumen' })).toBeInTheDocument();
  return user;
};

describe('App', () => {
  it('loads the selected month and the 5 previous months as ranges', async () => {
    await renderReadyApp();

    expect(await screen.findByText('Compra de este mes')).toBeInTheDocument();
    expect(api.getTransactionsInRange).toHaveBeenCalledWith(monthRange(currentMonth).start, monthRange(currentMonth).end);
    expect(api.getTransactionsInRange).toHaveBeenCalledWith(monthRange(addMonths(currentMonth, -5)).start, monthRange(currentMonth).start);
  });

  it('keeps the shell mounted while refreshing', async () => {
    const user = await renderReadyApp();
    await screen.findByText('Compra de este mes');
    let finish;
    api.getWorkspace.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve(WORKSPACE); }));

    await user.click(screen.getAllByRole('button', { name: 'Actualizar datos' })[0]);

    expect(screen.getByRole('heading', { level: 1, name: 'Resumen' })).toBeInTheDocument();
    expect(screen.getAllByRole('navigation', { name: 'Navegación principal' }).length).toBeGreaterThan(0);
    expect(screen.queryByText('Conectando con tu hogar…')).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Actualizando datos' })).toBeInTheDocument();

    finish();
    await waitFor(() => expect(screen.queryByRole('progressbar', { name: 'Actualizando datos' })).not.toBeInTheDocument());
    expect(screen.getByText('Compra de este mes')).toBeInTheDocument();
  });

  it('navigates between months, reloading the views and blocking future months', async () => {
    const user = await renderReadyApp();
    await screen.findByText('Compra de este mes');
    const next = () => screen.getAllByRole('button', { name: 'Mes siguiente' })[0];

    expect(next()).toBeDisabled();
    await user.click(screen.getAllByRole('button', { name: 'Mes anterior' })[0]);

    expect(await screen.findByText('Compra del mes pasado')).toBeInTheDocument();
    expect(screen.queryByText('Compra de este mes')).not.toBeInTheDocument();
    expect(api.getTransactionsInRange).toHaveBeenCalledWith(monthRange(previousMonth).start, monthRange(previousMonth).end);
    const label = formatMonth(previousMonth).replace(' de ', ' ');
    expect(screen.getAllByRole('group', { name: 'Periodo' })[0]).toHaveTextContent(label.charAt(0).toUpperCase() + label.slice(1));
    expect(next()).toBeEnabled();

    await user.click(next());
    expect(await screen.findByText('Compra de este mes')).toBeInTheDocument();
    expect(next()).toBeDisabled();
  });
});

describe('App debts section', () => {
  const debtRow = (name, ownerScope) => ({
    $id: name, name, lender: 'Banco', kind: 'consumer', ownerScope, status: 'active', principalMinor: 1200000, termsVersion: 1,
    termsJson: JSON.stringify({
      schemaVersion: 1, kind: 'consumer', unit: 'COP', principalMinor: 1200000, openedOn: '2026-09-01', rate: { value: 0, basis: 'effective', periodicity: 'annual', timing: 'arrears' },
      system: 'french', periodicity: 'monthly', n: 12, firstDueOn: '2099-01-05', charges: [],
    }),
  });

  it('lazily opens Deudas from the sidebar, filtered by the scope control, without the period switcher', async () => {
    api.listDebts.mockResolvedValue([debtRow('Libre inversión', 'you'), debtRow('Deuda de la pareja', 'partner')]);
    api.listDebtEvents.mockResolvedValue([]);
    const user = await renderReadyApp();
    expect(api.listDebts).not.toHaveBeenCalled();
    expect(screen.getAllByRole('group', { name: 'Periodo' }).length).toBeGreaterThan(0);

    await user.click(within(screen.getAllByRole('navigation', { name: 'Navegación principal' })[0]).getByRole('button', { name: 'Deudas' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Deudas' })).toBeInTheDocument();
    expect(await screen.findByRole('article', { name: 'Libre inversión' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Deuda de la pareja' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Periodo' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cambiar mes/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Tú' }));
    expect(screen.queryByRole('article', { name: 'Deuda de la pareja' })).not.toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Libre inversión' })).toBeInTheDocument();
  });

  it('creates a debt for the household and refreshes the month data afterwards', async () => {
    api.listDebts.mockResolvedValue([]);
    api.listDebtEvents.mockResolvedValue([]);
    api.createDebt.mockResolvedValue({});
    api.debtPort.mockReturnValue({ createEvent: vi.fn(async ({ id, data }) => ({ $id: id, ...data })) });
    const user = await renderReadyApp();
    await user.click(within(screen.getAllByRole('navigation', { name: 'Navegación principal' })[0]).getByRole('button', { name: 'Deudas' }));
    const refreshesBefore = api.getWorkspace.mock.calls.length;

    await user.click(await screen.findByRole('button', { name: 'Registrar una deuda' }));
    await user.click(screen.getByRole('button', { name: /^Informal/ }));
    await user.type(screen.getByLabelText('Nombre de la deuda'), 'Préstamo de papá');
    await user.type(screen.getByLabelText('Monto del préstamo'), '500000');
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    await user.click(screen.getByRole('button', { name: 'Guardar deuda' }));

    expect(await screen.findByText('Deuda registrada.')).toBeInTheDocument();
    expect(api.createDebt).toHaveBeenCalledWith({ id: expect.stringMatching(/^db/), data: expect.objectContaining({ householdId: 'h1', actorId: 'u1', name: 'Préstamo de papá' }) });
    expect(api.getWorkspace.mock.calls.length).toBeGreaterThan(refreshesBefore);
  });
});

describe('App Ajustes section', () => {
  it('lazily opens Ajustes from the sidebar without the period switcher and reads the legal rates once', async () => {
    api.listLegalRates.mockResolvedValue([]);
    const user = await renderReadyApp();
    expect(api.listLegalRates).not.toHaveBeenCalled();
    expect(screen.getAllByRole('group', { name: 'Periodo' }).length).toBeGreaterThan(0);

    await user.click(within(screen.getByRole('complementary')).getByRole('button', { name: 'Ajustes' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Ajustes' })).toBeInTheDocument();
    await waitFor(() => expect(api.listLegalRates).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('group', { name: 'Periodo' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('complementary')).getByRole('button', { name: 'Ajustes' })).toHaveAttribute('aria-current', 'page');
  });

  it('opens Ajustes from the mobile "Más" sheet', async () => {
    api.listLegalRates.mockResolvedValue([]);
    const user = await renderReadyApp();

    await user.click(screen.getByRole('button', { name: 'Más' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Más opciones' })).getByRole('button', { name: 'Ajustes' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Ajustes' })).toBeInTheDocument();
  });
});

describe('App transaction detail', () => {
  it('opens the detail from Resumen, lists its receipts and edits it from there', async () => {
    const user = await renderReadyApp();

    await user.click(await screen.findByRole('button', { name: 'Ver detalle de Compra de este mes' }));
    const detail = screen.getByRole('dialog', { name: 'Compra de este mes' });
    expect(await within(detail).findByText('Sin recibo')).toBeInTheDocument();
    expect(api.listAttachments).toHaveBeenCalledWith(`t-${currentMonth}`);

    await user.click(within(detail).getByRole('button', { name: 'Editar' }));

    expect(screen.queryByRole('dialog', { name: 'Compra de este mes' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Editar movimiento' })).toBeInTheDocument();
    expect(screen.getByLabelText('Concepto')).toHaveValue('Compra de este mes');
  });
});
