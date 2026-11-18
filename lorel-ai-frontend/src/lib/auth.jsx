import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { authApi, hasSessionHint, onSessionChange, refreshSession, sessionExpiresAt } from "./api";

const AuthContext = createContext(null);

/* Who is signed in. On load, the refresh cookie (if any) restores the session
   without asking for a password; access tokens are renewed a minute before expiry. */
export function AuthProvider({ children }) {
  const [state, setState] = useState({ status: "loading", user: null });

  useEffect(() => {
    const unsubscribe = onSessionChange((session) =>
      setState(session ? { status: "signedIn", user: session.user } : { status: "signedOut", user: null })
    );
    if (hasSessionHint()) {
      refreshSession().then((session) => {
        if (!session) setState({ status: "signedOut", user: null });
      });
    } else {
      Promise.resolve().then(() => setState({ status: "signedOut", user: null }));
    }
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (state.status !== "signedIn") return undefined;
    const wait = Math.max(15_000, sessionExpiresAt() - Date.now() - 60_000);
    const timer = setTimeout(() => refreshSession(), wait);
    return () => clearTimeout(timer);
  }, [state]);

  const value = useMemo(
    () => ({
      ...state,
      signIn: authApi.signIn,
      signUp: authApi.signUp,
      signOut: authApi.signOut,
    }),
    [state]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext);
}
