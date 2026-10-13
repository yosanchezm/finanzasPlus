import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import TransactionDetail from './TransactionDetail';

const TRANSACTION = {
  $id: 't1',
  merchant: 'Mercado semanal',
  type: 'expense',
  amountMinor: 286400,
  currency: 'COP',
  categoryId: 'c1',
  categoryName: 'Mercado',
  categoryColor: '#0B6E4F',
  ownerScope: 'shared',
  occurredAt: new Date(2026, 9, 27, 14, 5).toISOString(),
  note: 'Con descuento',
  source: 'telegram',
  confidence: 0.92,
  actorId: 'u2',
  $createdAt: new Date(2026, 9, 27, 14, 6).toISOString(),
  $updatedAt: new Date(2026, 9, 28, 9, 30).toISOString(),
};

const MEMBERS = [
  { $id: 'm1', userId: 'u1', alias: 'Camilo' },
  { $id: 'm2', userId: 'u2', alias: 'Laura' },
];

const renderDetail = (overrides = {}) => {
  const props = {
    transaction: TRANSACTION,
    currentOwnerScope: 'you',
    currentUserId: 'u1',
    members: MEMBERS,
    loadAttachments: vi.fn().mockResolvedValue([]),
    onClose: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  render(<TransactionDetail {...props} />);
  return { props, user: userEvent.setup() };
};

const field = (label) => screen.getByText(label, { selector: 'dt' }).nextElementSibling;

describe('TransactionDetail', () => {
  it('opens as a dialog named after the concept with the signed amount and type', async () => {
    renderDetail();
    const dialog = screen.getByRole('dialog', { name: 'Mercado semanal' });

    expect(within(dialog).getByText('− $ 286.400')).toBeInTheDocument();
    expect(within(dialog).getByText('Gasto')).toBeInTheDocument();
    await screen.findByText('Sin recibo');
  });

  it('renders the stored fields, including date and time, source, author and edit time', async () => {
    renderDetail();
    await screen.findByText('Sin recibo');

    expect(field('Concepto')).toHaveTextContent('Mercado semanal');
    expect(field('Categoría')).toHaveTextContent('Mercado');
    expect(field('Quién')).toHaveTextContent('Compartido');
    expect(field('Fecha')).toHaveTextContent('27 oct 2026 · 2:05 p. m.');
    expect(field('Nota')).toHaveTextContent('Con descuento');
    expect(field('Registrado vía')).toHaveTextContent('Telegram · Nia (confianza 92 %)');
    expect(field('Creado por')).toHaveTextContent('Laura');
    expect(field('Fecha de registro')).toHaveTextContent('27 oct 2026 · 2:06 p. m.');
    expect(field('Última edición')).toHaveTextContent('28 oct 2026 · 9:30 a. m.');
  });

  it('says "Sin nota" and hides fields that do not apply', async () => {
    renderDetail({
      transaction: { ...TRANSACTION, note: '', source: 'web', confidence: 1, actorId: 'u1', $updatedAt: TRANSACTION.$createdAt },
    });
    await screen.findByText('Sin recibo');

    expect(field('Nota')).toHaveTextContent('Sin nota');
    expect(field('Registrado vía')).toHaveTextContent('Web');
    expect(field('Creado por')).toHaveTextContent('Camilo (tú)');
    expect(screen.queryByText('Última edición', { selector: 'dt' })).not.toBeInTheDocument();
  });

  it('shows an unlinked Telegram author honestly', async () => {
    renderDetail({ transaction: { ...TRANSACTION, actorId: 'telegram:99' } });
    await screen.findByText('Sin recibo');

    expect(field('Creado por')).toHaveTextContent('Usuario de Telegram sin vincular');
  });

  it('loads the receipts of this transaction and previews images', async () => {
    const { props } = renderDetail({
      loadAttachments: vi.fn().mockResolvedValue([
        { $id: 'a1', mimeType: 'image/jpeg', originalName: 'ticket.jpg', previewUrl: 'https://files.test/preview/a1', viewUrl: 'https://files.test/view/a1' },
      ]),
    });

    const image = await screen.findByRole('img', { name: 'Recibo ticket.jpg' });
    expect(props.loadAttachments).toHaveBeenCalledWith('t1');
    expect(image).toHaveAttribute('src', 'https://files.test/preview/a1');
  });

  it('falls back to the original file and then to a link when the image cannot load', async () => {
    renderDetail({
      loadAttachments: vi.fn().mockResolvedValue([
        { $id: 'a1', mimeType: 'image/png', originalName: 'ticket.png', previewUrl: 'https://files.test/preview/a1', viewUrl: 'https://files.test/view/a1' },
      ]),
    });

    const image = await screen.findByRole('img', { name: 'Recibo ticket.png' });
    fireEvent.error(image);
    expect(screen.getByRole('img', { name: 'Recibo ticket.png' })).toHaveAttribute('src', 'https://files.test/view/a1');
    fireEvent.error(screen.getByRole('img', { name: 'Recibo ticket.png' }));

    expect(screen.queryByRole('img', { name: 'Recibo ticket.png' })).not.toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Abrir recibo/ });
    expect(link).toHaveAttribute('href', 'https://files.test/view/a1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.getByText(/No se pudo mostrar la vista previa/)).toBeInTheDocument();
  });

  it('links PDFs instead of previewing them', async () => {
    renderDetail({
      loadAttachments: vi.fn().mockResolvedValue([
        { $id: 'a2', mimeType: 'application/pdf', originalName: 'factura.pdf', previewUrl: 'https://files.test/preview/a2', viewUrl: 'https://files.test/view/a2' },
      ]),
    });

    const link = await screen.findByRole('link', { name: 'Abrir recibo factura.pdf (PDF)' });
    expect(link).toHaveAttribute('href', 'https://files.test/view/a2');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('reports a receipt loading error', async () => {
    renderDetail({ loadAttachments: vi.fn().mockRejectedValue(new Error('403')) });

    expect(await screen.findByText('No se pudieron cargar los recibos.')).toBeInTheDocument();
  });

  it('edits from the footer', async () => {
    const { props, user } = renderDetail();
    await screen.findByText('Sin recibo');

    await user.click(screen.getByRole('button', { name: 'Editar' }));

    expect(props.onEdit).toHaveBeenCalledWith(TRANSACTION);
  });

  it('deletes only after confirming', async () => {
    const { props, user } = renderDetail();
    await screen.findByText('Sin recibo');

    await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    expect(props.onDelete).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole('alertdialog', { name: '¿Eliminar movimiento?' })).getByRole('button', { name: 'Eliminar' }));

    expect(props.onDelete).toHaveBeenCalledWith(TRANSACTION);
  });

  it('closes with Escape and with Cerrar', async () => {
    const { props, user } = renderDetail();
    await screen.findByText('Sin recibo');

    await user.keyboard('{Escape}');
    expect(props.onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });
});
