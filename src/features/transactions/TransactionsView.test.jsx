import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { downloadTextFile } from '../../shared/lib/download';
import TransactionsView from './TransactionsView';

vi.mock('../../shared/lib/download', () => ({ downloadTextFile: vi.fn() }));

const at = (day) => new Date(2026, 9, day, 12).toISOString();

const TRANSACTIONS = [
  { $id: 't1', categoryId: 'c1', merchant: 'Mercado semanal', categoryName: 'Mercado', categoryColor: '#0B6E4F', type: 'expense', amountMinor: 286400, currency: 'COP', ownerScope: 'shared', occurredAt: at(27) },
  { $id: 't2', categoryId: 'c9', merchant: 'Nómina', categoryName: 'Ingresos', categoryColor: '#2E3833', type: 'income', amountMinor: 5200000, currency: 'COP', ownerScope: 'you', occurredAt: at(25) },
  { $id: 't3', categoryId: 'c2', merchant: 'Taxi', categoryName: 'Transporte', categoryColor: '#7A5AF8', note: 'aeropuerto', type: 'expense', amountMinor: 48900, currency: 'COP', ownerScope: 'partner', occurredAt: at(23) },
];

const CATEGORIES = [
  { $id: 'c1', name: 'Mercado', kind: 'need' },
  { $id: 'c2', name: 'Transporte', kind: 'need' },
  { $id: 'c9', name: 'Ingresos', kind: 'income' },
];

const renderView = (overrides = {}) => {
  const props = {
    transactions: TRANSACTIONS,
    categories: CATEGORIES,
    month: '2026-10',
    currentOwnerScope: 'you',
    onAdd: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  render(<TransactionsView {...props} />);
  return { props, user: userEvent.setup() };
};

const bodyRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);

describe('TransactionsView', () => {
  it('renders a table with one row per transaction, owner chips and signed amounts', () => {
    renderView();

    expect(bodyRows()).toHaveLength(3);
    for (const header of ['Fecha', 'Concepto', 'Categoría', 'Quién', 'Monto', 'Acciones']) {
      expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument();
    }
    const payroll = screen.getByRole('row', { name: /Nómina/ });
    expect(within(payroll).getByText('Tú')).toBeInTheDocument();
    expect(within(payroll).getByText('+ $ 5.200.000')).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /Mercado semanal/ })).getByText('Compartido')).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /Taxi/ })).getByText('− $ 48.900')).toBeInTheDocument();
    expect(screen.getByText('3 registros')).toBeInTheDocument();
  });

  it('filters rows by concept, category or note', async () => {
    const { user } = renderView();
    const search = screen.getByRole('searchbox', { name: 'Buscar movimientos' });

    await user.type(search, 'aeropuerto');
    expect(bodyRows()).toHaveLength(1);
    expect(screen.getByRole('row', { name: /Taxi/ })).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, 'mercado');
    expect(bodyRows()).toHaveLength(1);
    expect(screen.getByText('1 registro')).toBeInTheDocument();
  });

  it('shows an empty state when nothing matches', async () => {
    const { user } = renderView();

    await user.type(screen.getByRole('searchbox', { name: 'Buscar movimientos' }), 'zzz');

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('No hay movimientos que coincidan con tu búsqueda.')).toBeInTheDocument();
  });

  it('filters by type with a segmented control', async () => {
    const { user } = renderView();
    const group = screen.getByRole('group', { name: 'Tipo' });

    expect(within(group).getByRole('button', { name: 'Todos' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(group).getByRole('button', { name: 'Ingresos' }));

    expect(within(group).getByRole('button', { name: 'Ingresos' })).toHaveAttribute('aria-pressed', 'true');
    expect(bodyRows()).toHaveLength(1);
    expect(screen.getByRole('row', { name: /Nómina/ })).toBeInTheDocument();

    await user.click(within(group).getByRole('button', { name: 'Gastos' }));
    expect(bodyRows()).toHaveLength(2);
  });

  it('calls onEdit with the transaction', async () => {
    const { props, user } = renderView();

    await user.click(screen.getByRole('button', { name: 'Editar Nómina' }));

    expect(props.onEdit).toHaveBeenCalledWith(TRANSACTIONS[1]);
  });

  it('asks for confirmation before deleting', async () => {
    const { props, user } = renderView();

    await user.click(screen.getByRole('button', { name: 'Eliminar Taxi' }));
    const dialog = screen.getByRole('alertdialog', { name: '¿Eliminar movimiento?' });
    expect(props.onDelete).not.toHaveBeenCalled();
    expect(dialog).toHaveTextContent('Taxi');

    await user.click(within(dialog).getByRole('button', { name: 'Eliminar' }));

    expect(props.onDelete).toHaveBeenCalledWith(TRANSACTIONS[2]);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('does not delete when the confirmation is cancelled', async () => {
    const { props, user } = renderView();

    await user.click(screen.getByRole('button', { name: 'Eliminar Taxi' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancelar' }));

    expect(props.onDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('renders a stacked list instead of the table on narrow screens', () => {
    window.innerWidth = 375;
    renderView();

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Movimientos' })).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Editar Taxi' })).toBeInTheDocument();
  });

  it('calls onAdd from the header action', async () => {
    const { props, user } = renderView();

    await user.click(screen.getByRole('button', { name: 'Nuevo movimiento' }));

    expect(props.onAdd).toHaveBeenCalled();
  });
});

const manyTransactions = (count) => Array.from({ length: count }, (_, index) => ({
  $id: `m${index}`,
  categoryId: index % 2 ? 'c2' : 'c1',
  merchant: `Compra ${String(index + 1).padStart(2, '0')}`,
  categoryName: index % 2 ? 'Transporte' : 'Mercado',
  type: 'expense',
  amountMinor: 1000 + index,
  currency: 'COP',
  ownerScope: index % 3 === 0 ? 'shared' : 'you',
  occurredAt: at((index % 28) + 1),
}));

describe('TransactionsView filters, pagination and export', () => {
  it('combines the category and owner filters with search and type', async () => {
    const { user } = renderView();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Categoría' }), 'c2');
    expect(bodyRows()).toHaveLength(1);
    expect(screen.getByRole('row', { name: /Taxi/ })).toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Quién' }), 'you');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    expect(bodyRows()).toHaveLength(3);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Quién' }), 'shared');
    await user.type(screen.getByRole('searchbox', { name: 'Buscar movimientos' }), 'mercado');
    expect(bodyRows()).toHaveLength(1);
    await user.click(within(screen.getByRole('group', { name: 'Tipo' })).getByRole('button', { name: 'Ingresos' }));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('paginates 25 rows per page and resets to the first page when filters change', async () => {
    const { user } = renderView({ transactions: manyTransactions(30) });
    const pager = screen.getByRole('navigation', { name: 'Paginación' });

    expect(pager).toHaveTextContent('Mostrando 1–25 de 30');
    expect(bodyRows()).toHaveLength(25);
    expect(within(pager).getByRole('button', { name: 'Anterior' })).toBeDisabled();

    await user.click(within(pager).getByRole('button', { name: 'Siguiente' }));
    expect(pager).toHaveTextContent('Mostrando 26–30 de 30');
    expect(bodyRows()).toHaveLength(5);
    expect(within(pager).getByRole('button', { name: 'Siguiente' })).toBeDisabled();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Categoría' }), 'c1');
    expect(screen.getByRole('navigation', { name: 'Paginación' })).toHaveTextContent('Mostrando 1–15 de 15');
  });

  it('applies a search query coming from the parent', () => {
    renderView({ search: 'taxi', onSearchChange: vi.fn() });

    expect(screen.getByRole('searchbox', { name: 'Buscar movimientos' })).toHaveValue('taxi');
    expect(bodyRows()).toHaveLength(1);
  });

  it('exports the filtered rows as a CSV named after the month', async () => {
    const { user } = renderView();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Categoría' }), 'c2');
    await user.click(screen.getByRole('button', { name: 'Exportar CSV' }));

    expect(downloadTextFile).toHaveBeenCalledTimes(1);
    const [fileName, content, mimeType] = downloadTextFile.mock.calls[0];
    expect(fileName).toBe('movimientos-2026-10.csv');
    expect(mimeType).toBe('text/csv;charset=utf-8');
    const lines = content.slice(1).split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('Taxi');
  });

  it('disables the export when there is nothing to export', async () => {
    const { user } = renderView();

    await user.type(screen.getByRole('searchbox', { name: 'Buscar movimientos' }), 'zzz');

    expect(screen.getByRole('button', { name: 'Exportar CSV' })).toBeDisabled();
  });
});
