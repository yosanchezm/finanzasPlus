import { useCallback, useEffect, useState } from 'react';
import { createAccount, getCurrentUser, getWorkspace, missingAppwriteConfig, signIn, signOut } from '../appwrite';
import AuthScreen from '../features/auth/AuthScreen';
import { AccessScreen, ConfigScreen, LoadingScreen } from '../features/auth/StatusScreens';
import { readableError } from '../shared/lib/errors';
import FinanceShell from './FinanceShell';

/**
 * Authentication and the first workspace load (which also proves household access).
 * The full-screen loading view is used only here; once the shell is mounted,
 * refreshes and month changes happen in place.
 */
export default function App() {
  const [authState, setAuthState] = useState('loading');
  const [authError, setAuthError] = useState('');
  const [user, setUser] = useState(null);
  const [workspace, setWorkspace] = useState(null);

  const enterWorkspace = useCallback(async (currentUser) => {
    setUser(currentUser);
    setAuthError('');
    setAuthState('loadingWorkspace');
    try {
      setWorkspace(await getWorkspace());
      setAuthState('ready');
    } catch (error) {
      setAuthError(readableError(error));
      setAuthState('accessError');
    }
  }, []);

  useEffect(() => {
    if (missingAppwriteConfig.length) {
      setAuthError(`Completa estas variables en .env: ${missingAppwriteConfig.join(', ')}`);
      setAuthState('configError');
      return undefined;
    }
    let mounted = true;
    getCurrentUser().then((currentUser) => {
      if (mounted) {
        if (currentUser) enterWorkspace(currentUser);
        else setAuthState('signedOut');
      }
    }).catch((error) => {
      if (mounted) { setAuthError(readableError(error)); setAuthState('signedOut'); }
    });
    return () => { mounted = false; };
  }, [enterWorkspace]);

  const handleAuth = async (payload) => {
    setAuthError('');
    setAuthState('authenticating');
    try {
      const currentUser = payload.mode === 'register'
        ? await createAccount(payload)
        : await signIn(payload.email, payload.password);
      await enterWorkspace(currentUser);
    } catch (error) {
      setAuthError(readableError(error));
      setAuthState('signedOut');
    }
  };

  const handleLogout = async () => {
    try { await signOut(); } finally {
      setUser(null);
      setWorkspace(null);
      setAuthState('signedOut');
    }
  };

  if (authState === 'loading' || authState === 'authenticating' || authState === 'loadingWorkspace') return <LoadingScreen message={authState === 'authenticating' ? 'Validando tu cuenta…' : 'Conectando con tu hogar…'} />;
  if (authState === 'configError') return <ConfigScreen message={authError} />;
  if (authState === 'signedOut') return <AuthScreen onSubmit={handleAuth} error={authError} />;
  if (authState === 'accessError') return <AccessScreen user={user} message={authError} onLogout={handleLogout} onRetry={() => enterWorkspace(user)} />;
  return <FinanceShell key={user.$id} user={user} initialWorkspace={workspace} onLogout={handleLogout} />;
}
