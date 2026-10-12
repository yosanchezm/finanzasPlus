import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import AuthScreen from './AuthScreen';

const renderAuth = (props = {}) => {
  const onSubmit = props.onSubmit ?? vi.fn().mockResolvedValue(undefined);
  render(<AuthScreen onSubmit={onSubmit} error={props.error ?? ''} />);
  return { onSubmit, user: userEvent.setup() };
};

describe('AuthScreen', () => {
  it('defaults to login mode with email and password but no name field', () => {
    renderAuth();

    expect(screen.getByRole('heading', { level: 1, name: 'Inicia sesión' })).toBeInTheDocument();
    expect(screen.getByLabelText('Correo electrónico')).toHaveAttribute('autocomplete', 'email');
    expect(screen.getByLabelText('Contraseña')).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.queryByLabelText('Nombre')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Entrar al hogar/ })).toBeInTheDocument();
  });

  it('shows the name field and register copy after switching mode', async () => {
    const { user } = renderAuth();

    await user.click(screen.getByRole('button', { name: 'Crear una' }));

    expect(screen.getByRole('heading', { level: 1, name: 'Crea tu cuenta' })).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre')).toHaveAttribute('autocomplete', 'name');
    expect(screen.getByLabelText('Contraseña')).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByText(/La cuenta nueva debe ser agregada al Team de Appwrite/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Inicia sesión' }));
    expect(screen.queryByLabelText('Nombre')).not.toBeInTheDocument();
  });

  it('toggles password visibility and updates the toggle label', async () => {
    const { user } = renderAuth();
    const password = screen.getByLabelText('Contraseña');

    expect(password).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: 'Mostrar contraseña' }));
    expect(password).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: 'Ocultar contraseña' }));
    expect(password).toHaveAttribute('type', 'password');
  });

  it('submits the form values together with the current mode', async () => {
    const { user, onSubmit } = renderAuth();

    await user.click(screen.getByRole('button', { name: 'Crear una' }));
    await user.type(screen.getByLabelText('Nombre'), 'Ana');
    await user.type(screen.getByLabelText('Correo electrónico'), 'ana@example.com');
    await user.type(screen.getByLabelText('Contraseña'), 'supersecret');
    await user.click(screen.getByRole('button', { name: /Crear cuenta/ }));

    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Ana', email: 'ana@example.com', password: 'supersecret', mode: 'register',
    });
  });

  it('disables the submit button and shows a busy label while the request is pending', async () => {
    let resolveSubmit;
    const onSubmit = vi.fn(() => new Promise((resolve) => { resolveSubmit = resolve; }));
    const { user } = renderAuth({ onSubmit });

    await user.type(screen.getByLabelText('Correo electrónico'), 'ana@example.com');
    await user.type(screen.getByLabelText('Contraseña'), 'supersecret');
    await user.click(screen.getByRole('button', { name: /Entrar al hogar/ }));

    const busyButton = screen.getByRole('button', { name: /Conectando…/ });
    expect(busyButton).toBeDisabled();

    resolveSubmit();
    expect(await screen.findByRole('button', { name: /Entrar al hogar/ })).toBeEnabled();
  });

  it('announces the error with role alert', () => {
    renderAuth({ error: 'La sesión no es válida.' });

    expect(screen.getByRole('alert')).toHaveTextContent('La sesión no es válida.');
  });
});
