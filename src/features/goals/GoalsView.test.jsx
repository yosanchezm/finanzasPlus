import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import GoalsView from './GoalsView';

const today = new Date(2026, 9, 12);

const GOALS = [
  { $id: 'g1', name: 'Fondo de emergencia', targetMinor: 15000000, currentMinor: 8400000, ownerScope: 'shared', status: 'active', targetDate: new Date(2027, 5, 15, 12).toISOString() },
  { $id: 'g2', name: 'Portátil nuevo', targetMinor: 5500000, currentMinor: 1200000, ownerScope: 'you', status: 'active' },
];

const renderView = (goals = GOALS, onContribute = vi.fn().mockResolvedValue(undefined)) => {
  const onAdd = vi.fn();
  render(<GoalsView goals={goals} currentOwnerScope="you" onAdd={onAdd} onContribute={onContribute} today={today} />);
  return { onAdd, onContribute, user: userEvent.setup() };
};

describe('GoalsView', () => {
  it('renders progress, remaining amount and owner for each goal', () => {
    renderView();
    const card = screen.getByRole('article', { name: 'Fondo de emergencia' });

    expect(within(card).getByText('56 %')).toBeInTheDocument();
    expect(within(card).getByText('Faltan $ 6.600.000')).toBeInTheDocument();
    expect(within(card).getByText('$ 8.400.000')).toBeInTheDocument();
    expect(within(card).getByText('de $ 15.000.000')).toBeInTheDocument();
    expect(within(card).getByText('Compartida')).toBeInTheDocument();
    expect(within(card).getByText('Meta para junio de 2027')).toBeInTheDocument();
  });

  it('shows a suggested monthly contribution only when a target date exists', () => {
    renderView();

    expect(within(screen.getByRole('article', { name: 'Fondo de emergencia' })).getByText('$ 825.000 / mes')).toBeInTheDocument();
    const laptop = screen.getByRole('article', { name: 'Portátil nuevo' });
    expect(within(laptop).queryByText(/Sugerido/)).not.toBeInTheDocument();
    expect(within(laptop).getByText('Sin fecha objetivo')).toBeInTheDocument();
    expect(within(laptop).getByText('Tú')).toBeInTheDocument();
  });

  it('calls onAdd from the "Crear una meta" card', async () => {
    const { onAdd, user } = renderView();

    await user.click(screen.getByRole('button', { name: /Crear una meta/ }));

    expect(onAdd).toHaveBeenCalled();
  });

  it('still offers the create card when there are no goals', async () => {
    const { onAdd, user } = renderView([]);

    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Crear una meta/ }));
    expect(onAdd).toHaveBeenCalled();
  });
});

describe('GoalsView contributions', () => {
  const openContribution = async (user, name) => {
    await user.click(within(screen.getByRole('article', { name })).getByRole('button', { name: 'Registrar aporte' }));
    return screen.getByRole('dialog', { name: `Registrar aporte a ${name}` });
  };

  it('records a positive contribution for the goal', async () => {
    const { onContribute, user } = renderView();
    const dialog = await openContribution(user, 'Fondo de emergencia');

    await user.type(within(dialog).getByLabelText('Monto del aporte'), '500000');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar aporte' }));

    expect(onContribute).toHaveBeenCalledWith(GOALS[0], 500000);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('rejects zero or negative amounts with an inline error', async () => {
    const { onContribute, user } = renderView();
    const dialog = await openContribution(user, 'Portátil nuevo');

    await user.type(within(dialog).getByLabelText('Monto del aporte'), '0');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar aporte' }));

    expect(within(dialog).getByRole('alert')).toHaveTextContent('Escribe un monto mayor que cero.');
    expect(onContribute).not.toHaveBeenCalled();
  });

  it('keeps the dialog open when saving fails', async () => {
    const { user } = renderView(GOALS, vi.fn().mockRejectedValue(new Error('boom')));
    const dialog = await openContribution(user, 'Fondo de emergencia');

    await user.type(within(dialog).getByLabelText('Monto del aporte'), '1000');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar aporte' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('No se pudo guardar el aporte.');
  });

  it('caps the displayed progress at 100 % when the goal is overshot', () => {
    renderView([{ $id: 'g9', name: 'Bicicleta', targetMinor: 1000, currentMinor: 1500, ownerScope: 'you', status: 'active' }]);
    const card = screen.getByRole('article', { name: 'Bicicleta' });

    expect(within(card).getByText('100 %')).toBeInTheDocument();
    expect(within(card).getByText('Faltan $ 0')).toBeInTheDocument();
    expect(within(card).getByText('$ 1.500')).toBeInTheDocument();
  });
});
