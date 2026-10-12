import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AccessScreen, ConfigScreen, LoadingScreen } from './StatusScreens';

describe('StatusScreens', () => {
  it('announces the loading message as a status', () => {
    render(<LoadingScreen message="Conectando con tu hogar…" />);

    expect(screen.getByRole('status')).toHaveTextContent('Conectando con tu hogar…');
  });

  it('explains the missing configuration', () => {
    render(<ConfigScreen message="Completa estas variables en .env: VITE_APPWRITE_ENDPOINT" />);

    expect(screen.getByRole('heading', { name: 'Falta configurar Appwrite' })).toBeInTheDocument();
    expect(screen.getByText(/VITE_APPWRITE_ENDPOINT/)).toBeInTheDocument();
  });

  it('lets the user retry or sign out when access is missing', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const onLogout = vi.fn();
    render(<AccessScreen user={{ email: 'ana@example.com' }} message="Sin acceso" onRetry={onRetry} onLogout={onLogout} />);

    expect(screen.getByText('ana@example.com')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    await user.click(screen.getByRole('button', { name: 'Cerrar sesión' }));

    expect(onRetry).toHaveBeenCalled();
    expect(onLogout).toHaveBeenCalled();
  });
});
