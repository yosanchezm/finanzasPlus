import { useState } from 'react';
import { ArrowRight, Check, Eye, EyeOff, LockKeyhole, Mail, UserRound } from 'lucide-react';
import { BrandLockup } from '../../shared/ui/BrandMark';
import { Button } from '../../shared/ui/Button';
import { TextField } from '../../shared/ui/TextField';
import { cn, focusRing } from '../../shared/ui/cn';

const COPY = {
  login: {
    title: 'Inicia sesión',
    intro: 'Accede al hogar compartido para ver y registrar sus movimientos.',
    submit: 'Entrar al hogar',
    switchPrompt: '¿Aún no tienes cuenta?',
    switchAction: 'Crear una',
  },
  register: {
    title: 'Crea tu cuenta',
    intro: 'Después, un integrante del hogar te agrega para ver los datos compartidos.',
    submit: 'Crear cuenta',
    switchPrompt: '¿Ya tienes cuenta?',
    switchAction: 'Inicia sesión',
  },
};

const HIGHLIGHTS = [
  'Presupuesto por categoría, compartido o individual',
  'Recibos guardados en un bucket privado',
  'Nia registra gastos desde Telegram',
];

export default function AuthScreen({ onSubmit, error }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const copy = COPY[mode];
  const isRegister = mode === 'register';

  const update = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await onSubmit({ ...form, mode });
    } finally {
      setBusy(false);
    }
  };

  const switchMode = () => {
    setMode(isRegister ? 'login' : 'register');
    setForm((current) => ({ name: '', email: current.email, password: '' }));
    setShowPassword(false);
  };

  return (
    <div className="flex min-h-dvh bg-surface text-ink">
      <main className="flex min-w-0 flex-1 flex-col px-6 pt-10 pb-8 sm:px-10 lg:py-8">
        <BrandLockup />

        <div className="flex flex-1 items-start justify-center pt-12 pb-10 lg:items-center lg:py-12">
          <div className="flex w-full max-w-[360px] flex-col gap-6">
            <div className="flex flex-col gap-2">
              <h1 className="text-[26px] leading-8 font-semibold tracking-[-0.6px] lg:text-[28px] lg:leading-9">{copy.title}</h1>
              <p className="text-[15px] leading-[22px] text-ink-muted lg:text-sm">{copy.intro}</p>
            </div>

            <form className="flex flex-col gap-4" onSubmit={submit}>
              {isRegister && (
                <TextField label="Nombre" icon={UserRound} required autoComplete="name" value={form.name} onChange={update('name')} placeholder="Tu nombre" />
              )}
              <TextField label="Correo electrónico" icon={Mail} required type="email" autoComplete="email" value={form.email} onChange={update('email')} placeholder="tu@correo.com" />
              <TextField
                label="Contraseña"
                icon={LockKeyhole}
                required
                minLength={8}
                type={showPassword ? 'text' : 'password'}
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                value={form.password}
                onChange={update('password')}
                placeholder="Mínimo 8 caracteres"
                trailing={(
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    className={cn('grid size-10 place-items-center rounded-sm text-ink-muted hover:bg-surface-2 hover:text-ink', focusRing)}
                  >
                    {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                  </button>
                )}
              />

              {error && (
                <div role="alert" className="rounded-sm border border-danger/25 bg-danger-soft px-3 py-2.5 text-sm leading-5 text-danger">
                  {error}
                </div>
              )}

              <Button type="submit" size="lg" disabled={busy} className="mt-1 w-full">
                {busy ? 'Conectando…' : copy.submit}
                {!busy && <ArrowRight size={16} aria-hidden="true" />}
              </Button>
            </form>

            <div className="flex flex-wrap items-center justify-center gap-x-1.5 text-sm text-ink-muted">
              <span>{copy.switchPrompt}</span>
              <button type="button" onClick={switchMode} className={cn('rounded-sm px-1 py-2.5 font-semibold text-accent hover:text-accent-hover', focusRing)}>
                {copy.switchAction}
              </button>
            </div>

            {isRegister && (
              <p className="text-center text-xs leading-5 text-ink-faint">
                La cuenta nueva debe ser agregada al Team de Appwrite para ver este hogar.
              </p>
            )}
          </div>
        </div>

        <footer className="flex flex-wrap justify-between gap-2 text-xs text-ink-faint">
          <span>© {new Date().getFullYear()} finanzas+</span>
          <span>Tus datos viven en tu propio Appwrite</span>
        </footer>
      </main>

      <aside className="hidden flex-1 flex-col justify-center gap-10 bg-sidebar p-16 text-[#e7eeea] lg:flex">
        <div className="flex max-w-[480px] flex-col gap-4">
          <span className="font-mono text-xs tracking-[1.2px] text-brand-mint uppercase">Claridad compartida</span>
          <h2 className="text-4xl leading-11 font-semibold tracking-[-0.9px] text-white">Las finanzas del hogar, claras para los dos.</h2>
          <p className="text-[15px] leading-6 text-sidebar-text">
            Ingresos, gastos, presupuesto y metas en un solo lugar. Registra desde la web o por Telegram con Nia.
          </p>
        </div>
        <ul className="flex max-w-[480px] flex-col gap-3 text-sm text-[#c9d5cf]">
          {HIGHLIGHTS.map((item) => (
            <li key={item} className="flex items-center gap-2.5">
              <Check size={18} aria-hidden="true" className="shrink-0 text-brand-mint" />
              {item}
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
