import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { cn } from '../../shared/ui/cn';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');

/**
 * Global search: submitting opens Movimientos with the query applied.
 * Ctrl+K (⌘+K on macOS) focuses it; the listener lives only while this component is mounted.
 */
export default function TopbarSearch({ onSearch, className }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const submit = (event) => {
    event.preventDefault();
    onSearch(query.trim());
  };

  return (
    <form role="search" aria-label="Búsqueda global" onSubmit={submit} className={cn('relative', className)}>
      <label className="block">
        <span className="sr-only">Buscar movimientos</span>
        <Search size={16} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar movimientos…"
          aria-keyshortcuts="Control+K Meta+K"
          className="h-10 w-full rounded-sm border border-border-strong bg-surface-2 pr-3 pl-9 text-sm text-ink outline-none placeholder:text-ink-faint/80 focus:border-accent focus:bg-surface focus:ring-3 focus:ring-accent/15 xl:pr-16"
        />
      </label>
      <kbd aria-hidden="true" className="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 rounded-[4px] border border-border-strong bg-surface px-1.5 font-mono text-xs text-ink-faint xl:block">
        {isMac ? '⌘ K' : 'Ctrl K'}
      </kbd>
    </form>
  );
}
