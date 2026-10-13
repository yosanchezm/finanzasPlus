import MobileTabBar from './MobileTabBar';
import MobileTopBar from './MobileTopBar';
import Sidebar from './Sidebar';
import Topbar from './Topbar';

/**
 * Layout only: sidebar + topbar from lg up, top bar + bottom tab bar below lg.
 * All state and actions come from the container. While `busy`, a thin indeterminate
 * bar shows under the top bars and the content stays mounted.
 */
export default function AppShell({
  householdName, members, displayName, email, activeView, transactionsCount,
  month, maxMonth, onMonthChange, showPeriod = true, onSearch, busy = false, refreshing = false,
  onNavigate, onAdd, onRefresh, onOpenAssistant, onLogout, children,
}) {
  return (
    <div className="min-h-dvh bg-bg font-sans text-ink lg:flex">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-sm bg-surface px-3 py-2 text-sm font-semibold text-accent focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Saltar al contenido
      </a>

      <Sidebar
        className="hidden lg:flex"
        householdName={householdName}
        members={members}
        displayName={displayName}
        email={email}
        activeView={activeView}
        transactionsCount={transactionsCount}
        onNavigate={onNavigate}
        onOpenAssistant={onOpenAssistant}
        onLogout={onLogout}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          className="hidden lg:flex"
          householdName={householdName}
          activeView={activeView}
          month={month}
          maxMonth={maxMonth}
          onMonthChange={onMonthChange}
          showPeriod={showPeriod}
          onSearch={onSearch}
          onAdd={onAdd}
          onRefresh={onRefresh}
          refreshing={refreshing}
        />
        <MobileTopBar
          className="flex lg:hidden"
          householdName={householdName}
          displayName={displayName}
          month={month}
          maxMonth={maxMonth}
          onMonthChange={onMonthChange}
          showPeriod={showPeriod}
        />

        <div className="sticky top-[60px] z-10 h-0.5 lg:top-16" aria-hidden={!busy}>
          {busy && (
            <div role="progressbar" aria-label="Actualizando datos" className="h-full overflow-hidden bg-accent-soft">
              <div className="h-full w-1/3 animate-[busy_1.1s_ease-in-out_infinite] bg-accent motion-reduce:w-full motion-reduce:animate-none" />
            </div>
          )}
        </div>

        <main
          id="main-content"
          tabIndex={-1}
          aria-busy={busy}
          className="mx-auto w-full max-w-[1200px] px-4 py-6 pb-[calc(96px+env(safe-area-inset-bottom))] outline-none lg:px-8 lg:py-8"
        >
          {children}
        </main>
      </div>

      <MobileTabBar
        className="lg:hidden"
        activeView={activeView}
        onNavigate={onNavigate}
        onAdd={onAdd}
        onOpenAssistant={onOpenAssistant}
        onRefresh={onRefresh}
        onLogout={onLogout}
      />
    </div>
  );
}
