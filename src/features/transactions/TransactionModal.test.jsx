import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import TransactionModal from './TransactionModal';

const CATEGORIES = [
  { $id: 'c1', name: 'Mercado', kind: 'need' },
  { $id: 'c2', name: 'Transporte', kind: 'need' },
  { $id: 'c3', name: 'Ingresos', kind: 'income' },
];

const EMPTY_FORM = { merchant: '', amount: '', categoryId: 'c1', type: 'expense', owner: 'you', date: '2026-10-12', note: '' };

function Harness({ initialForm = EMPTY_FORM, categories = CATEGORIES, ...props }) {
  const [form, setForm] = useState(initialForm);
  return <TransactionModal form={form} setForm={setForm} categories={categories} {...props} />;
}

const renderModal = (overrides = {}) => {
  const props = {
    receiptFile: null,
    setReceiptFile: vi.fn(),
    editing: null,
    saving: false,
    onClose: vi.fn(),
    onSubmit: vi.fn((event) => event.preventDefault()),
    ...overrides,
  };
  render(<Harness {...props} />);
  return { props, user: userEvent.setup() };
};

const optionNames = () => within(screen.getByRole('combobox', { name: 'Categoría' })).getAllByRole('option').map((option) => option.textContent);

describe('TransactionModal', () => {
  it('groups expense categories by budget group and skips empty groups', () => {
    const categories = [
      { $id: 'a', name: 'Mercado', kind: 'need' },
      { $id: 'b', name: 'Cine', kind: 'want' },
      { $id: 'c', name: 'ETF', kind: 'investment' },
      { $id: 'd', name: 'Tarjeta', kind: 'debt' },
      { $id: 'e', name: 'Sueldo', kind: 'income' },
    ];
    render(<Harness categories={categories} initialForm={{ ...EMPTY_FORM, categoryId: 'a' }} receiptFile={null} setReceiptFile={vi.fn()} editing={null} saving={false} onClose={vi.fn()} onSubmit={vi.fn()} />);

    const groups = within(screen.getByRole('combobox', { name: 'Categoría' })).getAllByRole('group');
    expect(groups.map((group) => [group.getAttribute('label'), within(group).getAllByRole('option').map((option) => option.textContent)])).toEqual([
      ['Necesidades', ['Mercado']], ['Gustos', ['Cine']], ['Inversión', ['ETF']], ['Deudas', ['Tarjeta']],
    ]);
  });

  it('keeps income categories in a flat list', async () => {
    const { user } = renderModal();

    await user.click(screen.getByRole('button', { name: 'Ingreso' }));

    expect(screen.queryAllByRole('group', { name: /Necesidades/ })).toHaveLength(0);
    expect(optionNames()).toEqual(['Ingresos']);
  });

  it('opens as a labelled dialog', () => {
    renderModal();

    expect(screen.getByRole('dialog', { name: 'Nuevo movimiento' })).toBeInTheDocument();
  });

  it('switches the category options with the type toggle', async () => {
    const { user } = renderModal();
    const group = screen.getByRole('group', { name: 'Tipo de movimiento' });

    expect(optionNames()).toEqual(['Mercado', 'Transporte']);
    await user.click(within(group).getByRole('button', { name: 'Ingreso' }));

    expect(within(group).getByRole('button', { name: 'Ingreso' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: 'Gasto' })).toHaveAttribute('aria-pressed', 'false');
    expect(optionNames()).toEqual(['Ingresos']);
    expect(screen.getByRole('combobox', { name: 'Categoría' })).toHaveValue('c3');
  });

  it('selects the owner with a segmented control', async () => {
    const { user } = renderModal();
    const group = screen.getByRole('group', { name: '¿De quién?' });

    await user.click(within(group).getByRole('button', { name: 'Compartido' }));

    expect(within(group).getByRole('button', { name: 'Compartido' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: 'Tú' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('rejects receipts over 10 MB with an inline error', async () => {
    const { props, user } = renderModal();
    const file = new File(['x'], 'enorme.pdf', { type: 'application/pdf' });
    Object.defineProperty(file, 'size', { value: 11 * 1024 * 1024 });

    await user.upload(screen.getByLabelText(/Adjuntar recibo/), file);

    expect(screen.getByRole('alert')).toHaveTextContent('El recibo no puede superar 10 MB.');
    expect(props.setReceiptFile).not.toHaveBeenCalled();
  });

  it('accepts a valid receipt', async () => {
    const { props, user } = renderModal();
    const file = new File(['x'], 'recibo.png', { type: 'image/png' });

    await user.upload(screen.getByLabelText(/Adjuntar recibo/), file);

    expect(props.setReceiptFile).toHaveBeenCalledWith(file);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('hides the receipt dropzone when editing', () => {
    renderModal({ editing: { $id: 't1' } });

    expect(screen.getByRole('dialog', { name: 'Editar movimiento' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Adjuntar recibo/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeInTheDocument();
  });

  it('submits the form', async () => {
    const { props, user } = renderModal();

    await user.type(screen.getByLabelText('Monto'), '286400');
    await user.type(screen.getByLabelText('Concepto'), 'Mercado semanal');
    await user.click(screen.getByRole('button', { name: 'Guardar gasto' }));

    expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });

  it('shows the busy label and disables saving while saving', () => {
    renderModal({ saving: true });

    expect(screen.getByRole('button', { name: 'Guardando…' })).toBeDisabled();
  });

  it('closes on Escape and from Cancelar', async () => {
    const { props, user } = renderModal();

    await user.keyboard('{Escape}');
    expect(props.onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });
});
