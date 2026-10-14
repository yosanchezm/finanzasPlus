import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../../appwrite';
import SettingsContainer from './SettingsContainer';

vi.mock('../../appwrite', () => ({ listLegalRates: vi.fn(), upsertLegalRate: vi.fn() }));

// A far-future month keeps these tests independent of the clock (no past-month or stale hints).
const STORED = { $id: 'r1', kind: 'ibc', modality: 'consumer', validFrom: '2030-11-01', validTo: '2030-11-30', value: 1949, source: '', verified: false };
const user = { $id: 'u1' };

const rateForm = () => screen.getByRole('form', { name: 'Registrar tasa legal' });

beforeEach(() => {
  vi.clearAllMocks();
  api.listLegalRates.mockResolvedValue([]);
  api.upsertLegalRate.mockResolvedValue({});
});

describe('SettingsContainer', () => {
  it('saves a rate as the signed-in member, reloads the tables and lists the new month', async () => {
    const onNotify = vi.fn();
    const person = userEvent.setup();
    render(<SettingsContainer user={user} onNotify={onNotify} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Ajustes' })).toBeInTheDocument();
    const form = await screen.findByRole('form', { name: 'Registrar tasa legal' });
    fireEvent.change(within(form).getByLabelText('Mes'), { target: { value: '2030-11' } });
    await person.type(within(form).getByLabelText(/^IBC/), '19,49');
    expect(screen.getByText('Usura = 29,24 % E.A.')).toBeInTheDocument();
    expect(api.upsertLegalRate).not.toHaveBeenCalled();
    api.listLegalRates.mockResolvedValue([STORED]);

    await person.click(within(form).getByRole('button', { name: 'Guardar tasa' }));

    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('Tasa guardada.'));
    expect(api.upsertLegalRate).toHaveBeenCalledTimes(1);
    expect(api.upsertLegalRate).toHaveBeenCalledWith({
      kind: 'ibc', modality: 'consumer', validFrom: '2030-11-01', validTo: '2030-11-30', value: 1949, source: '', verified: false, actorId: 'u1',
    });
    expect(api.listLegalRates).toHaveBeenCalledTimes(2);
    const row = within(screen.getByRole('region', { name: 'Consumo y ordinario' })).getAllByRole('listitem')[0];
    expect(row).toHaveTextContent('noviembre de 2030');
    expect(row).toHaveTextContent('29,24 % E.A.');
    expect(within(rateForm()).getByLabelText(/^IBC/)).toHaveValue('');
  });

  it('keeps the typed value and the table when the write fails, and the retry completes it', async () => {
    api.upsertLegalRate.mockRejectedValueOnce(new Error('Sin conexión con Appwrite.'));
    const onNotify = vi.fn();
    const person = userEvent.setup();
    render(<SettingsContainer user={user} onNotify={onNotify} />);
    const form = await screen.findByRole('form', { name: 'Registrar tasa legal' });
    await person.type(within(form).getByLabelText(/^IBC/), '19,49');

    await person.click(within(form).getByRole('button', { name: 'Guardar tasa' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Sin conexión con Appwrite.');
    expect(within(form).getByLabelText(/^IBC/)).toHaveValue('19,49');
    expect(onNotify).not.toHaveBeenCalled();
    expect(api.listLegalRates).toHaveBeenCalledTimes(1);

    await person.click(within(form).getByRole('button', { name: 'Reintentar' }));

    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('Tasa guardada.'));
    expect(api.upsertLegalRate).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the app values and asks to update the database when the table is missing', async () => {
    api.listLegalRates.mockRejectedValue(Object.assign(new Error('Collection not found'), { code: 404 }));
    render(<SettingsContainer user={user} />);

    expect(await screen.findByText('Falta actualizar la base de datos')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Consumo y ordinario' })).getByText('28,59 % E.A.')).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Registrar tasa legal' })).not.toBeInTheDocument();
    expect(api.upsertLegalRate).not.toHaveBeenCalled();
  });

  it('recovers with Reintentar after a read failure', async () => {
    api.listLegalRates.mockRejectedValueOnce(new Error('sin red'));
    const person = userEvent.setup();
    render(<SettingsContainer user={user} />);
    expect(await screen.findByText('No pudimos leer las tasas legales')).toBeInTheDocument();

    await person.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByRole('form', { name: 'Registrar tasa legal' })).toBeInTheDocument();
    expect(screen.queryByText('No pudimos leer las tasas legales')).not.toBeInTheDocument();
  });
});
