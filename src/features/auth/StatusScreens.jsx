import { LoaderCircle } from 'lucide-react';
import { BrandLockup } from '../../shared/ui/BrandMark';
import { Button } from '../../shared/ui/Button';

function StatusLayout({ children }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-bg px-4 py-10 text-ink">
      <section className="flex w-full max-w-[400px] flex-col gap-6 rounded-lg border border-border bg-surface p-6 shadow-[0_1px_2px_rgba(16,24,20,.04)] sm:p-8">
        <BrandLockup />
        {children}
      </section>
    </div>
  );
}

export function LoadingScreen({ message }) {
  return (
    <StatusLayout>
      <div role="status" aria-live="polite" className="flex items-center gap-3 text-sm text-ink-muted">
        <LoaderCircle size={18} aria-hidden="true" className="shrink-0 animate-spin text-accent motion-reduce:animate-none" />
        <span>{message}</span>
      </div>
    </StatusLayout>
  );
}

export function ConfigScreen({ message }) {
  return (
    <StatusLayout>
      <div className="flex flex-col gap-2">
        <h1 className="text-xl leading-7 font-semibold tracking-[-0.4px]">Falta configurar Appwrite</h1>
        <p className="text-sm leading-[22px] text-ink-muted">La aplicación no puede conectarse hasta completar la configuración.</p>
      </div>
      <p className="rounded-sm border border-border bg-surface-2 px-3 py-2.5 font-mono text-xs leading-5 break-words text-ink-2">{message}</p>
    </StatusLayout>
  );
}

export function AccessScreen({ user, message, onRetry, onLogout }) {
  return (
    <StatusLayout>
      <div className="flex flex-col gap-2">
        <span className="font-mono text-xs tracking-[1px] text-accent uppercase">Cuenta autenticada</span>
        <h1 className="text-xl leading-7 font-semibold tracking-[-0.4px]">Falta acceso al hogar</h1>
        <p className="text-sm leading-[22px] text-ink-muted">{message}</p>
        {user?.email && <p className="text-xs text-ink-faint">{user.email}</p>}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button onClick={onRetry} className="flex-1">Reintentar</Button>
        <Button variant="secondary" onClick={onLogout} className="flex-1">Cerrar sesión</Button>
      </div>
    </StatusLayout>
  );
}
